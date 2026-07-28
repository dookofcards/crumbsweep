// Global pause for auto-cleaning. Persisted in storage.local; expiry is
// checked lazily on read, so no alarm is needed to un-pause.
const PAUSE_KEY = "pauseState";

export type PauseUntil = number | "indefinite"; // epoch ms, or manual resume

export interface PauseState {
  paused: boolean;
  until: PauseUntil | null;
}

export async function getPauseState(): Promise<PauseState> {
  const stored = await chrome.storage.local.get(PAUSE_KEY);
  const until = (stored[PAUSE_KEY] as PauseUntil | undefined) ?? null;
  if (until === null) return { paused: false, until: null };
  if (until !== "indefinite" && Date.now() >= until) {
    await chrome.storage.local.remove(PAUSE_KEY);
    return { paused: false, until: null };
  }
  return { paused: true, until };
}

export async function setPauseUntil(until: PauseUntil | null): Promise<void> {
  if (until === null) await chrome.storage.local.remove(PAUSE_KEY);
  else await chrome.storage.local.set({ [PAUSE_KEY]: until });
}
