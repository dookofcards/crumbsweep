// The service worker can be killed at any time, so no state may survive in
// module scope between events: every handler re-reads from chrome.storage,
// and mutations are serialized to avoid interleaved read-modify-write.
import * as tracker from "../core/tabTracker.ts";
import * as queue from "../core/cleanupQueue.ts";
import { cleanAllCookiesExcept, cleanDomainFull } from "../core/cleaner.ts";
import { getLists, listStatusFor } from "../core/lists.ts";
import { updateBadge } from "../core/badge.ts";
import { EXTENSION_NAME } from "../shared/constants.ts";
import { getSettings } from "../shared/settings.ts";
import { getPauseState, setPauseUntil } from "../shared/pause.ts";
import {
  beginUpgrade,
  revalidateEntitlement,
  startPaymentBackground,
} from "./payment.ts";
import { armSchedule, DEEP_CLEAN_ALARM, runIfDue } from "../core/schedule.ts";
import { restoreSweep } from "../core/undo.ts";
import { hasFeature } from "../shared/features.ts";
import type {
  Message,
  BeginUpgradeResponse,
  CleanNowResponse,
  UndoSweepResponse,
} from "../shared/messages.ts";
import { serialized } from "../shared/lock.ts";

const trackerEvents: tracker.TrackerEvents = {
  domainEmptied: async (domain) => {
    // While paused, tab closes don't even enqueue — resuming later must not
    // retroactively clean sites that were closed during the pause.
    if ((await getPauseState()).paused) return;
    const settings = await getSettings();
    await queue.enqueue(domain, settings.gracePeriodSeconds * 1000);
  },
  domainActive: (domain) => queue.cancel(domain),
};

async function notifyCleaned(domain: string, removed: number): Promise<void> {
  const settings = await getSettings();
  if (!settings.notifyOnClean || chrome.notifications === undefined) return;
  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: EXTENSION_NAME,
      message: `Cleaned ${removed} cookie${removed === 1 ? "" : "s"} for ${domain}`,
    });
  } catch {
    // permission revoked since the setting was enabled — never fail a clean over a toast
  }
}

// Final gate before deletion. The open-tab re-check also enforces the
// pinned-tab exemption: a pinned tab is an open tab, so its domain can
// never reach this point while pinned.
async function executeClean(domain: string): Promise<void> {
  if ((await getPauseState()).paused) return;
  if (await tracker.domainHasOpenTabs(domain)) return;
  // Whitelisted: never clean. Greylisted: not on tab close — that list's
  // contract is "clean on browser restart" (see onStartup below).
  if ((await listStatusFor(domain)) !== null) return;
  const removed = await cleanDomainFull(
    domain,
    await tracker.takeSeenOrigins(domain),
    "tab-close",
  );
  if (removed > 0) await notifyCleaned(domain, removed);
  await updateBadge();
}

const processQueue = () =>
  serialized(() => queue.processDue(executeClean));
queue.setProcessor(processQueue);

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id === undefined) return;
  const id = tab.id;
  serialized(() =>
    tracker.updateTab(id, tab.pendingUrl || tab.url, trackerEvents),
  );
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url === undefined) return;
  serialized(() => tracker.updateTab(tabId, changeInfo.url, trackerEvents)).then(
    updateBadge,
  );
});

chrome.tabs.onRemoved.addListener((tabId) => {
  serialized(() => tracker.removeTab(tabId, trackerEvents));
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  serialized(() => tracker.replaceTab(addedTabId, removedTabId, trackerEvents));
});

chrome.tabs.onActivated.addListener(() => void updateBadge());

// Settings changes (badge mode, from the options page) should reflect on the
// badge immediately. updateBadge only reads, so this can't loop.
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "sync") void updateBadge();
});

async function deepCleanAllExceptWhitelist(): Promise<void> {
  const lists = await getLists();
  await cleanAllCookiesExcept(new Set(lists.white));
  await updateBadge();
}

