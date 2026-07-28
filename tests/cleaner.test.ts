import { describe, expect, it } from "vitest";
import { cookieUrl } from "../src/core/cleaner.ts";

function fakeCookie(
  overrides: Partial<chrome.cookies.Cookie>,
): chrome.cookies.Cookie {
  return {
    name: "sid",
    value: "x",
    domain: "example.com",
    hostOnly: true,
    path: "/",
    secure: false,
    httpOnly: false,
    sameSite: "unspecified",
    session: true,
    storeId: "0",
    ...overrides,
  } as chrome.cookies.Cookie;
}

describe("cookieUrl reconstruction", () => {
  it("host-only insecure cookie", () => {
    expect(cookieUrl(fakeCookie({}))).toBe("http://example.com/");
  });

  it("secure cookie needs an https URL", () => {
    expect(cookieUrl(fakeCookie({ secure: true }))).toBe(
      "https://example.com/",
    );
  });

  it("domain cookie: strips the leading dot", () => {
    expect(
      cookieUrl(fakeCookie({ domain: ".example.com", secure: true })),
    ).toBe("https://example.com/");
  });

  it("subdomain domain-cookie keeps its host", () => {
    expect(cookieUrl(fakeCookie({ domain: ".shop.example.co.uk" }))).toBe(
      "http://shop.example.co.uk/",
    );
  });

  it("includes the cookie path", () => {
    expect(
      cookieUrl(fakeCookie({ path: "/app/session", secure: true })),
    ).toBe("https://example.com/app/session");
  });
});
