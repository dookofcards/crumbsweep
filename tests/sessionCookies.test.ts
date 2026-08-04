import { describe, expect, it } from "vitest";
import {
  isLikelySessionCookie,
  partitionBySession,
} from "../src/core/sessionCookies.ts";

const c = (name: string, domain = "example.com") => ({ name, domain });
const keeps = (name: string, domain?: string) =>
  isLikelySessionCookie(c(name, domain), "example.com");

describe("isLikelySessionCookie", () => {
  it("keeps the common framework session cookies", () => {
    for (const name of [
      "PHPSESSID",
      "JSESSIONID",
      "connect.sid",
      "laravel_session",
      "_rails_session",
      "ci_session",
      "sails.sid",
      "ASP.NET_SessionId",
    ]) {
      expect(keeps(name), name).toBe(true);
    }
  });

  it("keeps generic auth and token names", () => {
    for (const name of [
      "session",
      "session_id",
      "sid",
      "ssid",
      "auth",
      "auth_token",
      "access_token",
      "refresh_token",
      "jwt",
      "login",
      "remember_me",
      "user_credentials",
      "wordpress_logged_in_abc123",
    ]) {
      expect(keeps(name), name).toBe(true);
    }
  });

  it("keeps CSRF tokens, because losing them breaks form posts", () => {
    expect(keeps("csrftoken")).toBe(true);
    expect(keeps("_xsrf")).toBe(true);
  });

  it("does not keep analytics cookies that merely contain 'session'", () => {
    // The motivating false positive: Hotjar's cookie is not a login.
    expect(keeps("_hjSessionUser_12345")).toBe(false);
    expect(keeps("_hjSession_12345")).toBe(false);
  });

  it("does not keep known trackers", () => {
    for (const name of [
      "_ga",
      "_ga_ABC123",
      "_gid",
      "_gat_gtag_UA_1",
      "__utma",
      "_fbp",
      "fr",
      "IDE",
      "NID",
      "MUID",
      "_uetsid",
      "ajs_user_id",
      "hubspotutk",
      "_rdt_uuid",
      "cto_bundle",
    ]) {
      expect(keeps(name), name).toBe(false);
    }
  });

  it("does not keep ordinary preference cookies", () => {
    for (const name of ["theme", "locale", "cart", "consent", "considered"]) {
      expect(keeps(name), name).toBe(false);
    }
  });

  it("never keeps a third-party cookie, even a convincing one", () => {
    // A "sid" set by an ad network is the ad network's id for you.
    expect(keeps("sid", "doubleclick.net")).toBe(false);
    expect(keeps("auth_token", "tracker.example.org")).toBe(false);
  });

  it("treats subdomains of the site as first party", () => {
    expect(keeps("session_id", "accounts.example.com")).toBe(true);
    expect(keeps("session_id", ".example.com")).toBe(true);
  });

  it("keeps nothing special when there is no site to compare against", () => {
    // clean-all has no single site; first-party cannot be established, so the
    // name rules still apply but the domain check is skipped.
    expect(isLikelySessionCookie(c("PHPSESSID", "other.com"), null)).toBe(true);
    expect(isLikelySessionCookie(c("_ga", "other.com"), null)).toBe(false);
  });
});

describe("partitionBySession", () => {
  it("splits a realistic sweep", () => {
    const cookies = [
      c("PHPSESSID"),
      c("csrftoken"),
      c("_ga"),
      c("IDE", "doubleclick.net"),
      c("theme"),
    ];
    const { keep, sweep } = partitionBySession(cookies, "example.com");
    expect(keep.map((k) => k.name)).toEqual(["PHPSESSID", "csrftoken"]);
    expect(sweep.map((s) => s.name)).toEqual(["_ga", "IDE", "theme"]);
  });

  it("keeps nothing when nothing looks like a session", () => {
    const { keep, sweep } = partitionBySession([c("_ga"), c("theme")], "example.com");
    expect(keep).toEqual([]);
    expect(sweep.length).toBe(2);
  });
});
