import {
  exportListsJson,
  mergeIntoLists,
  parseImport,
} from "../core/importExport.ts";
import {
  clearHistory,
  getHistory,
  summarize as summarizeSweeps,
  type SweepRecord,
} from "../core/history.ts";
import {
  getLists,
  normalizeEntry,
  setListMembership,
  type ListType,
} from "../core/lists.ts";
import { getRestorable } from "../core/undo.ts";
import { hasFeature } from "../shared/features.ts";
import {
  EXTENSION_NAME,
  HOMEPAGE_URL,
  STORE_REVIEW_URL,
  SUPPORT_URL,
} from "../shared/constants.ts";
import type {
  CleanAllExceptWhitelistMessage,
  CleanNowResponse,
  UndoSweepMessage,
  UndoSweepResponse,
} from "../shared/messages.ts";
import { getSettings, updateSettings, type Settings } from "../shared/settings.ts";

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const el = {
  name: $("ext-name"),
  saveIndicator: $("save-indicator"),
  graceSlider: $<HTMLInputElement>("grace-slider"),
  graceValue: $<HTMLOutputElement>("grace-value"),
  optLocalStorage: $<HTMLInputElement>("opt-localstorage"),
  optIndexedDB: $<HTMLInputElement>("opt-indexeddb"),
  optCache: $<HTMLInputElement>("opt-cache"),
  optServiceWorkers: $<HTMLInputElement>("opt-serviceworkers"),
  optNotify: $<HTMLInputElement>("opt-notify"),
  whiteForm: $<HTMLFormElement>("white-form"),
  whiteInput: $<HTMLInputElement>("white-input"),
  whiteList: $<HTMLUListElement>("white-list"),
  greyForm: $<HTMLFormElement>("grey-form"),
  greyInput: $<HTMLInputElement>("grey-input"),
  greyList: $<HTMLUListElement>("grey-list"),
  btnCleanAll: $<HTMLButtonElement>("btn-clean-all"),
  cleanAllResult: $("clean-all-result"),
  btnImport: $<HTMLButtonElement>("btn-import"),
  btnExport: $<HTMLButtonElement>("btn-export"),
  importFile: $<HTMLInputElement>("import-file"),
  importChoice: $("import-choice"),
  importCount: $("import-count"),
  importToWhite: $<HTMLButtonElement>("import-to-white"),
  importToGrey: $<HTMLButtonElement>("import-to-grey"),
  importCancel: $<HTMLButtonElement>("import-cancel"),
  importResult: $("import-result"),
  activitySummary: $("activity-summary"),
  activitySources: $<HTMLUListElement>("activity-sources"),
  activityLog: $("activity-log"),
  btnClearHistory: $<HTMLButtonElement>("btn-clear-history"),
  version: $("version"),
  linkHome: $<HTMLAnchorElement>("link-home"),
  linkRate: $<HTMLAnchorElement>("link-rate"),
  linkSupport: $<HTMLAnchorElement>("link-support"),
};

let saveFlashTimer: ReturnType<typeof setTimeout> | undefined;

function flashSaved(): void {
  el.saveIndicator.hidden = false;
  if (saveFlashTimer) clearTimeout(saveFlashTimer);
  saveFlashTimer = setTimeout(() => (el.saveIndicator.hidden = true), 1500);
}

async function save(patch: Partial<Settings>): Promise<void> {
  await updateSettings(patch);
  flashSaved();
}

function formatGrace(seconds: number): string {
  return seconds === 0 ? "immediately" : `${seconds} s`;
}

function bindCheckbox(
  input: HTMLInputElement,
  key: keyof Pick<
    Settings,
    "cleanLocalStorage" | "cleanIndexedDB" | "cleanCache" | "cleanServiceWorkers"
  >,
): void {
  input.addEventListener("change", () => void save({ [key]: input.checked }));
}

// --- lists ---

function renderList(ul: HTMLUListElement, type: ListType, domains: string[]) {
  ul.replaceChildren();
  if (domains.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No sites yet.";
    ul.append(li);
    return;
  }
  for (const domain of domains) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = domain;
    const remove = document.createElement("button");
    remove.className = "remove-btn";
    remove.textContent = "×";
    remove.title = `Remove ${domain}`;
    remove.addEventListener("click", async () => {
      await setListMembership(domain, null);
      await refreshLists();
      flashSaved();
    });
    li.append(span, remove);
    ul.append(li);
  }
}

