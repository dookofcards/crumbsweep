import { getLists, normalizeEntry, replaceLists } from "./lists.ts";

// Import formats, all parsed defensively — these files are user-supplied
// and must never throw:
//  1. Cookie AutoDelete JSON: array of { expression, listType: WHITE|GREY,
//     storeId, ... }. Wildcards collapse to eTLD+1; storeId is ignored
//     because per-container rules aren't supported.
//  2. This extension's own export ({ white: [...], grey: [...] }).
//  3. Newline-separated domains — no list type, so the caller must choose.

export type ParsedImport =
  | { kind: "lists"; white: string[]; grey: string[]; skipped: number }
  | { kind: "domains"; domains: string[]; skipped: number }
  | { kind: "invalid" };

function normalizeExpression(raw: string): string | null {
  let s = raw.trim();
  while (s.startsWith("*.")) s = s.slice(2);
  s = s.replace(/^\*+/, "");
  return normalizeEntry(s);
}

function parseCadArray(entries: unknown[]): ParsedImport {
  const white = new Set<string>();
  const grey = new Set<string>();
  let skipped = 0;
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) {
      skipped++;
      continue;
    }
    const { expression, listType } = entry as Record<string, unknown>;
    const domain =
      typeof expression === "string" ? normalizeExpression(expression) : null;
    if (domain === null) {
      skipped++;
      continue;
    }
    if (listType === "WHITE") white.add(domain);
    else if (listType === "GREY") grey.add(domain);
    else skipped++; // unknown list type — don't guess at trust levels
  }
  if (white.size === 0 && grey.size === 0) return { kind: "invalid" };
  return { kind: "lists", white: [...white], grey: [...grey], skipped };
}

function parseOwnFormat(obj: Record<string, unknown>): ParsedImport {
  const collect = (value: unknown): { domains: string[]; skipped: number } => {
    const domains = new Set<string>();
    let skipped = 0;
    if (!Array.isArray(value)) return { domains: [], skipped };
    for (const item of value) {
      const domain = typeof item === "string" ? normalizeEntry(item) : null;
      if (domain === null) skipped++;
      else domains.add(domain);
    }
    return { domains: [...domains], skipped };
  };
  const white = collect(obj.white);
  const grey = collect(obj.grey);
  return {
    kind: "lists",
    white: white.domains,
    grey: grey.domains,
    skipped: white.skipped + grey.skipped,
  };
}

function parseDomainLines(text: string): ParsedImport {
  const domains = new Set<string>();
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const domain = normalizeExpression(trimmed);
    if (domain === null) skipped++;
    else domains.add(domain);
  }
  if (domains.size === 0) return { kind: "invalid" };
  return { kind: "domains", domains: [...domains], skipped };
}

export function parseImport(text: string): ParsedImport {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return parseDomainLines(text);
  }
  if (Array.isArray(data)) return parseCadArray(data);
  if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.white) || Array.isArray(obj.grey)) {
      return parseOwnFormat(obj);
    }
  }
  return { kind: "invalid" };
}

export interface MergeResult {
  addedWhite: number;
  addedGrey: number;
}

/**
 * Merge imported domains into the stored lists. Whitelist outranks greylist:
 * importing WHITE promotes an existing grey entry; importing GREY never
 * demotes an existing white one.
 */
export async function mergeIntoLists(
  white: string[],
  grey: string[],
): Promise<MergeResult> {
  const lists = await getLists();
  const whiteSet = new Set(lists.white);
  const greySet = new Set(lists.grey);
  let addedWhite = 0;
  let addedGrey = 0;
  for (const domain of white) {
    greySet.delete(domain);
    if (!whiteSet.has(domain)) {
      whiteSet.add(domain);
      addedWhite++;
    }
  }
  for (const domain of grey) {
    if (whiteSet.has(domain) || greySet.has(domain)) continue;
    greySet.add(domain);
    addedGrey++;
  }
  await replaceLists({ white: [...whiteSet], grey: [...greySet] });
  return { addedWhite, addedGrey };
}

export async function exportListsJson(): Promise<string> {
  const lists = await getLists();
  return JSON.stringify(
    {
      format: "crumbsweep-lists",
      version: 1,
      exportedAt: new Date().toISOString(),
      white: lists.white,
      grey: lists.grey,
    },
    null,
    2,
  );
}
