// Scheduled deep cleans (pro): a periodic sweep of everything except the
// whitelist, for people who want a floor on how long any cookie survives.
//
// Uses a periodic alarm rather than a computed wake time. The exact minute
// does not matter, and a periodic alarm self-heals if the browser was closed
// when a clean was due — the next tick simply notices it is overdue.
export const DEEP_CLEAN_ALARM = "deep-clean";
const LAST_RUN_KEY = "lastDeepClean";

/** Checked hourly; the due calculation decides whether anything happens. */
const TICK_MINUTES = 60;

export type DeepCleanSchedule = "off" | "daily" | "weekly";

const INTERVAL_MS: Record<Exclude<DeepCleanSchedule, "off">, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

export async function getLastRun(): Promise<number> {
  const stored = await chrome.storage.local.get(LAST_RUN_KEY);
  const value = stored[LAST_RUN_KEY];
  return typeof value === "number" ? value : 0;
}

export async function markRun(at = Date.now()): Promise<void> {
  await chrome.storage.local.set({ [LAST_RUN_KEY]: at });
}

/**
 * Pure so the interval arithmetic is testable. A schedule that has never run
 * is not immediately due: turning the setting on should not wipe every cookie
 * on the spot, which would be a nasty surprise from a checkbox.
 */
export function isDue(
  schedule: DeepCleanSchedule,
  lastRun: number,
  now: number,
): boolean {
  if (schedule === "off") return false;
  if (lastRun === 0) return false;
  return now - lastRun >= INTERVAL_MS[schedule];
}

export async function armSchedule(schedule: DeepCleanSchedule): Promise<void> {
  if (schedule === "off") {
    await chrome.alarms.clear(DEEP_CLEAN_ALARM);
    return;
  }
  // Start the clock now, so enabling the setting means "from here", not
  // "retroactively overdue".
  if ((await getLastRun()) === 0) await markRun();
  await chrome.alarms.create(DEEP_CLEAN_ALARM, {
    periodInMinutes: TICK_MINUTES,
  });
}

/** Runs `clean` when the schedule says so. Returns whether it ran. */
export async function runIfDue(
  schedule: DeepCleanSchedule,
  clean: () => Promise<void>,
): Promise<boolean> {
  if (!isDue(schedule, await getLastRun(), Date.now())) return false;
  // Marked before cleaning so a crash mid-clean cannot loop on every wake.
  await markRun();
  await clean();
  return true;
}
