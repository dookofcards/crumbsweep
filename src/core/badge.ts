import { domainForUrl } from "./domain.ts";
import { getDomainStats, getStats } from "./cleaner.ts";
import { getPauseState } from "../shared/pause.ts";
import { getSettings } from "../shared/settings.ts";

const ACCENT = "#d97706";
const PAUSED_GREY = "#6b7280";

function format(count: number): string {
  if (count <= 0) return "";
  if (count > 999) return `${Math.floor(count / 1000)}k+`;
  return String(count);
}

/** Recomputes the toolbar badge from settings, pause state, and stats. */
export async function updateBadge(): Promise<void> {
  const pause = await getPauseState();
  if (pause.paused) {
    await chrome.action.setBadgeBackgroundColor({ color: PAUSED_GREY });
    await chrome.action.setBadgeText({ text: "II" });
    return;
  }
  const settings = await getSettings();
  let text = "";
  if (settings.badgeMode === "today") {
    text = format((await getStats()).today);
  } else if (settings.badgeMode === "site") {
    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    const domain = domainForUrl(tab?.url);
    if (domain !== null) {
      text = format((await getDomainStats())[domain] ?? 0);
    }
  }
  await chrome.action.setBadgeBackgroundColor({ color: ACCENT });
  await chrome.action.setBadgeText({ text });
}
