import { describe, expect, it } from "vitest";
import {
  answerReviewPrompt,
  noteSweep,
  shouldShowReviewPrompt,
} from "../src/core/reviewPrompt.ts";

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_000_000_000_000;

async function sweeps(n: number, now: number) {
  for (let i = 0; i < n; i++) await noteSweep(now);
}

describe("review prompt", () => {
  it("is hidden on first sight, even after many sweeps", async () => {
    expect(await shouldShowReviewPrompt(T0)).toBe(false);
    await sweeps(30, T0);
    expect(await shouldShowReviewPrompt(T0)).toBe(false);
  });

  it("needs both 7 days and 20 sweeps", async () => {
    await shouldShowReviewPrompt(T0);
    await sweeps(19, T0);
    expect(await shouldShowReviewPrompt(T0 + 8 * DAY)).toBe(false);
    await sweeps(1, T0);
    expect(await shouldShowReviewPrompt(T0 + 6 * DAY)).toBe(false);
    expect(await shouldShowReviewPrompt(T0 + 8 * DAY)).toBe(true);
  });

  it("'Don't ask again' is permanent", async () => {
    await shouldShowReviewPrompt(T0);
    await sweeps(20, T0);
    await answerReviewPrompt("never", T0 + 8 * DAY);
    expect(await shouldShowReviewPrompt(T0 + 400 * DAY)).toBe(false);
  });

  it("'Not now' asks once more after 30 days, then stops", async () => {
    await shouldShowReviewPrompt(T0);
    await sweeps(20, T0);
    const t = T0 + 8 * DAY;
    await answerReviewPrompt("later", t);
    expect(await shouldShowReviewPrompt(t + 29 * DAY)).toBe(false);
    expect(await shouldShowReviewPrompt(t + 31 * DAY)).toBe(true);
    await answerReviewPrompt("later", t + 31 * DAY);
    expect(await shouldShowReviewPrompt(t + 400 * DAY)).toBe(false);
  });

  it("'Leave a review' is shown only once", async () => {
    await shouldShowReviewPrompt(T0);
    await sweeps(20, T0);
    await answerReviewPrompt("review", T0 + 8 * DAY);
    expect(await shouldShowReviewPrompt(T0 + 100 * DAY)).toBe(false);
  });
});
