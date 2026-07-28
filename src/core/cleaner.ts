import { domainForHost } from "./domain.ts";
import { getSettings } from "../shared/settings.ts";

export const STATS_KEY = "cleanStats";
const DOMAIN_STATS_KEY = "domainCleanStats";

export interface CleanStats {
  total: number;
  today: number;
  todayDate: string; // local YYYY-MM-DD, for rollover
}

/**
 * Rebuild the URL a cookie was set for, which chrome.cookies.remove requires.
 * Domain cookies are stored with a leading dot; host-only cookies without.
 * Secure cookies need an https URL or removal silently fails.
 */
export function cookieUrl(cookie: chrome.cookies.Cookie): string {
  const host = cookie.domain.startsWith(".")
    ? cookie.domain.slice(1)
    : cookie.domain;
  return `${cookie.secure ? "https" : "http"}://${host}${cookie.path}`;
}

function cookieIdentity(cookie: chrome.cookies.Cookie): string {
  return JSON.stringify([
    cookie.name,
    cookie.domain,
    cookie.path,
    cookie.partitionKey ?? null,
  ]);
}

/**
 * getAll without a partitionKey returns only unpartitioned cookies; an empty
 * partitionKey matches partitioned ones too. Query both and dedupe so CHIPS
 * cookies don't survive a clean.
 */
async function allCookiesInStore(
  storeId: string,
  domain?: string,
): Promise<chrome.cookies.Cookie[]> {
  const seen = new Set<string>();
  const result: chrome.cookies.Cookie[] = [];
  for (const details of [
    { domain, storeId },
    { domain, storeId, partitionKey: {} },
  ]) {
    let cookies: chrome.cookies.Cookie[] = [];
    try {
      cookies = await chrome.cookies.getAll(details);
    } catch {
      // partitionKey filter unsupported on very old Chrome — the plain query already ran
    }
    for (const cookie of cookies) {
      const id = cookieIdentity(cookie);
      if (!seen.has(id)) {
        seen.add(id);
        result.push(cookie);
      }
    }
  }
  return result;
}

/**
 * Delete all cookies for a registrable domain (subdomains included — the
 * `domain` filter of cookies.getAll matches them) across every accessible
 * cookie store, so split-incognito contexts are covered. Returns the number
 * of cookies removed.
 */
async function removeCookies(
  cookies: chrome.cookies.Cookie[],
): Promise<number> {
  let removed = 0;
  for (const cookie of cookies) {
    const details: chrome.cookies.CookieDetails = {
      url: cookieUrl(cookie),
      name: cookie.name,
      storeId: cookie.storeId,
    };
    if (cookie.partitionKey) details.partitionKey = cookie.partitionKey;
    const gone = await chrome.cookies.remove(details);
    if (gone !== null) removed++;
  }
  return removed;
}

/**
 * The one per-domain cleaning path (auto-clean, popup clean-now, greylist
 * startup clean): removes cookies from every store, then — only for the
 * data types the user opted into — chrome.browsingData for the origins we
 * know belong to this site (origins observed in tabs, plus every host that
 * carried a cookie, plus bare/www). browsingData is origin-exact, which is
 * exactly why the extra types are opt-in.
 */
export async function cleanDomainFull(
  domain: string,
  seenOrigins: string[],
): Promise<number> {
  let removed = 0;
  const cookieHosts = new Set<string>();
  for (const store of await chrome.cookies.getAllCookieStores()) {
    const cookies = await allCookiesInStore(store.id, domain);
    for (const cookie of cookies) {
      cookieHosts.add(cookie.domain.replace(/^\./, ""));
    }
    removed += await removeCookies(cookies);
  }
  await cleanOptInData(domain, cookieHosts, seenOrigins);
  if (removed > 0) await bumpStats(removed, domain);
  return removed;
}

async function cleanOptInData(
  domain: string,
  cookieHosts: Set<string>,
  seenOrigins: string[],
): Promise<void> {
  const settings = await getSettings();
  const dataTypes: chrome.browsingData.DataTypeSet = {};
  if (settings.cleanLocalStorage) dataTypes.localStorage = true;
  if (settings.cleanIndexedDB) dataTypes.indexedDB = true;
  if (settings.cleanCache) {
    dataTypes.cache = true;
    dataTypes.cacheStorage = true;
  }
  if (settings.cleanServiceWorkers) dataTypes.serviceWorkers = true;
  if (Object.keys(dataTypes).length === 0) return;

  const origins = new Set<string>(seenOrigins);
  cookieHosts.add(domain);
  cookieHosts.add(`www.${domain}`);
  for (const host of cookieHosts) {
    origins.add(`https://${host}`);
    origins.add(`http://${host}`);
  }
  try {
    await chrome.browsingData.remove({ origins: [...origins] }, dataTypes);
  } catch {
    // e.g. a data type unsupported with origin filters on this Chrome — cookies were already cleaned
  }
}

/**
 * The options page's "clean everything now" action: removes every cookie in
 * every store except those whose registrable domain is spared (whitelist).
 */
export async function cleanAllCookiesExcept(
  spared: ReadonlySet<string>,
): Promise<number> {
  let removed = 0;
  for (const store of await chrome.cookies.getAllCookieStores()) {
    const targets = (await allCookiesInStore(store.id)).filter(
      (cookie) => !spared.has(domainForHost(cookie.domain)),
    );
    removed += await removeCookies(targets);
  }
  if (removed > 0) await bumpStats(removed);
  return removed;
}

function localDateString(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function getStats(): Promise<CleanStats> {
  const stored = await chrome.storage.local.get(STATS_KEY);
  const stats = (stored[STATS_KEY] as CleanStats | undefined) ?? {
    total: 0,
    today: 0,
    todayDate: localDateString(),
  };
  if (stats.todayDate !== localDateString()) {
    stats.today = 0;
    stats.todayDate = localDateString();
  }
  return stats;
}

/** Lifetime cookies-cleaned count per registrable domain (badge "site" mode). */
export async function getDomainStats(): Promise<Record<string, number>> {
  const stored = await chrome.storage.local.get(DOMAIN_STATS_KEY);
  return (stored[DOMAIN_STATS_KEY] as Record<string, number> | undefined) ?? {};
}

async function bumpStats(removed: number, domain?: string): Promise<void> {
  const stats = await getStats();
  stats.total += removed;
  stats.today += removed;
  await chrome.storage.local.set({ [STATS_KEY]: stats });
  if (domain !== undefined) {
    const domainStats = await getDomainStats();
    domainStats[domain] = (domainStats[domain] ?? 0) + removed;
    await chrome.storage.local.set({ [DOMAIN_STATS_KEY]: domainStats });
  }
}
