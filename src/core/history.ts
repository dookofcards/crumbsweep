// Sweep history: what was cleaned, when, and from where.
//
// Metadata only. Cookie names, domains, counts and timestamps are recorded;
// cookie *values* are never written here, because persisting them would put
// live session tokens on disk — exactly what this extension exists to avoid.
// (Undo holds values in chrome.storage.session instead, which is memory-only.)
import { domainForHost } from "./domain.ts";

const HISTORY_KEY = "sweepLog";

/** How the sweep was triggered, so the log can explain itself. */
export type SweepTrigger = "tab-close" | "manual" | "startup" | "clean-all";

export interface SweptCookie {
  name: string;
  /** The cookie's own host, minus any leading dot. */
  host: string;
  /** True when the cookie's registrable domain differs from the site's. */
  thirdParty: boolean;
}

export interface SweepRecord {
  id: string;
  /** Registrable domain swept, or null for a clean-all across every site. */
  domain: string | null;
  at: number;
  trigger: SweepTrigger;
  /** Cookies actually removed — may exceed cookies.length, which is capped. */
  count: number;
  /** Cookies deliberately left in place by session protection. */
  kept?: number;
  cookies: SweptCookie[];
}

// storage.local is ~10MB. Prune aggressively rather than asking for the
// unlimitedStorage permission: a new permission on a privacy extension costs
// more goodwill than the extra history is worth.
const MAX_RECORDS = 500;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_COOKIES_PER_RECORD = 60;

export function describeCookies(
  cookies: chrome.cookies.Cookie[],
  siteDomain: string | null,
): SweptCookie[] {
  return cookies.slice(0, MAX_COOKIES_PER_RECORD).map((cookie) => {
    const host = cookie.domain.replace(/^\./, "");
    return {
      name: cookie.name,
      host,
      thirdParty: siteDomain !== null && domainForHost(host) !== siteDomain,
    };
  });
}

function prune(records: SweepRecord[], now: number): SweepRecord[] {
  return records
    .filter((record) => now - record.at <= MAX_AGE_MS)
    .slice(0, MAX_RECORDS);
}

export async function getHistory(): Promise<SweepRecord[]> {
  const stored = await chrome.storage.local.get(HISTORY_KEY);
  const records = (stored[HISTORY_KEY] as SweepRecord[] | undefined) ?? [];
  return prune(records, Date.now());
}

/** Newest first. Returns the stored record so callers can reference its id. */
export async function recordSweep(
  entry: Omit<SweepRecord, "id" | "at">,
): Promise<SweepRecord> {
  const record: SweepRecord = {
    ...entry,
    id: crypto.randomUUID(),
    at: Date.now(),
  };
  const existing = await getHistory();
  await chrome.storage.local.set({
    [HISTORY_KEY]: prune([record, ...existing], record.at),
  });
  return record;
}

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.remove(HISTORY_KEY);
}

export interface SweepSummary {
  cookies: number;
  sites: number;
  /** Hosts that set the most cookies, third-party first. */
  topSources: { host: string; count: number; thirdParty: boolean }[];
  thirdPartyCookies: number;
}

/**
 * Roll records since `since` into the numbers worth showing a user. Pure so
 * it can be unit-tested without the storage layer.
 */
export function summarize(
  records: SweepRecord[],
  since: number,
  topCount = 5,
): SweepSummary {
  const recent = records.filter((record) => record.at >= since);
  const sites = new Set<string>();
  const sources = new Map<string, { count: number; thirdParty: boolean }>();
  let cookies = 0;
  let thirdPartyCookies = 0;

  for (const record of recent) {
    cookies += record.count;
    if (record.domain !== null) sites.add(record.domain);
    for (const cookie of record.cookies) {
      if (cookie.thirdParty) thirdPartyCookies++;
      const entry = sources.get(cookie.host) ?? {
        count: 0,
        thirdParty: cookie.thirdParty,
      };
      entry.count++;
      entry.thirdParty = entry.thirdParty || cookie.thirdParty;
      sources.set(cookie.host, entry);
    }
  }

  const topSources = [...sources.entries()]
    .map(([host, entry]) => ({ host, ...entry }))
    // Third-party first at equal counts: those are the interesting ones.
    .sort((a, b) => b.count - a.count || Number(b.thirdParty) - Number(a.thirdParty))
    .slice(0, topCount);

  return { cookies, sites: sites.size, topSources, thirdPartyCookies };
}
