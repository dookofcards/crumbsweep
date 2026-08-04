import { describe, expect, it, vi } from "vitest";
import {
  armSchedule,
  DEEP_CLEAN_ALARM,
  getLastRun,
  isDue,
  markRun,
  runIfDue,
} from "../src/core/schedule.ts";
import { chromeMock } from "./setup.ts";

const DAY = 24 * 60 * 60 * 1000;
const now = 1_800_000_000_000;

describe("isDue", () => {
  it("is never due when the schedule is off", () => {
    expect(isDue("off", now - 400 * DAY, now)).toBe(false);
  });

  it("is not due before the interval elapses", () => {
    expect(isDue("daily", now - 23 * 60 * 60 * 1000, now)).toBe(false);
    expect(isDue("weekly", now - 6 * DAY, now)).toBe(false);
  });

  it("is due once the interval elapses", () => {
    expect(isDue("daily", now - DAY, now)).toBe(true);
    expect(isDue("weekly", now - 7 * DAY, now)).toBe(true);
  });

  it("is not due when it has never run", () => {
    // Ticking a checkbox should not wipe every cookie on the spot.
    expect(isDue("daily", 0, now)).toBe(false);
  });

  it("stays due while overdue, so a closed browser self-heals", () => {
    expect(isDue("daily", now - 30 * DAY, now)).toBe(true);
  });
});

describe("armSchedule", () => {
  it("clears the alarm when turned off", async () => {
    await armSchedule("off");
    expect(chromeMock().alarms._cleared).toContain(DEEP_CLEAN_ALARM);
  });

  it("creates a periodic alarm when turned on", async () => {
    await armSchedule("daily");
    const created = chromeMock().alarms._created.find(
      (a) => a.name === DEEP_CLEAN_ALARM,
    );
    expect(created?.info.periodInMinutes).toBe(60);
  });

  it("starts the clock so enabling is not retroactively overdue", async () => {
    expect(await getLastRun()).toBe(0);
    await armSchedule("weekly");
    expect(await getLastRun()).toBeGreaterThan(0);
  });

  it("does not reset the clock if it is already running", async () => {
    await markRun(now - 3 * DAY);
    await armSchedule("weekly");
    expect(await getLastRun()).toBe(now - 3 * DAY);
  });
});

describe("runIfDue", () => {
  it("does nothing when not due", async () => {
    const clean = vi.fn();
    await markRun(Date.now());
    expect(await runIfDue("daily", clean)).toBe(false);
    expect(clean).not.toHaveBeenCalled();
  });

  it("runs and records the run when due", async () => {
    const clean = vi.fn();
    await markRun(Date.now() - 2 * DAY);
    expect(await runIfDue("daily", clean)).toBe(true);
    expect(clean).toHaveBeenCalledOnce();
    expect(await getLastRun()).toBeGreaterThan(Date.now() - 1000);
  });

  it("does not run twice for the same due window", async () => {
    const clean = vi.fn();
    await markRun(Date.now() - 2 * DAY);
    await runIfDue("daily", clean);
    await runIfDue("daily", clean);
    expect(clean).toHaveBeenCalledOnce();
  });

  it("records the run before cleaning so a crash cannot loop", async () => {
    await markRun(Date.now() - 2 * DAY);
    const failing = vi.fn(async () => {
      throw new Error("clean blew up");
    });
    await expect(runIfDue("daily", failing)).rejects.toThrow("clean blew up");
    // The timestamp moved even though the clean failed.
    expect(await getLastRun()).toBeGreaterThan(Date.now() - 1000);
  });
});
