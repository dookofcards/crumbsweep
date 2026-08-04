import { describe, expect, it } from "vitest";
import {
  clearHistory,
  describeCookies,
  getHistory,
  recordSweep,
  summarize,
  type SweepRecord,
} from "../src/core/history.ts";

const cookie = (
  name: string,
  domain: string,
): chrome.cookies.Cookie =>
  ({ name, domain, value: "secret", path: "/" }) as chrome.cookies.Cookie;

describe("describeCookies", () => {
  it("never carries cookie values into the log", () => {
    const described = describeCookies([cookie("sid", "example.com")], "example.com");
    expect(JSON.stringify(described)).not.toContain("secret");
    expect(described[0]).toEqual({
      name: "sid",
      host: "example.com",
      thirdParty: false,
    });
  });

  it("marks cookies from another registrable domain as third party", () => {
    const described = describeCookies(
      [
        cookie("sid", "example.com"),
        cookie("uid", ".doubleclick.net"),
        cookie("pref", "cdn.example.com"),
      ],
      "example.com",
    );
    expect(described.map((c) => c.thirdParty)).toEqual([false, true, false]);
  });

  it("strips the leading dot from domain cookies", () => {
    expect(describeCookies([cookie("a", ".example.com")], "example.com")[0].host).toBe(
      "example.com",
    );
  });

  it("treats nothing as third party when there is no site to compare to", () => {
    const described = describeCookies([cookie("uid", "doubleclick.net")], null);
    expect(described[0].thirdParty).toBe(false);
  });

  it("caps how many cookie names a single record can hold", () => {
    const many = Array.from({ length: 200 }, (_, i) => cookie(`c${i}`, "example.com"));
    expect(describeCookies(many, "example.com").length).toBeLessThanOrEqual(60);
  });
});

describe("recordSweep / getHistory", () => {
  it("stores newest first", async () => {
    await recordSweep({ domain: "a.com", trigger: "tab-close", count: 1, cookies: [] });
    await recordSweep({ domain: "b.com", trigger: "manual", count: 2, cookies: [] });
    const history = await getHistory();
    expect(history.map((r) => r.domain)).toEqual(["b.com", "a.com"]);
  });

  it("gives every record a distinct id", async () => {
    await recordSweep({ domain: "a.com", trigger: "tab-close", count: 1, cookies: [] });
    await recordSweep({ domain: "a.com", trigger: "tab-close", count: 1, cookies: [] });
    const [first, second] = await getHistory();
    expect(first.id).not.toBe(second.id);
  });

  it("drops records older than the retention window", async () => {
    const old: SweepRecord = {
      id: "old",
      domain: "old.com",
      at: Date.now() - 40 * 24 * 60 * 60 * 1000,
      trigger: "tab-close",
      count: 1,
      cookies: [],
    };
    await chrome.storage.local.set({ sweepLog: [old] });
    expect(await getHistory()).toEqual([]);
  });

  it("caps total records", async () => {
    const many: SweepRecord[] = Array.from({ length: 600 }, (_, i) => ({
      id: `r${i}`,
      domain: "x.com",
      at: Date.now(),
      trigger: "tab-close",
      count: 1,
      cookies: [],
    }));
    await chrome.storage.local.set({ sweepLog: many });
    expect((await getHistory()).length).toBe(500);
  });

  it("clears", async () => {
    await recordSweep({ domain: "a.com", trigger: "manual", count: 1, cookies: [] });
    await clearHistory();
    expect(await getHistory()).toEqual([]);
  });
});

describe("summarize", () => {
  const now = Date.now();
  const record = (
    domain: string | null,
    at: number,
    count: number,
    cookies: SweepRecord["cookies"],
  ): SweepRecord => ({ id: `${domain}${at}`, domain, at, trigger: "tab-close", count, cookies });

  const swept = (name: string, host: string, thirdParty: boolean) => ({
    name,
    host,
    thirdParty,
  });

  it("totals cookies and distinct sites in the window", () => {
    const summary = summarize(
      [
        record("a.com", now, 3, []),
        record("b.com", now, 2, []),
        record("a.com", now, 1, []),
      ],
      now - 1000,
    );
    expect(summary.cookies).toBe(6);
    expect(summary.sites).toBe(2);
  });

  it("excludes records older than the window", () => {
    const summary = summarize(
      [record("a.com", now, 5, []), record("b.com", now - 9999, 100, [])],
      now - 1000,
    );
    expect(summary.cookies).toBe(5);
    expect(summary.sites).toBe(1);
  });

  it("ranks top sources by how many cookies they set", () => {
    const summary = summarize(
      [
        record("a.com", now, 3, [
          swept("uid", "doubleclick.net", true),
          swept("uid2", "doubleclick.net", true),
          swept("sid", "a.com", false),
        ]),
        record("b.com", now, 1, [swept("uid", "doubleclick.net", true)]),
      ],
      now - 1000,
    );
    expect(summary.topSources[0]).toEqual({
      host: "doubleclick.net",
      count: 3,
      thirdParty: true,
    });
    expect(summary.thirdPartyCookies).toBe(3);
  });

  it("does not count a clean-all as a site", () => {
    const summary = summarize([record(null, now, 40, [])], now - 1000);
    expect(summary.cookies).toBe(40);
    expect(summary.sites).toBe(0);
  });

  it("returns zeroes for an empty history", () => {
    expect(summarize([], now - 1000)).toEqual({
      cookies: 0,
      sites: 0,
      topSources: [],
      thirdPartyCookies: 0,
    });
  });
});
