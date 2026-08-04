import { describe, expect, it } from "vitest";
import {
  clearUndoBuffer,
  getRestorable,
  stashSweep,
  toSetDetails,
} from "../src/core/undo.ts";

const cookie = (over: Partial<chrome.cookies.Cookie> = {}) =>
  ({
    name: "sid",
    value: "abc",
    domain: "example.com",
    path: "/",
    secure: false,
    httpOnly: false,
    hostOnly: true,
    session: false,
    sameSite: "lax",
    expirationDate: 1893456000,
    storeId: "0",
    ...over,
  }) as chrome.cookies.Cookie;

describe("toSetDetails", () => {
  it("omits domain for host-only cookies", () => {
    // Passing the domain back would widen a host-only cookie into a domain
    // cookie covering every subdomain — a different, broader cookie.
    const details = toSetDetails(cookie({ hostOnly: true, domain: "example.com" }));
    expect(details.domain).toBeUndefined();
    expect(details.url).toBe("http://example.com/");
  });

  it("keeps the leading dot for domain cookies", () => {
    const details = toSetDetails(cookie({ hostOnly: false, domain: ".example.com" }));
    expect(details.domain).toBe(".example.com");
    expect(details.url).toBe("http://example.com/");
  });

  it("uses an https url for secure cookies", () => {
    expect(toSetDetails(cookie({ secure: true })).url).toBe("https://example.com/");
  });

  it("preserves the path", () => {
    expect(toSetDetails(cookie({ path: "/deep/path" })).url).toBe(
      "http://example.com/deep/path",
    );
  });

  it("omits expirationDate for session cookies", () => {
    // Setting one would turn a cookie that should die with the browser into a
    // persistent one.
    const details = toSetDetails(cookie({ session: true, expirationDate: 123 }));
    expect(details.expirationDate).toBeUndefined();
  });

  it("keeps expirationDate for persistent cookies", () => {
    expect(toSetDetails(cookie({ session: false })).expirationDate).toBe(1893456000);
  });

  it("round-trips the security attributes", () => {
    const details = toSetDetails(
      cookie({ secure: true, httpOnly: true, sameSite: "strict" }),
    );
    expect(details.secure).toBe(true);
    expect(details.httpOnly).toBe(true);
    expect(details.sameSite).toBe("strict");
  });

  it("carries the partition key for CHIPS cookies", () => {
    const partitionKey = { topLevelSite: "https://top.example" };
    expect(toSetDetails(cookie({ partitionKey })).partitionKey).toEqual(partitionKey);
  });

  it("stays in the same cookie store", () => {
    expect(toSetDetails(cookie({ storeId: "1" })).storeId).toBe("1");
  });
});

describe("stashSweep / getRestorable", () => {
  it("offers a stashed sweep back, newest first", async () => {
    await stashSweep("s1", "a.com", [cookie()]);
    await stashSweep("s2", "b.com", [cookie(), cookie({ name: "two" })]);
    const restorable = await getRestorable();
    expect(restorable.map((r) => r.sweepId)).toEqual(["s2", "s1"]);
    expect(restorable[0].count).toBe(2);
  });

  it("never exposes cookie values", async () => {
    await stashSweep("s1", "a.com", [cookie({ value: "SECRET" })]);
    expect(JSON.stringify(await getRestorable())).not.toContain("SECRET");
  });

  it("skips empty sweeps", async () => {
    await stashSweep("s1", "a.com", []);
    expect(await getRestorable()).toEqual([]);
  });

  it("skips sweeps too large to hold", async () => {
    // Better to offer no undo than a partial one that claims success.
    const many = Array.from({ length: 1001 }, (_, i) => cookie({ name: `c${i}` }));
    await stashSweep("big", "a.com", many);
    expect(await getRestorable()).toEqual([]);
  });

  it("keeps only the most recent sweeps", async () => {
    for (let i = 0; i < 15; i++) {
      await stashSweep(`s${i}`, "a.com", [cookie()]);
    }
    expect((await getRestorable()).length).toBe(10);
  });

  it("drops entries past the ten minute window", async () => {
    await chrome.storage.session.set({
      undoBuffer: [
        {
          sweepId: "old",
          at: Date.now() - 11 * 60 * 1000,
          domain: "a.com",
          cookies: [cookie()],
        },
      ],
    });
    expect(await getRestorable()).toEqual([]);
  });

  it("clears", async () => {
    await stashSweep("s1", "a.com", [cookie()]);
    await clearUndoBuffer();
    expect(await getRestorable()).toEqual([]);
  });
});
