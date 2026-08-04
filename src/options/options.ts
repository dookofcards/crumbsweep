import {
  exportListsJson,
  mergeIntoLists,
  parseImport,
} from "../core/importExport.ts";
import {
  getLists,
  normalizeEntry,
  setListMembership,
  type ListType,
} from "../core/lists.ts";
import {
  EXTENSION_NAME,
  HOMEPAGE_URL,
  STORE_REVIEW_URL,
  SUPPORT_URL,
} from "../shared/constants.ts";
import type {
  CleanAllExceptWhitelistMessage,
  CleanNowResponse,
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
