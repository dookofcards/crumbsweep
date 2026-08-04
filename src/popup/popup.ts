import { domainForUrl } from "../core/domain.ts";
import { getStats } from "../core/cleaner.ts";
import { getHistory } from "../core/history.ts";
import {
  listStatusFor,
  setListMembership,
  type ListType,
} from "../core/lists.ts";
import { EXTENSION_NAME } from "../shared/constants.ts";
import type {
  CleanDomainNowMessage,
  CleanNowResponse,
  SetPauseMessage,
} from "../shared/messages.ts";
import { getPauseState, type PauseUntil } from "../shared/pause.ts";

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const el = {
  name: $("ext-name"),
  domain: $("site-domain"),
  status: $("site-status"),
  actions: $("site-actions"),
  noSite: $("no-site"),
  btnWhite: $<HTMLButtonElement>("btn-white"),
  btnGrey: $<HTMLButtonElement>("btn-grey"),
  btnClean: $<HTMLButtonElement>("btn-clean"),
  btnSettings: $("btn-settings"),
  feedback: $("feedback"),
  statToday: $("stat-today"),
  statTotal: $("stat-total"),
  recentCard: $("recent-card"),
  recentList: $<HTMLUListElement>("recent-list"),
  pauseActive: $("pause-active"),
  pauseStatus: $("pause-status"),
  pauseButtons: $("pause-buttons"),
  pauseResume: $<HTMLButtonElement>("pause-resume"),
  pause15: $<HTMLButtonElement>("pause-15"),
  pause60: $<HTMLButtonElement>("pause-60"),
  pauseInf: $<HTMLButtonElement>("pause-inf"),
};

let currentDomain: string | null = null;

async function activeTabDomain(): Promise<string | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return domainForUrl(tab?.pendingUrl || tab?.url);
}

function renderStatus(status: ListType | null): void {
  el.status.hidden = false;
  el.status.classList.remove("white", "grey", "none");
  if (status === "white") {
    el.status.textContent = "Protected";
    el.status.classList.add("white");
  } else if (status === "grey") {
    el.status.textContent = "Until restart";
    el.status.classList.add("grey");
  } else {
    el.status.textContent = "Will be cleaned";
    el.status.classList.add("none");
  }
  el.btnWhite.textContent =
    status === "white" ? "✓ Whitelisted — click to remove" : "Whitelist this site";
  el.btnGrey.textContent =
    status === "grey"
      ? "✓ Greylisted — click to remove"
      : "Greylist this site (until restart)";
  el.btnWhite.classList.toggle("active", status === "white");
  el.btnGrey.classList.toggle("active", status === "grey");
}

async function refreshSite(): Promise<void> {
  if (currentDomain === null) {
    el.domain.textContent = "No site";
    el.status.hidden = true;
    el.actions.hidden = true;
    el.noSite.hidden = false;
    return;
  }
  el.domain.textContent = currentDomain;
  el.noSite.hidden = true;
  el.actions.hidden = false;
  renderStatus(await listStatusFor(currentDomain));
}

async function refreshStats(): Promise<void> {
  const stats = await getStats();
  el.statToday.textContent = String(stats.today);
  el.statTotal.textContent = String(stats.total);
}

function relativeTime(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

async function refreshRecent(): Promise<void> {
  const recent = (await getHistory()).slice(0, 3);
  el.recentCard.hidden = recent.length === 0;
  el.recentList.replaceChildren();
  for (const record of recent) {
    const li = document.createElement("li");
    const site = document.createElement("span");
    site.className = "site";
    site.textContent = record.domain ?? "All sites";
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = `${record.count} · ${relativeTime(record.at)}`;
    li.append(site, count);
    el.recentList.append(li);
  }
}

function showFeedback(text: string): void {
  el.feedback.textContent = text;
  el.feedback.hidden = false;
}

async function toggleList(type: ListType): Promise<void> {
  if (currentDomain === null) return;
  const current = await listStatusFor(currentDomain);
  await setListMembership(currentDomain, current === type ? null : type);
  await refreshSite();
}

el.btnWhite.addEventListener("click", () => void toggleList("white"));
el.btnGrey.addEventListener("click", () => void toggleList("grey"));

el.btnClean.addEventListener("click", async () => {
  if (currentDomain === null) return;
  el.btnClean.disabled = true;
  const message: CleanDomainNowMessage = {
    type: "cleanDomainNow",
    domain: currentDomain,
  };
  const response: CleanNowResponse = await chrome.runtime.sendMessage(message);
  showFeedback(
    `Removed ${response.removed} cookie${response.removed === 1 ? "" : "s"} for ${currentDomain}.`,
  );
  el.btnClean.disabled = false;
  await Promise.all([refreshStats(), refreshRecent()]);
});

el.btnSettings.addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});

async function refreshPause(): Promise<void> {
  const state = await getPauseState();
  el.pauseActive.hidden = !state.paused;
  el.pauseButtons.hidden = state.paused;
  if (state.paused) {
    el.pauseStatus.textContent =
      state.until === "indefinite"
        ? "Auto-clean paused until you resume."
        : `Auto-clean paused until ${new Date(state.until as number).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`;
  }
}

async function setPause(until: PauseUntil | null): Promise<void> {
  const message: SetPauseMessage = { type: "setPause", until };
  await chrome.runtime.sendMessage(message);
  await refreshPause();
}

el.pause15.addEventListener("click", () =>
  void setPause(Date.now() + 15 * 60_000),
);
el.pause60.addEventListener("click", () =>
  void setPause(Date.now() + 60 * 60_000),
);
el.pauseInf.addEventListener("click", () => void setPause("indefinite"));
el.pauseResume.addEventListener("click", () => void setPause(null));

async function init(): Promise<void> {
  el.name.textContent = EXTENSION_NAME;
  currentDomain = await activeTabDomain();
  await Promise.all([
    refreshSite(),
    refreshStats(),
    refreshPause(),
    refreshRecent(),
  ]);
}

void init();
