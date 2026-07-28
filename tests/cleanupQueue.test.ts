import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLEANUP_ALARM,
  cancel,
  clearAll,
  enqueue,
  processDue,
} from "../src/core/cleanupQueue.ts";
import { chromeMock } from "./setup.ts";

const T0 = 1_800_000_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

function cleanSpy() {
  const cleaned: string[] = [];
  return {
    cleaned,
    clean: async (domain: string) => {
      cleaned.push(domain);
    },
  };
}

describe("cleanupQueue due-time logic", () => {
  it("does not clean before the grace period elapses", async () => {
    await enqueue("a.com", 15_000);
    const spy = cleanSpy();
    await processDue(spy.clean);
    expect(spy.cleaned).toEqual([]);
  });

  it("cleans exactly once after the due time and empties the queue", async () => {
    await enqueue("a.com", 15_000);
    vi.setSystemTime(T0 + 16_000);
    const spy = cleanSpy();
    await processDue(spy.clean);
    expect(spy.cleaned).toEqual(["a.com"]);
    await processDue(spy.clean);
    expect(spy.cleaned).toEqual(["a.com"]); // not cleaned again
  });

  it("cleans only overdue domains, keeping the rest pending", async () => {
    await enqueue("soon.com", 10_000);
    await enqueue("later.com", 120_000);
    vi.setSystemTime(T0 + 30_000);
    const spy = cleanSpy();
    await processDue(spy.clean);
    expect(spy.cleaned).toEqual(["soon.com"]);
    vi.setSystemTime(T0 + 121_000);
    await processDue(spy.clean);
    expect(spy.cleaned).toEqual(["soon.com", "later.com"]);
  });

  it("supports a zero grace period (due immediately)", async () => {
    await enqueue("now.com", 0);
    const spy = cleanSpy();
    await processDue(spy.clean);
    expect(spy.cleaned).toEqual(["now.com"]);
  });

  it("re-enqueueing a domain resets its due time", async () => {
    await enqueue("a.com", 10_000);
    vi.setSystemTime(T0 + 8_000);
    await enqueue("a.com", 10_000); // closed again — new countdown
    vi.setSystemTime(T0 + 12_000); // first deadline passed, second not
    const spy = cleanSpy();
    await processDue(spy.clean);
    expect(spy.cleaned).toEqual([]);
  });

  it("cancel removes a pending cleanup", async () => {
    await enqueue("a.com", 10_000);
    await cancel("a.com");
    vi.setSystemTime(T0 + 60_000);
    const spy = cleanSpy();
    await processDue(spy.clean);
    expect(spy.cleaned).toEqual([]);
  });

  it("clearAll drops everything and clears the alarm", async () => {
    await enqueue("a.com", 10_000);
    await enqueue("b.com", 20_000);
    await clearAll();
    vi.setSystemTime(T0 + 60_000);
    const spy = cleanSpy();
    await processDue(spy.clean);
    expect(spy.cleaned).toEqual([]);
    expect(chromeMock().alarms._cleared).toContain(CLEANUP_ALARM);
  });
});

describe("cleanupQueue alarm scheduling", () => {
  it("never schedules the alarm earlier than the 30s minimum", async () => {
    await enqueue("a.com", 15_000);
    const last = chromeMock().alarms._created.at(-1);
    expect(last?.name).toBe(CLEANUP_ALARM);
    expect(last?.info.when).toBe(T0 + 30_000);
  });

  it("schedules at the actual due time when beyond the minimum", async () => {
    await enqueue("a.com", 120_000);
    const last = chromeMock().alarms._created.at(-1);
    expect(last?.info.when).toBe(T0 + 120_000);
  });

  it("schedules for the earliest pending domain", async () => {
    await enqueue("later.com", 300_000);
    await enqueue("sooner.com", 60_000);
    const last = chromeMock().alarms._created.at(-1);
    expect(last?.info.when).toBe(T0 + 60_000);
  });
});
