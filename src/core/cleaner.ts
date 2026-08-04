import { domainForHost } from "./domain.ts";
import { describeCookies, recordSweep, type SweepTrigger } from "./history.ts";
import { stashSweep } from "./undo.ts";
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

/** Returns the cookies actually removed, so history logs reality. */
async function removeCookies(
  cookies: chrome.cookies.Cookie[],
): Promise<chrome.cookies.Cookie[]> {
  const removed: chrome.cookies.Cookie[] = [];
  for (const cookie of cookies) {
    const details: chrome.cookies.CookieDetails = {
      url: cookieUrl(cookie),
      name: cookie.name,
      storeId: cookie.storeId,
    };
    if (cookie.partitionKey) details.partitionKey = cookie.partitionKey;
    const gone = await chrome.cookies.remove(details);
    if (gone !== null) removed.push(cookie);
  }
  return removed;
}

/**
 * Cookies are matched by registrable domain, so subdomains are included and
 * every cookie store is covered (split-incognito). Opt-in data types are
 * cleared afterwards for this site's known origins.
 */
export async function cleanDomainFull(
  domain: string,
  seenOrigins: string[],
  trigger: SweepTrigger = "tab-close",
): Promise<number> {
  const removed: chrome.cookies.Cookie[] = [];
  const cookieHosts = new Set<string>();
  for (const store of await chrome.cookies.getAllCookieStores()) {
    const cookies = await allCookiesInStore(store.id, domain);
    for (const cookie of cookies) {
      cookieHosts.add(cookie.domain.replace(/^\./, ""));
    }
    removed.push(...(await removeCookies(cookies)));
  }
  await cleanOptInData(domain, cookieHosts, seenOrigins);
  if (removed.length > 0) {
    await bumpStats(removed.length, domain);
    const record = await recordSweep({
      domain,
      trigger,
      count: removed.length,
      cookies: describeCookies(removed, domain),
    });
    await stashSweep(record.id, domain, removed);
  }
  return removed.length;
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

export async function cleanAllCookiesExcept(
  spared: ReadonlySet<string>,
): Promise<number> {
  const removed: chrome.cookies.Cookie[] = [];
  for (const store of await chrome.cookies.getAllCookieStores()) {
    const targets = (await allCookiesInStore(store.id)).filter(
      (cookie) => !spared.has(domainForHost(cookie.domain)),
    );
    removed.push(...(await removeCookies(targets)));
  }
  if (removed.length > 0) {
    await bumpStats(removed.length);
    const record = await recordSweep({
      domain: null,
      trigger: "clean-all",
      count: removed.length,
      // No single site to compare against, so nothing is "third party" here.
      cookies: describeCookies(removed, null),
    });
    await stashSweep(record.id, null, removed);
  }
  return removed.length;
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
