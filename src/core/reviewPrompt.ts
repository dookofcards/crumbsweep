// One-time, in-popup invitation to review the extension.
//
// Rules (Chrome Web Store forbids incentivised reviews): shown only after
// real use, never on install/update, never a notification or dialog, never
// tied to any reward, and shown to every eligible user alike. All state is
// local; nothing here touches the network.
const KEY = "reviewPrompt";

export const MIN_DAYS_INSTALLED = 7;
export const MIN_SWEEPS = 20;
export const ASK_AGAIN_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReviewState {
  installedAt: number;
  sweeps: number;
  /** "later": deferred once. "done": reviewed, declined twice, or never ask again. */
  status: "pending" | "later" | "done";
  /** Earliest time a "later" prompt may reappear. */
  askAfter?: number;
}

async function load(now: number): Promise<ReviewState> {
  const stored = await chrome.storage.local.get(KEY);
  const saved = stored[KEY] as ReviewState | undefined;
  // Existing users have no install date: start counting from first sight.
  return saved ?? { installedAt: now, sweeps: 0, status: "pending" };
}

async function save(state: ReviewState): Promise<void> {
  await chrome.storage.local.set({ [KEY]: state });
}

/** Call once per sweep that removed cookies. */
export async function noteSweep(now = Date.now()): Promise<void> {
  const state = await load(now);
  state.sweeps += 1;
  await save(state);
}

export async function shouldShowReviewPrompt(now = Date.now()): Promise<boolean> {
  const state = await load(now);
  // Persist the install date the first time we see it.
  const stored = await chrome.storage.local.get(KEY);
  if (stored[KEY] === undefined) await save(state);
  if (state.status === "done") return false;
  if (now - state.installedAt < MIN_DAYS_INSTALLED * DAY_MS) return false;
  if (state.sweeps < MIN_SWEEPS) return false;
  if (state.status === "later") return now >= (state.askAfter ?? 0);
  return true;
}

export type ReviewAnswer = "review" | "later" | "never";

export async function answerReviewPrompt(
  answer: ReviewAnswer,
  now = Date.now(),
): Promise<void> {
  const state = await load(now);
  // "Not now" defers once; a second "Not now" is treated as a final no.
  if (answer === "later" && state.status !== "later") {
    state.status = "later";
    state.askAfter = now + ASK_AGAIN_DAYS * DAY_MS;
  } else {
    state.status = "done";
    delete state.askAfter;
  }
  await save(state);
}
