// Cookie-level keep rules: "sweep this site, but leave these cookies alone."
//
// The manual companion to the session-cookie heuristic. When the guess is
// wrong in either direction, this is the escape hatch — and it is what makes
// per-cookie control possible for sites the heuristic cannot read.
//
// Stored in chrome.storage.sync, chunked the same way the lists are, so rules
// roam with the profile and stay inside the ~8KB per-item quota.
const PREFIX = "cookierules.";
const CHUNK_BYTE_LIMIT = 7000;

export interface CookieRule {
  /** Registrable domain, matching how lists and sweeps identify a site. */
  domain: string;
  /** Cookie name patterns to keep. "*" matches any run of characters. */
  keep: string[];
}

/**
 * Glob with a single wildcard character, anchored. Deliberately not full
 * regex: these come from a text field, and a user-supplied regex that
 * backtracks would hang the sweep.
 */
export function patternMatches(pattern: string, name: string): boolean {
  if (pattern === "") return false;
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`, "i").test(name);
}

export function cookieIsKept(rule: CookieRule | undefined, name: string): boolean {
  if (rule === undefined) return false;
  return rule.keep.some((pattern) => patternMatches(pattern, name));
}

function chunkKeys(all: Record<string, unknown>): string[] {
  return Object.keys(all)
    .filter((key) => key.startsWith(PREFIX))
    .sort((a, b) => Number(a.slice(PREFIX.length)) - Number(b.slice(PREFIX.length)));
}

export async function getRules(): Promise<CookieRule[]> {
  const all = await chrome.storage.sync.get(null);
  const rules: CookieRule[] = [];
  for (const key of chunkKeys(all)) {
    const chunk = all[key];
    if (Array.isArray(chunk)) rules.push(...(chunk as CookieRule[]));
  }
  return rules;
}

export async function getRuleFor(
  domain: string,
): Promise<CookieRule | undefined> {
  return (await getRules()).find((rule) => rule.domain === domain);
}

async function writeRules(rules: CookieRule[]): Promise<void> {
  const chunks: CookieRule[][] = [];
  let current: CookieRule[] = [];
  for (const rule of rules) {
    current.push(rule);
    if (JSON.stringify(current).length > CHUNK_BYTE_LIMIT - 100) {
      current.pop();
      chunks.push(current);
      current = [rule];
    }
  }
  if (current.length > 0 || chunks.length === 0) chunks.push(current);

  const updates: Record<string, CookieRule[]> = {};
  chunks.forEach((chunk, i) => (updates[`${PREFIX}${i}`] = chunk));
  await chrome.storage.sync.set(updates);

  const all = await chrome.storage.sync.get(null);
  const stale = chunkKeys(all).filter((key) => !(key in updates));
  if (stale.length > 0) await chrome.storage.sync.remove(stale);
}

/** Replace a domain's keep-patterns. An empty list removes the rule. */
export async function setRule(domain: string, keep: string[]): Promise<void> {
  const cleaned = [...new Set(keep.map((p) => p.trim()).filter(Boolean))];
  const others = (await getRules()).filter((rule) => rule.domain !== domain);
  const next =
    cleaned.length > 0 ? [...others, { domain, keep: cleaned }] : others;
  next.sort((a, b) => (a.domain < b.domain ? -1 : 1));
  await writeRules(next);
}

export async function clearRules(): Promise<void> {
  await writeRules([]);
}

/** Split cookies for a site into those a rule protects and those to sweep. */
export function partitionByRule<T extends Pick<chrome.cookies.Cookie, "name">>(
  cookies: T[],
  rule: CookieRule | undefined,
): { keep: T[]; sweep: T[] } {
  const keep: T[] = [];
  const sweep: T[] = [];
  for (const cookie of cookies) {
    (cookieIsKept(rule, cookie.name) ? keep : sweep).push(cookie);
  }
  return { keep, sweep };
}