async function refreshLists(): Promise<void> {
  const lists = await getLists();
  renderList(el.whiteList, "white", lists.white);
  renderList(el.greyList, "grey", lists.grey);
}

function bindAddForm(
  form: HTMLFormElement,
  input: HTMLInputElement,
  type: ListType,
): void {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const domain = normalizeEntry(input.value);
    if (!domain) return;
    await setListMembership(domain, type);
    input.value = "";
    await refreshLists();
    flashSaved();
  });
}

// --- notifications (optional permission, requested only when enabled) ---

async function onNotifyToggle(): Promise<void> {
  if (el.optNotify.checked) {
    const granted = await chrome.permissions.request({
      permissions: ["notifications"],
    });
    if (!granted) {
      el.optNotify.checked = false;
      return;
    }
  }
  await save({ notifyOnClean: el.optNotify.checked });
}

// --- import / export ---

let pendingDomains: string[] = [];

function showImportResult(text: string): void {
  el.importResult.textContent = text;
  el.importResult.hidden = false;
}

function summarize(added: { addedWhite: number; addedGrey: number }, skipped: number): string {
  const parts = [
    `Added ${added.addedWhite} to whitelist, ${added.addedGrey} to greylist.`,
  ];
  if (skipped > 0) parts.push(`Skipped ${skipped} unusable entr${skipped === 1 ? "y" : "ies"}.`);
  return parts.join(" ");
}

async function onImportFile(): Promise<void> {
  const file = el.importFile.files?.[0];
  el.importFile.value = ""; // allow re-picking the same file
  el.importChoice.hidden = true;
  el.importResult.hidden = true;
  if (!file) return;
  const parsed = parseImport(await file.text());
  if (parsed.kind === "invalid") {
    showImportResult(
      "Couldn't read that file. Expected a Cookie AutoDelete JSON export, a CrumbSweep JSON export, or one domain per line.",
    );
    return;
  }
  if (parsed.kind === "lists") {
    const added = await mergeIntoLists(parsed.white, parsed.grey);
    await refreshLists();
    showImportResult(summarize(added, parsed.skipped));
    flashSaved();
    return;
  }
  // Plain domain list: user picks the target list.
  pendingDomains = parsed.domains;
  el.importCount.textContent = String(parsed.domains.length);
  el.importChoice.hidden = false;
}

async function finishDomainImport(type: ListType): Promise<void> {
  const domains = pendingDomains;
  pendingDomains = [];
  el.importChoice.hidden = true;
  const added = await mergeIntoLists(
    type === "white" ? domains : [],
    type === "grey" ? domains : [],
  );
  await refreshLists();
  showImportResult(summarize(added, 0));
  flashSaved();
}

