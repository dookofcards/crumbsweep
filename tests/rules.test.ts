import { describe, expect, it } from "vitest";
import {
  clearRules,
  cookieIsKept,
  getRuleFor,
  getRules,
  partitionByRule,
  patternMatches,
  setRule,
} from "../src/core/rules.ts";

describe("patternMatches", () => {
  it("matches exactly when there is no wildcard", () => {
    expect(patternMatches("sid", "sid")).toBe(true);
    expect(patternMatches("sid", "sid2")).toBe(false);
    expect(patternMatches("sid", "xsid")).toBe(false);
  });

  it("is case insensitive", () => {
    expect(patternMatches("phpsessid", "PHPSESSID")).toBe(true);
  });

  it("supports a trailing wildcard", () => {
    expect(patternMatches("wordpress_*", "wordpress_logged_in_abc")).toBe(true);
    expect(patternMatches("wordpress_*", "wordpress_")).toBe(true);
    expect(patternMatches("wordpress_*", "wp_other")).toBe(false);
  });

  it("supports leading and interior wildcards", () => {
    expect(patternMatches("*_session", "app_session")).toBe(true);
    expect(patternMatches("auth*token", "auth_access_token")).toBe(true);
  });

  it("treats regex metacharacters as literals", () => {
    // A user typing "a.b" means "a.b", not "a<any>b".
    expect(patternMatches("a.b", "axb")).toBe(false);
    expect(patternMatches("a.b", "a.b")).toBe(true);
    expect(patternMatches("cookie(1)", "cookie(1)")).toBe(true);
  });

  it("never matches on an empty pattern", () => {
    expect(patternMatches("", "anything")).toBe(false);
  });
});

describe("cookieIsKept", () => {
  it("is false when no rule exists", () => {
    expect(cookieIsKept(undefined, "sid")).toBe(false);
  });

  it("matches any pattern in the rule", () => {
    const rule = { domain: "example.com", keep: ["sid", "csrf*"] };
    expect(cookieIsKept(rule, "sid")).toBe(true);
    expect(cookieIsKept(rule, "csrftoken")).toBe(true);
    expect(cookieIsKept(rule, "_ga")).toBe(false);
  });
});

describe("rule storage", () => {
  it("round-trips a rule", async () => {
    await setRule("example.com", ["sid", "csrf*"]);
    expect(await getRuleFor("example.com")).toEqual({
      domain: "example.com",
      keep: ["sid", "csrf*"],
    });
  });

  it("trims and de-duplicates patterns", async () => {
    await setRule("example.com", [" sid ", "sid", "", "  "]);
    expect((await getRuleFor("example.com"))?.keep).toEqual(["sid"]);
  });

  it("removes the rule when nothing is kept", async () => {
    await setRule("example.com", ["sid"]);
    await setRule("example.com", []);
    expect(await getRuleFor("example.com")).toBeUndefined();
  });

  it("keeps rules for other domains independent", async () => {
    await setRule("a.com", ["sid"]);
    await setRule("b.com", ["token"]);
    await setRule("a.com", []);
    expect(await getRuleFor("b.com")).toBeDefined();
    expect((await getRules()).length).toBe(1);
  });

  it("replaces rather than appends on re-save", async () => {
    await setRule("a.com", ["sid"]);
    await setRule("a.com", ["token"]);
    expect((await getRules()).length).toBe(1);
    expect((await getRuleFor("a.com"))?.keep).toEqual(["token"]);
  });

  it("chunks large rule sets and reads them back whole", async () => {
    for (let i = 0; i < 300; i++) {
      await setRule(`site${i}.com`, [`cookie_name_number_${i}`]);
    }
    const rules = await getRules();
    expect(rules.length).toBe(300);
    expect(await getRuleFor("site299.com")).toBeDefined();
  });

  it("clears", async () => {
    await setRule("a.com", ["sid"]);
    await clearRules();
    expect(await getRules()).toEqual([]);
  });
});

describe("partitionByRule", () => {
  it("splits kept cookies from swept ones", () => {
    const { keep, sweep } = partitionByRule(
      [{ name: "sid" }, { name: "_ga" }, { name: "csrftoken" }],
      { domain: "example.com", keep: ["sid", "csrf*"] },
    );
    expect(keep.map((c) => c.name)).toEqual(["sid", "csrftoken"]);
    expect(sweep.map((c) => c.name)).toEqual(["_ga"]);
  });

  it("sweeps everything when there is no rule", () => {
    const { keep, sweep } = partitionByRule([{ name: "sid" }], undefined);
    expect(keep).toEqual([]);
    expect(sweep.length).toBe(1);
  });
});
