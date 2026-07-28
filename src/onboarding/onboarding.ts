import { domainForUrl } from "../core/domain.ts";
import { mergeIntoLists, parseImport } from "../core/importExport.ts";
import {
  getLists,
  normalizeEntry,
  setListMembership,
} from "../core/lists.ts";
import { EXTENSION_NAME } from "../shared/constants.ts";
import { getSettings } from "../shared/settings.ts";

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const el = {
  name: $("ext-name"),
  openSites: $("open-sites"),
  addForm: $<HTMLFormElement>("add-form"),
  addInput: $<HTMLInputElement>("add-input"),
  btnImport: $<HTMLButtonElement>("btn-import"),
  importFile: $<HTMLInputElement>("import-file"),
  importResult: $("import-result"),
  btnSettings: $<HTMLButtonElement>("btn-settings"),
  graceText: $("grace-text"),
};

async function openDomains(): Promise<string[]> {
  const tabs = await chrome.tabs.query({});
  const domains = new Set<string>();
  for (const tab of tabs) {
    const domain = domainForUrl(tab.url);
    if (domain !== null) domains.add(domain);
  }
  return [...domains].sort();
}

function renderChip(domain: string, whitelisted: boolean): HTMLButtonElement {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "chip";
  const update = (isOn: boolean) => {
    chip.classList.toggle("protected", isOn);
    chip.textContent = isOn ? `✓ ${domain}` : `+ ${domain}`;
    chip.title = isOn
      ? `${domain} is whitelisted — click to undo`
      : `Whitelist ${domain}`;
  };
  update(whitelisted);
  chip.addEventListener("click", async () => {
    const on = chip.classList.contains("protected");
    await setListMembership(domain, on ? null : "white");
    update(!on);
  });
  return chip;
}

async function renderOpenSites(): Promise<void> {
  const [domains, lists] = await Promise.all([openDomains(), getLists()]);
  el.openSites.replaceChildren();
  if (domains.length === 0) {
    const span = document.createElement("span");
    span.className = "empty";
    span.textContent = "No sites open right now — add some below.";
    el.openSites.append(span);
    return;
  }
  for (const domain of domains) {
    el.openSites.append(renderChip(domain, lists.white.includes(domain)));
  }
}

el.addForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const domain = normalizeEntry(el.addInput.value);
  if (domain === null) return;
  await setListMembership(domain, "white");
  el.addInput.value = "";
  el.openSites.append(renderChip(domain, true));
});

el.btnImport.addEventListener("click", () => el.importFile.click());

el.importFile.addEventListener("change", async () => {
  const file = el.importFile.files?.[0];
  el.importFile.value = "";
  if (!file) return;
  const parsed = parseImport(await file.text());
  el.importResult.hidden = false;
  if (parsed.kind === "invalid") {
    el.importResult.textContent =
      "Couldn't read that file. Expected a Cookie AutoDelete JSON export or one domain per line.";
    return;
  }
  const added =
    parsed.kind === "lists"
      ? await mergeIntoLists(parsed.white, parsed.grey)
      : await mergeIntoLists(parsed.domains, []); // plain text → whitelist
  el.importResult.textContent = `Done — added ${added.addedWhite} to your whitelist and ${added.addedGrey} to your greylist.`;
  await renderOpenSites(); // chips may now be protected
});

el.btnSettings.addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});

async function init(): Promise<void> {
  el.name.textContent = EXTENSION_NAME;
  document.title = `Welcome to ${EXTENSION_NAME}`;
  const settings = await getSettings();
  el.graceText.textContent = `${settings.gracePeriodSeconds} seconds`;
  await renderOpenSites();
}

void init();