/** Honours the pause: a paused extension must not sweep on a timer either. */
async function processSchedule(): Promise<void> {
  if (!(await hasFeature("scheduledDeepCleans"))) return;
  if ((await getPauseState()).paused) return;
  const settings = await getSettings();
  await runIfDue(settings.deepCleanSchedule, deepCleanAllExceptWhitelist);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === queue.CLEANUP_ALARM) processQueue();
  if (alarm.name === DEEP_CLEAN_ALARM) {
    serialized(processSchedule);
  }
});

// Re-arm whenever the schedule setting changes, and keep the alarm in step
// with an entitlement that may have lapsed.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !("settings" in changes)) return;
  serialized(async () => {
    const settings = await getSettings();
    await armSchedule(
      (await hasFeature("scheduledDeepCleans"))
        ? settings.deepCleanSchedule
        : "off",
    );
  });
});

chrome.runtime.onMessage.addListener(
  (message: Message, _sender, sendResponse) => {
    // Popup "clean now": explicit user action — cleans immediately, ignoring
    // open tabs and list membership.
    if (message.type === "cleanDomainNow") {
      serialized(async () =>
        cleanDomainFull(
          message.domain,
          await tracker.takeSeenOrigins(message.domain),
          "manual",
        ),
      ).then(async (removed) => {
        await updateBadge();
        const response: CleanNowResponse = { removed };
        sendResponse(response);
      });
      return true; // async response
    }
    if (message.type === "cleanAllExceptWhitelist") {
      serialized(async () => {
        const lists = await getLists();
        return cleanAllCookiesExcept(new Set(lists.white));
      }).then(async (removed) => {
        await updateBadge();
        const response: CleanNowResponse = { removed };
        sendResponse(response);
      });
      return true;
    }
    // Serialized with cleans: an undo racing a sweep of the same domain would
    // otherwise restore cookies that are about to be deleted, or vice versa.
    if (message.type === "undoSweep") {
      serialized(() => restoreSweep(message.sweepId)).then((result) => {
        const response: UndoSweepResponse = result;
        sendResponse(response);
      });
      return true;
    }
    if (message.type === "beginUpgrade") {
      beginUpgrade().then((started) => {
        const response: BeginUpgradeResponse = { started };
        sendResponse(response);
      });
      return true;
    }
    if (message.type === "setPause") {
      serialized(async () => {
        await setPauseUntil(message.until);
        // Pausing freezes everything already counting down.
        if (message.until !== null) await queue.clearAll();
        await updateBadge();
      }).then(() => sendResponse({ ok: true }));
      return true;
    }
    return undefined;
  },
);

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    void chrome.tabs.create({
      url: chrome.runtime.getURL("onboarding/onboarding.html"),
    });
  }
});

// The greylist contract: session-only trust, cleaned when the browser
// starts (not when tabs close).
chrome.runtime.onStartup.addListener(() => {
  serialized(async () => {
    if ((await getPauseState()).paused) return;
    const lists = await getLists();
    for (const domain of lists.grey) {
      await cleanDomainFull(
        domain,
        await tracker.takeSeenOrigins(domain),
        "startup",
      );
    }
  }).then(updateBadge);
});

// Runs on every SW start (install, browser start, wake-after-kill): rebuild
// tab state from reality, then settle anything already due — this is what
// makes a countdown survive the SW being killed mid-grace-period.
serialized(() => tracker.rebuild(trackerEvents))
  .then(processQueue)
  .then(updateBadge)
  // A periodic alarm survives SW death but not an extension update, and the
  // browser may have been closed when a clean came due — so re-arm and
  // re-check on every start rather than only on the alarm.
  .then(async () => {
    const settings = await getSettings();
    const unlocked = await hasFeature("scheduledDeepCleans");
    await armSchedule(unlocked ? settings.deepCleanSchedule : "off");
    await processSchedule();
    // Both are no-ops until the user has started a purchase, so a free user's
    // service worker still opens no connections.
    await startPaymentBackground();
    await revalidateEntitlement();
  });
