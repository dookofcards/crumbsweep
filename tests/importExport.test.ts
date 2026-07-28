import { describe, expect, it } from "vitest";
import { mergeIntoLists, parseImport } from "../src/core/importExport.ts";
import { getLists, replaceLists } from "../src/core/lists.ts";

describe("parseImport: Cookie AutoDelete JSON", () => {
  it("maps WHITE/GREY, collapses wildcards, ignores storeId, skips junk", () => {
    const cad = JSON.stringify([
      { expression: "github.com", listType: "WHITE", storeId: "default" },
      { expression: "*.google.com", listType: "WHITE", storeId: "firefox-container-1" },
      { expression: "wikipedia.org", listType: "GREY" },
      { expression: "sub.news.example.co.uk", listType: "GREY" },
      { expression: "", listType: "WHITE" },
      { expression: "mozilla.org", listType: "SOMETHING_ELSE" },
      "not-an-object",
      { listType: "WHITE" },
      null,
      42,
    ]);
    const result = parseImport(cad);
    expect(result).toEqual({
      kind: "lists",
      white: ["github.com", "google.com"],
      grey: ["wikipedia.org", "example.co.uk"],
      skipped: 6,
    });
  });

  it("dedupes expressions that collapse to the same domain", () => {
    const cad = JSON.stringify([
      { expression: "google.com", listType: "WHITE" },
      { expression: "*.google.com", listType: "WHITE" },
      { expression: "mail.google.com", listType: "WHITE" },
    ]);
    const result = parseImport(cad);
    expect(result).toMatchObject({ kind: "lists", white: ["google.com"] });
  });

  it("rejects an array with nothing usable", () => {
    expect(parseImport("[1, 2, {}]")).toEqual({ kind: "invalid" });
    expect(parseImport("[]")).toEqual({ kind: "invalid" });
  });
});

describe("parseImport: own JSON format", () => {
  it("round-trips white/grey arrays and skips non-strings", () => {
    const json = JSON.stringify({
      format: "crumbsweep-lists",
      version: 1,
      white: ["a.com", "https://b.com/path", 7],
      grey: ["c.com"],
    });
    expect(parseImport(json)).toEqual({
      kind: "lists",
      white: ["a.com", "b.com"],
      grey: ["c.com"],
      skipped: 1,
    });
  });
});

describe("parseImport: plain domain lines", () => {
  it("parses one domain per line, skipping comments and blanks", () => {
    const text = "reddit.com\n\n# comment\nhttps://x.com/foo\n*.dropbox.com\n";
    expect(parseImport(text)).toEqual({
      kind: "domains",
      domains: ["reddit.com", "x.com", "dropbox.com"],
      skipped: 0,
    });
  });

  it("rejects text with no usable domains", () => {
    expect(parseImport("# just a comment\n\n")).toEqual({ kind: "invalid" });
    expect(parseImport("total garbage that is not json {{{")).toEqual({
      kind: "invalid",
    });
  });

  it("rejects unrecognized JSON objects", () => {
    expect(parseImport('{"foo": "bar"}')).toEqual({ kind: "invalid" });
    expect(parseImport("null")).toEqual({ kind: "invalid" });
  });
});

describe("mergeIntoLists", () => {
  it("merges into existing lists; whitelist outranks greylist", async () => {
    await replaceLists({ white: ["keep.com"], grey: ["promote.me", "stay.grey"] });
    const result = await mergeIntoLists(
      ["promote.me", "new.white"],
      ["keep.com", "new.grey", "stay.grey"],
    );
    expect(result).toEqual({ addedWhite: 2, addedGrey: 1 });
    const lists = await getLists();
    expect(lists.white).toEqual(["keep.com", "new.white", "promote.me"]);
    expect(lists.grey).toEqual(["new.grey", "stay.grey"]);
  });

  it("is idempotent", async () => {
    await mergeIntoLists(["a.com"], ["b.com"]);
    const second = await mergeIntoLists(["a.com"], ["b.com"]);
    expect(second).toEqual({ addedWhite: 0, addedGrey: 0 });
  });
});
