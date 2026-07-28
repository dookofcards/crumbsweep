import { describe, expect, it } from "vitest";
import { domainForHost, domainForUrl } from "../src/core/domain.ts";

describe("domainForUrl", () => {
  it("collapses subdomains to eTLD+1", () => {
    expect(domainForUrl("https://mail.google.com/inbox")).toBe("google.com");
    expect(domainForUrl("https://www.google.com")).toBe("google.com");
    expect(domainForUrl("https://google.com")).toBe("google.com");
  });

  it("understands multi-part public suffixes", () => {
    expect(domainForUrl("https://news.bbc.co.uk/page")).toBe("bbc.co.uk");
    expect(domainForUrl("https://sub.example.com.au")).toBe("example.com.au");
    expect(domainForUrl("https://user.github.io")).toBe("user.github.io");
  });

  it("falls back to the bare host for IPs and intranet names", () => {
    expect(domainForUrl("http://192.168.1.10/admin")).toBe("192.168.1.10");
    expect(domainForUrl("http://localhost:8080/x")).toBe("localhost");
    expect(domainForUrl("http://intranet/wiki")).toBe("intranet");
  });

  it("ignores ports and lowercases", () => {
    expect(domainForUrl("https://Example.COM:8443/a")).toBe("example.com");
  });

  it("returns null for non-http(s) and invalid URLs", () => {
    expect(domainForUrl("chrome://extensions")).toBeNull();
    expect(domainForUrl("file:///C:/x.html")).toBeNull();
    expect(domainForUrl("chrome-extension://abc/popup.html")).toBeNull();
    expect(domainForUrl("about:blank")).toBeNull();
    expect(domainForUrl("not a url")).toBeNull();
    expect(domainForUrl(undefined)).toBeNull();
    expect(domainForUrl("")).toBeNull();
  });
});

describe("domainForHost", () => {
  it("strips leading cookie-domain dots", () => {
    expect(domainForHost(".google.com")).toBe("google.com");
    expect(domainForHost(".accounts.google.com")).toBe("google.com");
  });

  it("handles bare hosts", () => {
    expect(domainForHost("localhost")).toBe("localhost");
    expect(domainForHost("BBC.CO.UK")).toBe("bbc.co.uk");
  });
});
