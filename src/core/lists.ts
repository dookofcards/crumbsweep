import { getDomain as tldtsGetDomain } from "tldts";

const getDomain = (host: string): string | null =>
  tldtsGetDomain(host, { allowPrivateDomains: true });

// Whitelist = never clean. Greylist = keep until browser restart.
// Stored in chrome.storage.sync so lists roam with the user's profile.
// sync has an ~8KB per-item quota, so each list is stored as numbered
// JSON-array chunks: "whitelist.0", "whitelist.1", ...
export type ListType = "white" | "grey";

const PREFIX: Record<ListType, string> = {
  white: "whitelist.",
  grey: "greylist.",
};

const CHUNK_BYTE_LIMIT = 7000; // headroom under the 8192-byte item quota

/**
 * Normalize user/import input to the registrable domain we match against:
 * trims, lowercases, strips scheme/path if someone pastes a URL, and
 * collapses subdomains to eTLD+1. Returns null for unusable input.
 */
export function normalizeEntry(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // scheme
  s = s.replace(/^\./, "").replace(/[/?#].*$/, ""); // leading dot, path
  s = s.replace(/:\d+$/, ""); // port
  // The eTLD+1 lookup falls back to the raw host for intranet names/IPs,
  // so gate on plausible-hostname characters or garbage would be accepted.
  if (!s || !/^[a-z0-9._-]+$/.test(s)) return null;
  return (getDomain(s) ?? s).toLowerCase();
}

function chunkKeys(all: Record<string, unknown>, type: ListType): string[] {
  const prefix = PREFIX[type];
  return Object.keys(all)
    .filter((k) => k.startsWith(prefix))
    .sort(
      (a, b) => Number(a.slice(prefix.length)) - Number(b.slice(prefix.length)),
    );
}

async function readList(type: ListType): Promise<string[]> {
  const all = await chrome.storage.sync.get(null);
  const domains: string[] = [];
  for (const key of chunkKeys(all, type)) {
    const chunk = all[key];
    if (Array.isArray(chunk)) domains.push(...chunk);
  }
  return domains;
}

async function writeList(type: ListType, domains: string[]): Promise<void> {
  const chunks: string[][] = [];
  let current: string[] = [];
  for (const domain of domains) {
    current.push(domain);
    if (JSON.stringify(current).length > CHUNK_BYTE_LIMIT - 100) {
      current.pop();
      chunks.push(current);
      current = [domain];
    }
  }
  if (current.length > 0 || chunks.length === 0) chunks.push(current);

  const updates: Record<string, string[]> = {};
  chunks.forEach((chunk, i) => (updates[`${PREFIX[type]}${i}`] = chunk));
  await chrome.storage.sync.set(updates);

  const all = await chrome.storage.sync.get(null);
  const stale = chunkKeys(all, type).filter(
    (key) => !(key in updates),
  );
  if (stale.length > 0) await chrome.storage.sync.remove(stale);
}

export interface Lists {
  white: string[];
  grey: string[];
}

export async function getLists(): Promise<Lists> {
  return { white: await readList("white"), grey: await readList("grey") };
}

/** Which list protects this registrable domain, if any. */
export async function listStatusFor(domain: string): Promise<ListType | null> {
  const lists = await getLists();
  if (lists.white.includes(domain)) return "white";
  if (lists.grey.includes(domain)) return "grey";
  return null;
}

/**
 * Put a domain on exactly one list (or none). A domain can never be on both
 * lists, so setting one membership clears the other.
 */
export async function setListMembership(
  domain: string,
  type: ListType | null,
): Promise<void> {
  const lists = await getLists();
  for (const t of ["white", "grey"] as const) {
    const without = lists[t].filter((d) => d !== domain);
    const target =
      t === type && !without.includes(domain)
        ? [...without, domain].sort()
        : without;
    if (target.length !== lists[t].length || t === type) {
      await writeList(t, target);
    }
  }
}

/** Bulk replace, used by import (step 5) and options list management. */
export async function replaceLists(lists: Lists): Promise<void> {
  await writeList("white", [...new Set(lists.white)].sort());
  await writeList("grey", [...new Set(lists.grey)].sort());
}
