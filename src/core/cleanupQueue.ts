// Persistent pending-cleanup queue. chrome.alarms is the survives-SW-death
// wake mechanism, but packed extensions can't fire alarms sooner than ~30s
// out. So: a setTimeout gives sub-30s precision while the SW is alive, the
// alarm (clamped to the minimum ourselves, to avoid console warnings) is the
// fallback if the SW dies, and processDue() runs on every SW wake. Cleanup
// may therefore land slightly late, never early — and late is harmless.
export const CLEANUP_ALARM = "cleanup-due";
const ALARM_MIN_DELAY_MS = 30_000;
const QUEUE_KEY = "pendingCleanups";

// domain -> epoch ms when cleaning is due
type Queue = Record<string, number>;

let softTimer: ReturnType<typeof setTimeout> | undefined;
let processor: (() => void) | undefined;

/** The service worker registers its processDue driver here (also used by the soft timer). */
export function setProcessor(fn: () => void): void {
  processor = fn;
}

async function load(): Promise<Queue> {
  const stored = await chrome.storage.local.get(QUEUE_KEY);
  return (stored[QUEUE_KEY] as Queue | undefined) ?? {};
}

async function save(queue: Queue): Promise<void> {
  await chrome.storage.local.set({ [QUEUE_KEY]: queue });
}

async function scheduleWake(queue: Queue): Promise<void> {
  if (softTimer !== undefined) {
    clearTimeout(softTimer);
    softTimer = undefined;
  }
  const dueTimes = Object.values(queue);
  if (dueTimes.length === 0) {
    await chrome.alarms.clear(CLEANUP_ALARM);
    return;
  }
  const earliest = Math.min(...dueTimes);
  await chrome.alarms.create(CLEANUP_ALARM, {
    when: Math.max(earliest, Date.now() + ALARM_MIN_DELAY_MS),
  });
  softTimer = setTimeout(
    () => processor?.(),
    Math.max(0, earliest - Date.now()),
  );
}

export async function enqueue(domain: string, graceMs: number): Promise<void> {
  const queue = await load();
  queue[domain] = Date.now() + graceMs;
  await save(queue);
  await scheduleWake(queue);
}

/** Called whenever a domain becomes active again — reopening within the grace period cancels the clean. */
export async function cancel(domain: string): Promise<void> {
  const queue = await load();
  if (!(domain in queue)) return;
  delete queue[domain];
  await save(queue);
  await scheduleWake(queue);
}

/** Drop every pending cleanup (used when the user pauses auto-cleaning). */
export async function clearAll(): Promise<void> {
  await save({});
  await scheduleWake({});
}

/**
 * Cleans every overdue entry, then re-arms the wake-ups for whatever remains.
 * Due entries are removed from storage before cleaning runs so a crash
 * mid-clean can't loop; a missed clean self-heals the next time the domain's
 * tabs close.
 */
export async function processDue(
  clean: (domain: string) => Promise<void>,
): Promise<void> {
  const queue = await load();
  const now = Date.now();
  const due = Object.keys(queue).filter((domain) => queue[domain]! <= now);
  if (due.length > 0) {
    for (const domain of due) delete queue[domain];
    await save(queue);
    for (const domain of due) await clean(domain);
  }
  await scheduleWake(queue);
}
