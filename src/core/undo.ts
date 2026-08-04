// Undo buffer for recent sweeps.
//
// Restoring a cookie needs its value, and cookie values must never touch
// disk — that is the whole premise of the product. chrome.storage.session is
// the way out: it lives in memory for the duration of the browser session,
// is never written to storage, is cleared when Chrome closes, and is not
// reachable from content scripts by default.
//
// Measured on Chrome 120+ (tools spike, 2026-08-04): quota is 10 MB and is
// enforced with a throw. ~50 cookies cost 64 KB, ~500 cost 637 KB. The caps
// below keep the worst case near 1.3 MB.
//
// If the buffer is ever unavailable, undo simply is not offered — nothing
// else degrades. Every caller treats a miss as "no undo available".
import { cookieUrl } from "./cleaner.ts";

const UNDO_KEY = "undoBuffer";

/** Values live this long. Stated in the UI; never quietly extended. */
export const UNDO_TTL_MS = 10 * 60 * 1000;
const MAX_SWEEPS = 10;
const MAX_COOKIES_PER_SWEEP = 1000;

export interface UndoEntry {
  sweepId: string;
  at: number;
  domain: string | null;
  cookies: chrome.cookies.Cookie[];
}

export interface RestorableSweep {
  sweepId: string;
  at: number;
  domain: string | null;
  count: number;
}

async function readBuffer(): Promise<UndoEntry[]> {
  if (chrome.storage.session === undefined) return [];
  try {
    const stored = await chrome.storage.session.get(UNDO_KEY);
    const entries = (stored[UNDO_KEY] as UndoEntry[] | undefined) ?? [];
    const cutoff = Date.now() - UNDO_TTL_MS;
    return entries.filter((entry) => entry.at >= cutoff);
  } catch {
    return [];
  }
}

async function writeBuffer(entries: UndoEntry[]): Promise<void> {
  if (chrome.storage.session === undefined) return;
  try {
    await chrome.storage.session.set({ [UNDO_KEY]: entries.slice(0, MAX_SWEEPS) });
  } catch {
    // Over quota, or session storage unavailable. Undo is a convenience; a
    // sweep must never fail because its undo entry could not be stored.
  }
}

/**
 * Hold a sweep's cookies so it can be undone. Sweeps larger than the cap are
 * skipped outright rather than stored partially — a partial restore would
 * tell the user they were restored when they were not.
 */
export async function stashSweep(
  sweepId: string,
  domain: string | null,
  cookies: chrome.cookies.Cookie[],
): Promise<void> {
  if (cookies.length === 0 || cookies.length > MAX_COOKIES_PER_SWEEP) return;
  const entry: UndoEntry = { sweepId, at: Date.now(), domain, cookies };
  await writeBuffer([entry, ...(await readBuffer())]);
}

/** Sweeps still restorable, newest first. Values are not exposed. */
export async function getRestorable(): Promise<RestorableSweep[]> {
  return (await readBuffer()).map((entry) => ({
    sweepId: entry.sweepId,
    at: entry.at,
    domain: entry.domain,
    count: entry.cookies.length,
  }));
}

/**
 * chrome.cookies.set is not a straight mirror of what getAll returned:
 * host-only cookies must be written with no domain at all (passing one makes
 * a broader domain cookie instead), and session cookies must be written with
 * no expirationDate (passing one makes them persist past the browser close).
 */
export function toSetDetails(
  cookie: chrome.cookies.Cookie,
): chrome.cookies.SetDetails {
  const details: chrome.cookies.SetDetails = {
    url: cookieUrl(cookie),
    name: cookie.name,
    value: cookie.value,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    storeId: cookie.storeId,
  };
  if (!cookie.hostOnly) details.domain = cookie.domain;
  if (!cookie.session && cookie.expirationDate !== undefined) {
    details.expirationDate = cookie.expirationDate;
  }
  // "unspecified" is what getAll reports for cookies with no SameSite; passing
  // it back through is accepted and preserves the original behaviour.
  if (cookie.sameSite) details.sameSite = cookie.sameSite;
  if (cookie.partitionKey) details.partitionKey = cookie.partitionKey;
  return details;
}

export interface RestoreResult {
  restored: number;
  failed: number;
  /** False when the sweep had already expired or was never stashed. */
  available: boolean;
}

export async function restoreSweep(sweepId: string): Promise<RestoreResult> {
  const entries = await readBuffer();
  const entry = entries.find((candidate) => candidate.sweepId === sweepId);
  if (entry === undefined) return { restored: 0, failed: 0, available: false };

  let restored = 0;
  let failed = 0;
  for (const cookie of entry.cookies) {
    try {
      const result = await chrome.cookies.set(toSetDetails(cookie));
      if (result) restored++;
      else failed++;
    } catch {
      // A single unwritable cookie (expired, malformed host) must not abort
      // the rest of the restore.
      failed++;
    }
  }
  // Consumed either way: offering the same undo twice would re-create cookies
  // the user may have deliberately swept again.
  await writeBuffer(entries.filter((candidate) => candidate.sweepId !== sweepId));
  return { restored, failed, available: true };
}

export async function clearUndoBuffer(): Promise<void> {
  if (chrome.storage.session === undefined) return;
  try {
    await chrome.storage.session.remove(UNDO_KEY);
  } catch {
    // nothing to clean up
  }
}
