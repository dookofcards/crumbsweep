import {
  DEFAULT_GRACE_PERIOD_SECONDS,
  MAX_GRACE_PERIOD_SECONDS,
  MIN_GRACE_PERIOD_SECONDS,
} from "./constants.ts";

const SETTINGS_KEY = "settings";

export interface Settings {
  gracePeriodSeconds: number;
  /** Cookies are always cleaned; these extra types are opt-in because
   *  chrome.browsingData is origin-coarse (see brief §3.5). */
  cleanLocalStorage: boolean;
  cleanIndexedDB: boolean;
  cleanCache: boolean;
  cleanServiceWorkers: boolean;
  notifyOnClean: boolean;
  /** Toolbar badge counter (wired in step 6). */
  badgeMode: "today" | "site" | "off";
}

// Conservative defaults are a hard product requirement: cookies only,
// nothing else, no notifications.
export const DEFAULT_SETTINGS: Settings = {
  gracePeriodSeconds: DEFAULT_GRACE_PERIOD_SECONDS,
  cleanLocalStorage: false,
  cleanIndexedDB: false,
  cleanCache: false,
  cleanServiceWorkers: false,
  notifyOnClean: false,
  badgeMode: "today",
};

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get(SETTINGS_KEY);
  const saved = (stored[SETTINGS_KEY] as Partial<Settings> | undefined) ?? {};
  const settings = { ...DEFAULT_SETTINGS, ...saved };
  settings.gracePeriodSeconds = Math.min(
    MAX_GRACE_PERIOD_SECONDS,
    Math.max(MIN_GRACE_PERIOD_SECONDS, settings.gracePeriodSeconds),
  );
  return settings;
}

export async function updateSettings(
  patch: Partial<Settings>,
): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.sync.set({ [SETTINGS_KEY]: next });
  return next;
}
