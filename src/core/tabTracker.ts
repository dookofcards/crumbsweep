import { domainForUrl } from "./domain.ts";

// tabId -> registrable domain, persisted so it survives SW kills.
const TRACKED_TABS_KEY = "trackedTabs";

type TabMap = Record<string, string>;

/** Callbacks fired when a domain's open-tab count crosses zero. */
export interface TrackerEvents {
  /** Last tab for the domain closed or navigated away. */
  domainEmptied(domain: string): Promise<void>;
  /** Domain has at least one open tab (opened, navigated to, or found on rebuild). */
  domainActive(domain: string): Promise<void>;
}

// domain -> origins actually seen open in tabs, so the opt-in browsingData
// clean (which is origin-exact) knows which origins to target. Entries are
// consumed (and cleared) by takeSeenOrigins when a domain gets cleaned.
const SEEN_ORIGINS_KEY = "seenOrigins";
const MAX_ORIGINS_PER_DOMAIN = 20;

type OriginMap = Record<string, string[]>;

async function load(): Promise<TabMap> {
  const stored = await chrome.storage.local.get(TRACKED_TABS_KEY);
  return (stored[TRACKED_TABS_KEY] as TabMap | undefined) ?? {};
}

async function loadOrigins(): Promise<OriginMap> {
  const stored = await chrome.storage.local.get(SEEN_ORIGINS_KEY);
  return (stored[SEEN_ORIGINS_KEY] as OriginMap | undefined) ?? {};
}

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const origin = new URL(url).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

async function recordOrigins(
  entries: Array<{ domain: string; url: string | undefined }>,
): Promise<void> {
  const map = await loadOrigins();
  let changed = false;
  for (const { domain, url } of entries) {
    const origin = originOf(url);
    if (origin === null) continue;
    const existing = map[domain] ?? [];
    if (existing.includes(origin)) continue;
    map[domain] = [...existing, origin].slice(-MAX_ORIGINS_PER_DOMAIN);
    changed = true;
  }
  if (changed) await chrome.storage.local.set({ [SEEN_ORIGINS_KEY]: map });
}

/** Read-and-clear the origins observed for a domain (called when it's cleaned). */
export async function takeSeenOrigins(domain: string): Promise<string[]> {
  const map = await loadOrigins();
  const origins = map[domain] ?? [];
  if (domain in map) {
    delete map[domain];
    await chrome.storage.local.set({ [SEEN_ORIGINS_KEY]: map });
  }
  return origins;
}

async function save(map: TabMap): Promise<void> {
  await chrome.storage.local.set({ [TRACKED_TABS_KEY]: map });
}

function countOf(map: TabMap, domain: string): number {
  let n = 0;
  for (const d of Object.values(map)) if (d === domain) n++;
  return n;
}

export async function domainHasOpenTabs(domain: string): Promise<boolean> {
  return countOf(await load(), domain) > 0;
}

/**
 * Rebuild the map from a full tabs query. Runs on every SW start — the
 * in-memory world is gone, and on browser restart the stored map is stale.
 * Deliberately does NOT emit domainEmptied for domains that vanished:
 * tab-close events wake the SW, so mid-session closes are never missed, and
 * enqueueing everything from a previous browser session on startup would be
 * an aggressive default. domainActive fires for every open domain so stale
 * pending cleanups get cancelled.
 */
export async function rebuild(events: TrackerEvents): Promise<void> {
  const tabs = await chrome.tabs.query({});
  const next: TabMap = {};
  const seen: Array<{ domain: string; url: string | undefined }> = [];
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    const url = tab.pendingUrl || tab.url;
    const domain = domainForUrl(url);
    if (domain) {
      next[String(tab.id)] = domain;
      seen.push({ domain, url });
    }
  }
  await save(next);
  await recordOrigins(seen);
  for (const domain of new Set(Object.values(next))) {
    await events.domainActive(domain);
  }
}

/** Handles tab creation and URL changes (navigation across domains). */
export async function updateTab(
  tabId: number,
  url: string | undefined,
  events: TrackerEvents,
): Promise<void> {
  const map = await load();
  const key = String(tabId);
  const prev = map[key];
  const next = domainForUrl(url);
  if (prev === next || (prev === undefined && next === null)) return;
  if (next) map[key] = next;
  else delete map[key];
  await save(map);
  if (next) {
    await recordOrigins([{ domain: next, url }]);
    await events.domainActive(next);
  }
  if (prev !== undefined && prev !== next && countOf(map, prev) === 0) {
    await events.domainEmptied(prev);
  }
}

export async function removeTab(
  tabId: number,
  events: TrackerEvents,
): Promise<void> {
  const map = await load();
  const key = String(tabId);
  const prev = map[key];
  if (prev === undefined) return;
  delete map[key];
  await save(map);
  if (countOf(map, prev) === 0) await events.domainEmptied(prev);
}

/** Prerender/instant navigation swaps: the new tab inherits the old one's slot. */
export async function replaceTab(
  addedTabId: number,
  removedTabId: number,
  events: TrackerEvents,
): Promise<void> {
  const map = await load();
  const prev = map[String(removedTabId)];
  if (prev !== undefined) {
    delete map[String(removedTabId)];
    map[String(addedTabId)] = prev;
    await save(map);
  }
  let tab: chrome.tabs.Tab | undefined;
  try {
    tab = await chrome.tabs.get(addedTabId);
  } catch {
    // tab already gone; removeTab will have fired
  }
  if (tab) await updateTab(addedTabId, tab.pendingUrl || tab.url, events);
}