async function onExport(): Promise<void> {
  const json = await exportListsJson();
  const url = URL.createObjectURL(
    new Blob([json], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `crumbsweep-lists-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

// --- activity ---

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const TRIGGER_LABEL: Record<SweepRecord["trigger"], string> = {
  "tab-close": "last tab closed",
  manual: "cleaned by hand",
  startup: "greylist, browser start",
  "clean-all": "clean everything",
};

function renderSummary(records: SweepRecord[]): void {
  const week = summarizeSweeps(records, Date.now() - WEEK_MS);
  el.activitySummary.replaceChildren();
  if (week.cookies === 0) {
    el.activitySummary.textContent =
      "Nothing swept in the last 7 days. Close a site's last tab and it will show up here.";
    return;
  }
  const big = document.createElement("span");
  big.className = "big";
  big.textContent = week.cookies.toLocaleString();
  const tail = document.createTextNode(
    ` cookies swept in the last 7 days, across ${week.sites} site${
      week.sites === 1 ? "" : "s"
    }${
      week.thirdPartyCookies > 0
        ? ` — ${week.thirdPartyCookies.toLocaleString()} of them set by somewhere else.`
        : "."
    }`,
  );
  el.activitySummary.append(big, tail);
}

function renderSources(records: SweepRecord[]): void {
  const week = summarizeSweeps(records, Date.now() - WEEK_MS);
  el.activitySources.replaceChildren();
  const max = week.topSources[0]?.count ?? 0;
  for (const source of week.topSources) {
    const li = document.createElement("li");
    if (source.thirdParty) li.className = "third-party";
    const bar = document.createElement("span");
    bar.className = "bar";
    bar.style.width = `${Math.round((source.count / max) * 90)}px`;
    const host = document.createElement("span");
    host.className = "host";
    host.textContent = source.host;
    if (source.thirdParty) host.title = "Set by a different site than the one you visited";
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = String(source.count);
    li.append(bar, host, count);
    el.activitySources.append(li);
  }
}

function dayLabel(at: number): string {
  const date = new Date(at);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

async function undoFromLog(sweepId: string, button: HTMLButtonElement) {
  button.disabled = true;
  const message: UndoSweepMessage = { type: "undoSweep", sweepId };
  const result: UndoSweepResponse = await chrome.runtime.sendMessage(message);
  button.textContent = result.available
    ? `Put back ${result.restored}`
    : "Expired";
  await refreshActivity();
}

/**
 * Free tier restores the most recent sweep; older ones are pro. The button is
 * shown either way so the limit is visible rather than hidden.
 */
function undoButton(
  record: SweepRecord,
  restorable: Map<string, number>,
  newestId: string | undefined,
): HTMLButtonElement | null {
  const count = restorable.get(record.id);
  if (count === undefined) return null;
  const button = document.createElement("button");
  button.className = "undo-inline";
  const isNewest = record.id === newestId;
  if (isNewest || hasFeature("historyRestore")) {
    button.textContent = `Put back ${count}`;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      void undoFromLog(record.id, button);
    });
  } else {
    button.textContent = "Put back";
    button.disabled = true;
    button.title =
      "Restoring older sweeps is a Pro feature. The most recent sweep can always be undone.";
  }
  return button;
}

function renderRecord(
  record: SweepRecord,
  restorable: Map<string, number>,
  newestId: string | undefined,
): HTMLElement {
  const details = document.createElement("details");
  const summary = document.createElement("summary");

  const site = document.createElement("span");
  site.className = "site";
  site.textContent = record.domain ?? "Every site except the whitelist";

  const meta = document.createElement("span");
  meta.className = "meta";
  const time = new Date(record.at).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  meta.textContent = `${record.count} · ${time}`;
  meta.title = TRIGGER_LABEL[record.trigger];

  const row = document.createElement("span");
  row.className = "row";
  row.append(site, meta);
  summary.append(row);
  details.append(summary);

  const names = document.createElement("ul");
  names.className = "names";
  for (const cookie of record.cookies) {
    const li = document.createElement("li");
    li.textContent = cookie.name;
    if (cookie.thirdParty) {
      li.className = "tp";
      li.textContent = `${cookie.name} — ${cookie.host}`;
    }
    names.append(li);
  }
  if (record.count > record.cookies.length) {
    const li = document.createElement("li");
    li.textContent = `…and ${record.count - record.cookies.length} more`;
    names.append(li);
  }
  const trigger = document.createElement("li");
  trigger.textContent = TRIGGER_LABEL[record.trigger];
  trigger.style.opacity = "0.6";
  names.append(trigger);
  details.append(names);

  const undo = undoButton(record, restorable, newestId);
  if (undo !== null) {
    const row = document.createElement("p");
    row.className = "undo-row";
    const note = document.createElement("span");
    note.textContent = "Cookies still in memory — restorable for 10 minutes.";
    row.append(undo, note);
    details.append(row);
  }
  return details;
}

function renderLog(
  records: SweepRecord[],
  restorable: Map<string, number>,
  newestId: string | undefined,
): void {
  el.activityLog.replaceChildren();
  if (records.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No sweeps recorded yet.";
    el.activityLog.append(empty);
    return;
  }
  let currentDay = "";
  for (const record of records) {
    const label = dayLabel(record.at);
    if (label !== currentDay) {
      currentDay = label;
      const heading = document.createElement("p");
      heading.className = "day";
      heading.textContent = label;
      el.activityLog.append(heading);
    }
    el.activityLog.append(renderRecord(record, restorable, newestId));
  }
}

async function refreshActivity(): Promise<void> {
  const [records, restorableList] = await Promise.all([
    getHistory(),
    getRestorable(),
  ]);
  const restorable = new Map(
    restorableList.map((entry) => [entry.sweepId, entry.count]),
  );
  renderSummary(records);
  renderSources(records);
  renderLog(records, restorable, restorableList[0]?.sweepId);
}

// --- clean everything ---

async function onCleanAll(): Promise<void> {
  const confirmed = window.confirm(
    "Delete cookies for ALL sites except your whitelist? Greylisted sites are cleaned too. This logs you out of most sites.",
  );
  if (!confirmed) return;
  el.btnCleanAll.disabled = true;
  const message: CleanAllExceptWhitelistMessage = {
    type: "cleanAllExceptWhitelist",
  };
  const response: CleanNowResponse = await chrome.runtime.sendMessage(message);
  el.btnCleanAll.disabled = false;
  el.cleanAllResult.hidden = false;
  el.cleanAllResult.textContent = `Removed ${response.removed} cookie${
    response.removed === 1 ? "" : "s"
  }.`;
  await refreshActivity();
}

// --- init ---

async function init(): Promise<void> {
  el.name.textContent = EXTENSION_NAME;
  document.title = `${EXTENSION_NAME} Settings`;
  el.version.textContent = `${EXTENSION_NAME} ${chrome.runtime.getManifest().version}`;
  el.linkHome.href = HOMEPAGE_URL;
  el.linkRate.href = STORE_REVIEW_URL;
  el.linkSupport.href = SUPPORT_URL;

  const settings = await getSettings();
  el.graceSlider.value = String(settings.gracePeriodSeconds);
  el.graceValue.textContent = formatGrace(settings.gracePeriodSeconds);
  el.optLocalStorage.checked = settings.cleanLocalStorage;
  el.optIndexedDB.checked = settings.cleanIndexedDB;
  el.optCache.checked = settings.cleanCache;
  el.optServiceWorkers.checked = settings.cleanServiceWorkers;
  el.optNotify.checked = settings.notifyOnClean;

  el.graceSlider.addEventListener("input", () => {
    el.graceValue.textContent = formatGrace(Number(el.graceSlider.value));
  });
  el.graceSlider.addEventListener("change", () =>
    void save({ gracePeriodSeconds: Number(el.graceSlider.value) }),
  );

  bindCheckbox(el.optLocalStorage, "cleanLocalStorage");
  bindCheckbox(el.optIndexedDB, "cleanIndexedDB");
  bindCheckbox(el.optCache, "cleanCache");
  bindCheckbox(el.optServiceWorkers, "cleanServiceWorkers");
  el.optNotify.addEventListener("change", () => void onNotifyToggle());

  const badgeRadios = document.querySelectorAll<HTMLInputElement>(
    'input[name="badge-mode"]',
  );
  for (const radio of badgeRadios) {
    radio.checked = radio.value === settings.badgeMode;
    radio.addEventListener("change", () => {
      if (radio.checked) {
        void save({ badgeMode: radio.value as Settings["badgeMode"] });
      }
    });
  }

  bindAddForm(el.whiteForm, el.whiteInput, "white");
  bindAddForm(el.greyForm, el.greyInput, "grey");
  await refreshLists();
  await refreshActivity();

  el.btnClearHistory.addEventListener("click", async () => {
    await clearHistory();
    await refreshActivity();
    flashSaved();
  });

  el.btnCleanAll.addEventListener("click", () => void onCleanAll());

  el.btnImport.addEventListener("click", () => el.importFile.click());
  el.importFile.addEventListener("change", () => void onImportFile());
  el.importToWhite.addEventListener("click", () => void finishDomainImport("white"));
  el.importToGrey.addEventListener("click", () => void finishDomainImport("grey"));
  el.importCancel.addEventListener("click", () => {
    pendingDomains = [];
    el.importChoice.hidden = true;
  });
  el.btnExport.addEventListener("click", () => void onExport());
}

void init();
