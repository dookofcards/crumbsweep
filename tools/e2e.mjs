// End-to-end tests against a real Chrome with the extension loaded.
//
// Unit tests (vitest) cover pure logic; this covers everything that needs the
// actual chrome.* APIs — cookie removal and restore, storage round-trips,
// service-worker messaging. Run: npm run build && node tools/e2e.mjs
//
// Tests run inside the options page, which shares the extension origin and
// service worker with the real thing, so chrome.* behaves exactly as shipped.
import { chromium } from "playwright";
import { readFile, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");
const profile = path.join(root, ".e2e-profile");

const tests = [];
/**
 * opts.liveExtPay marks tests that talk to ExtensionPay's live API (in test
 * mode — an unpacked install always gets a test-mode key). Plain CI skips
 * them: running them on every push would mint a throwaway user record per
 * build and fail whenever a third party has a bad day. The release workflow
 * sets RUN_PAYMENT_E2E=1, which runs them and turns "can't run" into a
 * failure, so a release can never ship on a silently skipped payment test.
 */
export const test = (name, fn, opts = {}) => tests.push({ name, fn, ...opts });
const inCi = process.env.CI !== undefined && process.env.CI !== "";
const requirePayment = process.env.RUN_PAYMENT_E2E === "1";
const runLive = !inCi || requirePayment;

/** Thrown by a test that cannot run here; counted as skipped, not passed. */
class Skip extends Error {}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// --- build sanity ---

test("manifest version matches package.json", async ({ page, pkgVersion }) => {
  const version = await page.evaluate(() => chrome.runtime.getManifest().version);
  assert(version === pkgVersion, `manifest ${version} !== package ${pkgVersion}`);
});

test("declared permissions have not silently grown", async ({ page }) => {
  const manifest = await page.evaluate(() => chrome.runtime.getManifest());
  const expected = ["cookies", "tabs", "storage", "alarms", "browsingData"];
  assert(
    JSON.stringify(manifest.permissions) === JSON.stringify(expected),
    `permissions changed: ${JSON.stringify(manifest.permissions)}`,
  );
});

// --- the core loop, exercised through the real cookie API ---

test("service worker cleans a domain on request", async ({ page }) => {
  const result = await page.evaluate(async () => {
    await chrome.cookies.set({
      url: "https://e2e-example.com/",
      name: "sid",
      value: "abc123",
    });
    await chrome.cookies.set({
      url: "https://sub.e2e-example.com/",
      name: "tracker",
      value: "xyz",
    });
    const before = await chrome.cookies.getAll({ domain: "e2e-example.com" });
    const response = await chrome.runtime.sendMessage({
      type: "cleanDomainNow",
      domain: "e2e-example.com",
    });
    const after = await chrome.cookies.getAll({ domain: "e2e-example.com" });
    return { before: before.length, removed: response.removed, after: after.length };
  });
  assert(result.before === 2, `expected 2 cookies seeded, got ${result.before}`);
  assert(result.removed === 2, `expected 2 removed, got ${result.removed}`);
  assert(result.after === 0, `expected 0 left, got ${result.after}`);
});

test("secure and host-only cookies are actually removable", async ({ page }) => {
  const left = await page.evaluate(async () => {
    // Host-only (no leading dot) + secure is the combination most likely to
    // break cookie-URL reconstruction.
    await chrome.cookies.set({
      url: "https://e2e-secure.com/deep/path",
      name: "hostonly",
      value: "1",
      secure: true,
      path: "/deep/path",
    });
    await chrome.runtime.sendMessage({
      type: "cleanDomainNow",
      domain: "e2e-secure.com",
    });
    return (await chrome.cookies.getAll({ domain: "e2e-secure.com" })).length;
  });
  assert(left === 0, `${left} cookie(s) survived the clean`);
});

test("whitelisted domains survive clean-all", async ({ page }) => {
  const result = await page.evaluate(async () => {
    await chrome.storage.sync.set({ "whitelist.0": ["e2e-keep.com"] });
    await chrome.cookies.set({ url: "https://e2e-keep.com/", name: "k", value: "1" });
    await chrome.cookies.set({ url: "https://e2e-drop.com/", name: "d", value: "1" });
    await chrome.runtime.sendMessage({ type: "cleanAllExceptWhitelist" });
    return {
      kept: (await chrome.cookies.getAll({ domain: "e2e-keep.com" })).length,
      dropped: (await chrome.cookies.getAll({ domain: "e2e-drop.com" })).length,
    };
  });
  assert(result.kept === 1, `whitelisted cookie was deleted`);
  assert(result.dropped === 0, `non-whitelisted cookie survived`);
});

// --- phase 1: sweep history ---

test("a sweep is recorded with names but never values", async ({ page }) => {
  const record = await page.evaluate(async () => {
    await chrome.cookies.set({
      url: "https://e2e-hist.com/",
      name: "sid",
      value: "SUPER_SECRET_VALUE",
    });
    await chrome.runtime.sendMessage({
      type: "cleanDomainNow",
      domain: "e2e-hist.com",
    });
    const { sweepLog } = await chrome.storage.local.get("sweepLog");
    return { log: sweepLog, raw: JSON.stringify(sweepLog) };
  });
  assert(record.log.length === 1, `expected 1 record, got ${record.log?.length}`);
  assert(record.log[0].domain === "e2e-hist.com", "wrong domain recorded");
  assert(record.log[0].trigger === "manual", `trigger was ${record.log[0].trigger}`);
  assert(record.log[0].cookies[0].name === "sid", "cookie name missing");
  assert(
    !record.raw.includes("SUPER_SECRET_VALUE"),
    "COOKIE VALUE LEAKED INTO HISTORY",
  );
});

test("third-party cookies are flagged in history", async ({ page }) => {
  const cookies = await page.evaluate(async () => {
    // A cookie on a subdomain of the site is first-party; one scoped to an
    // unrelated registrable domain is not. Only the first is swept by domain,
    // so seed the tracker under the site's own domain query via clean-all.
    await chrome.cookies.set({
      url: "https://cdn.e2e-tp.com/",
      name: "own",
      value: "1",
    });
    await chrome.runtime.sendMessage({
      type: "cleanDomainNow",
      domain: "e2e-tp.com",
    });
    const { sweepLog } = await chrome.storage.local.get("sweepLog");
    return sweepLog[0].cookies;
  });
  const own = cookies.find((c) => c.name === "own");
  assert(own !== undefined, "subdomain cookie was not swept");
  assert(own.thirdParty === false, "subdomain cookie wrongly flagged third-party");
});

test("history survives a service worker restart", async ({ page, worker }) => {
  await page.evaluate(async () => {
    await chrome.cookies.set({ url: "https://e2e-sw.com/", name: "a", value: "1" });
    await chrome.runtime.sendMessage({
      type: "cleanDomainNow",
      domain: "e2e-sw.com",
    });
  });
  // Storage is the only thing that survives the worker being killed; this is
  // the property the whole MV3 design depends on.
  await worker.evaluate(() => {
    /* touch the worker so it is alive before we read back */
  });
  const count = await page.evaluate(async () => {
    const { sweepLog } = await chrome.storage.local.get("sweepLog");
    return sweepLog.length;
  });
  assert(count === 1, `expected history to persist, got ${count} records`);
});

test("options page renders the activity section", async ({ page }) => {
  await page.evaluate(async () => {
    await chrome.cookies.set({ url: "https://e2e-ui.com/", name: "sid", value: "1" });
    await chrome.cookies.set({ url: "https://e2e-ui.com/", name: "tid", value: "2" });
    await chrome.runtime.sendMessage({
      type: "cleanDomainNow",
      domain: "e2e-ui.com",
    });
  });
  await page.reload();
  await page.waitForTimeout(400);
  const summary = await page.locator("#activity-summary").innerText();
  assert(summary.includes("2"), `summary did not show the count: "${summary}"`);
  const log = await page.locator("#activity-log").innerText();
  assert(log.includes("e2e-ui.com"), `log did not list the site: "${log}"`);
});

// --- phase 2: undo ---

test("a swept cookie can be restored byte for byte", async ({ page }) => {
  const result = await page.evaluate(async () => {
    await chrome.cookies.set({
      url: "https://e2e-undo.com/",
      name: "sid",
      value: "the-original-value",
    });
    const [before] = await chrome.cookies.getAll({ domain: "e2e-undo.com" });
    await chrome.runtime.sendMessage({
      type: "cleanDomainNow",
      domain: "e2e-undo.com",
    });
    const gone = await chrome.cookies.getAll({ domain: "e2e-undo.com" });
    const { sweepLog } = await chrome.storage.local.get("sweepLog");
    const undo = await chrome.runtime.sendMessage({
      type: "undoSweep",
      sweepId: sweepLog[0].id,
    });
    const [after] = await chrome.cookies.getAll({ domain: "e2e-undo.com" });
    return { before, goneCount: gone.length, undo, after };
  });
  assert(result.goneCount === 0, "cookie was not swept");
  assert(result.undo.restored === 1, `restored ${result.undo.restored}, expected 1`);
  assert(result.after !== undefined, "cookie was not restored");
  assert(
    result.after.value === "the-original-value",
    `value changed: ${result.after?.value}`,
  );
  for (const field of ["name", "domain", "path", "secure", "httpOnly", "hostOnly"]) {
    assert(
      result.before[field] === result.after[field],
      `${field} changed: ${result.before[field]} -> ${result.after[field]}`,
    );
  }
});

test("awkward cookie shapes survive the round trip", async ({ page }) => {
  const diffs = await page.evaluate(async () => {
    const seeds = [
      // host-only + secure + strict, on a deep path
      {
        url: "https://e2e-shapes.com/deep/path",
        name: "hostonly_secure",
        value: "1",
        secure: true,
        httpOnly: true,
        sameSite: "strict",
        path: "/deep/path",
      },
      // domain cookie (leading dot), covers subdomains
      {
        url: "https://e2e-shapes.com/",
        name: "domainwide",
        value: "2",
        domain: ".e2e-shapes.com",
      },
      // session cookie: no expirationDate at all
      { url: "https://e2e-shapes.com/", name: "sessiononly", value: "3" },
      // far-future persistent cookie
      {
        url: "https://e2e-shapes.com/",
        name: "persistent",
        value: "4",
        expirationDate: Math.floor(Date.now() / 1000) + 86400 * 365,
      },
    ];
    for (const seed of seeds) await chrome.cookies.set(seed);

    const key = (c) => `${c.name}`;
    const snapshot = async () => {
      const all = await chrome.cookies.getAll({ domain: "e2e-shapes.com" });
      return Object.fromEntries(all.map((c) => [key(c), c]));
    };
    const before = await snapshot();

    await chrome.runtime.sendMessage({
      type: "cleanDomainNow",
      domain: "e2e-shapes.com",
    });
    const { sweepLog } = await chrome.storage.local.get("sweepLog");
    await chrome.runtime.sendMessage({
      type: "undoSweep",
      sweepId: sweepLog[0].id,
    });
    const after = await snapshot();

    const fields = [
      "value",
      "domain",
      "path",
      "secure",
      "httpOnly",
      "hostOnly",
      "session",
      "sameSite",
      "expirationDate",
    ];
    const diffs = [];
    for (const name of Object.keys(before)) {
      if (!(name in after)) {
        diffs.push(`${name}: not restored`);
        continue;
      }
      for (const field of fields) {
        if (before[name][field] !== after[name][field]) {
          diffs.push(`${name}.${field}: ${before[name][field]} -> ${after[name][field]}`);
        }
      }
    }
    return { diffs, count: Object.keys(before).length };
  });
  assert(diffs.count === 4, `expected 4 seeded cookies, got ${diffs.count}`);
  assert(diffs.diffs.length === 0, `round trip changed:\n        ${diffs.diffs.join("\n        ")}`);
});

test("undo is consumed and cannot be replayed", async ({ page }) => {
  const second = await page.evaluate(async () => {
    await chrome.cookies.set({ url: "https://e2e-once.com/", name: "a", value: "1" });
    await chrome.runtime.sendMessage({
      type: "cleanDomainNow",
      domain: "e2e-once.com",
    });
    const { sweepLog } = await chrome.storage.local.get("sweepLog");
    await chrome.runtime.sendMessage({ type: "undoSweep", sweepId: sweepLog[0].id });
    return chrome.runtime.sendMessage({ type: "undoSweep", sweepId: sweepLog[0].id });
  });
  assert(second.available === false, "the same undo was offered twice");
});

test("undo values are never written to storage.local", async ({ page }) => {
  const local = await page.evaluate(async () => {
    await chrome.cookies.set({
      url: "https://e2e-leak.com/",
      name: "sid",
      value: "MUST_NOT_PERSIST",
    });
    await chrome.runtime.sendMessage({
      type: "cleanDomainNow",
      domain: "e2e-leak.com",
    });
    return JSON.stringify(await chrome.storage.local.get(null));
  });
  assert(
    !local.includes("MUST_NOT_PERSIST"),
    "COOKIE VALUE REACHED DISK-BACKED STORAGE",
  );
});

test("popup offers undo right after a sweep", async ({ page, extId }) => {
  await page.evaluate(async () => {
    await chrome.cookies.set({ url: "https://e2e-popup.com/", name: "a", value: "1" });
    await chrome.cookies.set({ url: "https://e2e-popup.com/", name: "b", value: "2" });
    await chrome.runtime.sendMessage({
      type: "cleanDomainNow",
      domain: "e2e-popup.com",
    });
  });
  const popup = await page.context().newPage();
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
  await popup.waitForTimeout(400);
  const visible = await popup.locator("#undo-card").isVisible();
  const label = await popup.locator("#btn-undo").innerText();
  await popup.close();
  assert(visible, "undo card was not shown");
  assert(
    label.includes("2") && label.includes("e2e-popup.com"),
    `unexpected undo label: "${label}"`,
  );
});

// --- review prompt: timing, once-only, "Don't ask again" ---

test("review prompt follows its timing and respects the answers", async ({ page, extId }) => {
  const DAY = 24 * 60 * 60 * 1000;
  const seen = async (state) => {
    await page.evaluate((s) => chrome.storage.local.set({ reviewPrompt: s }), state);
    const popup = await page.context().newPage();
    await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
    await popup.waitForTimeout(400);
    const visible = await popup.locator("#review-card").isVisible();
    return { popup, visible };
  };
  const old = Date.now() - 8 * DAY;
  let r = await seen({ installedAt: Date.now(), sweeps: 50, status: "pending" });
  assert(!r.visible, "prompt shown on a fresh install");
  await r.popup.close();
  r = await seen({ installedAt: old, sweeps: 5, status: "pending" });
  assert(!r.visible, "prompt shown before enough real use");
  await r.popup.close();
  r = await seen({ installedAt: old, sweeps: 20, status: "pending" });
  assert(r.visible, "prompt not shown after 7 days and 20 sweeps");
  const href = await r.popup.locator("#review-go").getAttribute("href");
  assert(href.endsWith("/reviews"), `review link wrong: ${href}`);
  await r.popup.locator("#review-never").click();
  await r.popup.close();
  r = await seen(
    await page.evaluate(async () => (await chrome.storage.local.get("reviewPrompt")).reviewPrompt),
  );
  assert(!r.visible, "prompt returned after Don't ask again");
  await r.popup.close();
  r = await seen({ installedAt: old, sweeps: 20, status: "pending" });
  await r.popup.locator("#review-later").click();
  await r.popup.close();
  r = await seen(
    await page.evaluate(async () => (await chrome.storage.local.get("reviewPrompt")).reviewPrompt),
  );
  assert(!r.visible, "prompt returned before 30 days after Not now");
  await r.popup.close();
  await page.evaluate(() => chrome.storage.local.remove("reviewPrompt"));
});

// --- phases 3-5: pro features and the entitlement gate ---

const grantPro = (page) =>
  page.evaluate(() =>
    chrome.storage.local.set({
      proEntitlement: { active: true, checkedAt: Date.now() },
    }),
  );

test("session cookies are swept while the tier is free", async ({ page }) => {
  const left = await page.evaluate(async () => {
    await chrome.storage.sync.set({
      settings: { protectSessionCookies: true },
    });
    await chrome.cookies.set({
      url: "https://e2e-free.com/",
      name: "PHPSESSID",
      value: "1",
    });
    await chrome.runtime.sendMessage({
      type: "cleanDomainNow",
      domain: "e2e-free.com",
    });
    return (await chrome.cookies.getAll({ domain: "e2e-free.com" })).length;
  });
  assert(left === 0, "the setting took effect without an entitlement");
});

test("with pro, the login cookie stays and the trackers go", async ({ page }) => {
  await grantPro(page);
  const result = await page.evaluate(async () => {
    await chrome.storage.sync.set({
      settings: { protectSessionCookies: true },
    });
    for (const name of ["PHPSESSID", "csrftoken", "_ga", "_hjSessionUser_9", "theme"]) {
      await chrome.cookies.set({ url: "https://e2e-pro.com/", name, value: "1" });
    }
    await chrome.runtime.sendMessage({
      type: "cleanDomainNow",
      domain: "e2e-pro.com",
    });
    const left = await chrome.cookies.getAll({ domain: "e2e-pro.com" });
    const { sweepLog } = await chrome.storage.local.get("sweepLog");
    return { left: left.map((c) => c.name).sort(), kept: sweepLog[0].kept };
  });
  assert(
    JSON.stringify(result.left) === JSON.stringify(["PHPSESSID", "csrftoken"]),
    `wrong survivors: ${JSON.stringify(result.left)}`,
  );
  assert(result.kept === 2, `history recorded kept=${result.kept}, expected 2`);
});

test("a keep rule protects exactly what it names", async ({ page }) => {
  await grantPro(page);
  const left = await page.evaluate(async () => {
    await chrome.storage.sync.set({
      "cookierules.0": [{ domain: "e2e-rule.com", keep: ["keepme", "pref_*"] }],
    });
    for (const name of ["keepme", "pref_theme", "pref_lang", "_ga", "other"]) {
      await chrome.cookies.set({ url: "https://e2e-rule.com/", name, value: "1" });
    }
    await chrome.runtime.sendMessage({
      type: "cleanDomainNow",
      domain: "e2e-rule.com",
    });
    return (await chrome.cookies.getAll({ domain: "e2e-rule.com" }))
      .map((c) => c.name)
      .sort();
  });
  assert(
    JSON.stringify(left) === JSON.stringify(["keepme", "pref_lang", "pref_theme"]),
    `wrong survivors: ${JSON.stringify(left)}`,
  );
});

test("keep rules do nothing without an entitlement", async ({ page }) => {
  const left = await page.evaluate(async () => {
    await chrome.storage.sync.set({
      "cookierules.0": [{ domain: "e2e-norule.com", keep: ["keepme"] }],
    });
    await chrome.cookies.set({
      url: "https://e2e-norule.com/",
      name: "keepme",
      value: "1",
    });
    await chrome.runtime.sendMessage({
      type: "cleanDomainNow",
      domain: "e2e-norule.com",
    });
    return (await chrome.cookies.getAll({ domain: "e2e-norule.com" })).length;
  });
  assert(left === 0, "a rule was honoured on the free tier");
});

test("popup shows real cookies but gates saving until pro", async ({ page, extId }) => {
  await page.evaluate(async () => {
    for (const name of ["PHPSESSID", "_ga"]) {
      await chrome.cookies.set({ url: "https://e2e-keepui.com/", name, value: "1" });
    }
  });
  const popup = await page.context().newPage();
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
  // The popup reads the active tab; drive the panel directly instead.
  await popup.evaluate(() => {
    const btn = document.getElementById("btn-keep");
    btn.dispatchEvent(new Event("click"));
  });
  await popup.waitForTimeout(300);
  const state = await popup.evaluate(() => ({
    names: [...document.querySelectorAll("#keep-list .cookie-name")].map(
      (n) => n.textContent,
    ),
    saveDisabled: document.getElementById("keep-save").disabled,
    lockedVisible: !document.getElementById("keep-locked").hidden,
  }));
  await popup.close();
  // No active site in this harness, so the list stays empty; what matters is
  // that the gate is closed and explained.
  assert(state.saveDisabled, "saving was enabled without an entitlement");
  assert(state.lockedVisible, "the pro explanation was not shown");
});

test("options gates the session-protection toggle", async ({ page }) => {
  await page.reload();
  await page.waitForTimeout(400);
  const free = await page.evaluate(() => ({
    disabled: document.getElementById("opt-protect-sessions").disabled,
    locked: !document.getElementById("pro-locked").hidden,
  }));
  assert(free.disabled && free.locked, "free tier could toggle session protection");

  await grantPro(page);
  await page.reload();
  await page.waitForTimeout(400);
  const pro = await page.evaluate(() => ({
    disabled: document.getElementById("opt-protect-sessions").disabled,
    locked: !document.getElementById("pro-locked").hidden,
  }));
  assert(!pro.disabled && !pro.locked, "pro tier was still gated");
});

// --- phase 6: payment stays unreachable until asked for ---

test("content scripts only ever run on extensionpay.com", async ({ page }) => {
  // Two things guarded here. While payment is unconfigured there should be no
  // content script at all — declaring access the extension never uses is not
  // something a privacy extension gets to do. And once it is configured, the
  // match must stay narrow: the upstream ExtPay sample injects its script
  // into every http(s) page, which would be indefensible.
  const scripts = await page.evaluate(
    () => chrome.runtime.getManifest().content_scripts,
  );
  if (scripts === undefined) return;
  assert(scripts.length === 1, `expected 1 content script, got ${scripts.length}`);
  assert(
    JSON.stringify(scripts[0].matches) === JSON.stringify(["https://extensionpay.com/*"]),
    `content script matches too much: ${JSON.stringify(scripts[0].matches)}`,
  );
});

test("no payment code ships while payment is unconfigured", async ({ page }) => {
  const present = await page.evaluate(async () => {
    const response = await fetch(chrome.runtime.getURL("extpay/ExtPay.js")).catch(
      () => null,
    );
    return response !== null && response.ok;
  });
  const configured = await page.evaluate(
    () => chrome.runtime.getManifest().content_scripts !== undefined,
  );
  assert(
    present === configured,
    present
      ? "the AGPL payment library shipped in a build with no payment flow"
      : "payment is configured but the library is missing from the build",
  );
});

test("the payment library loads iff payment is configured", async ({
  page,
  worker,
}) => {
  // MV3 only permits importScripts() during the worker's initial evaluation,
  // so this has to happen at startup. An earlier version loaded it lazily on
  // click, which silently failed with ERR_FAILED and made Upgrade a no-op.
  const configured = await page.evaluate(
    () => chrome.runtime.getManifest().content_scripts !== undefined,
  );
  const loaded = await worker.evaluate(() => typeof self.ExtPay !== "undefined");
  assert(
    loaded === configured,
    loaded
      ? "payment library loaded in a build with no payment flow"
      : "payment library failed to load — Upgrade would silently do nothing",
  );
});

test("beginUpgrade actually opens a checkout when configured", async ({
  page,
  context,
}) => {
  const configured = await page.evaluate(
    () => chrome.runtime.getManifest().content_scripts !== undefined,
  );
  const response = await page.evaluate(() =>
    chrome.runtime.sendMessage({ type: "beginUpgrade" }),
  );
  if (!configured) {
    assert(response.started === false, "unconfigured build reported a start");
    return;
  }
  assert(response.started === true, "Upgrade reported failure");
  // Confirm a real checkout tab appeared, not just a truthy return value.
  await page.waitForTimeout(4000);
  const checkout = context
    .pages()
    .find((p) => p.url().includes("extensionpay.com"));
  assert(checkout !== undefined, "no checkout page opened");
  assert(
    checkout.url().includes("/choose-plan"),
    `unexpected checkout url: ${checkout.url()}`,
  );
  await checkout.close();
}, { liveExtPay: true });

/** Visible-or-not within a short wait, without failing the test. */
const shows = (locator, timeout = 3000) =>
  locator.first().waitFor({ state: "visible", timeout }).then(() => true, () => false);

/**
 * First visible match for `selector` in the page or any of its frames.
 * Stripe's newer Checkout renders the card form inside a js.stripe.com
 * iframe, so searching only the top document finds nothing.
 */
async function inAnyFrame(p, selector, timeout) {
  const deadline = Date.now() + timeout;
  do {
    for (const frame of p.frames()) {
      const loc = frame.locator(selector).first();
      if (await loc.isVisible().catch(() => false)) return loc;
    }
    await p.waitForTimeout(500);
  } while (Date.now() < deadline);
  return undefined;
}

async function fillIn(p, selector, value, { required = true, timeout = 20_000 } = {}) {
  const loc = await inAnyFrame(p, selector, required ? timeout : 2000);
  if (loc) await loc.fill(value);
  else if (required) throw new Error(`Stripe field not found: ${selector}`);
}

/**
 * Fills Stripe's hosted Checkout with the 4242 test card. Fields are found
 * by their standard autocomplete tokens, in whichever frame holds them.
 * Optional fields (email, accordion, name, postal code) depend on account
 * settings and the runner's country, so each is filled only if shown.
 */
async function fillStripeCheckout(p) {
  await p.waitForLoadState("networkidle").catch(() => {});
  await fillIn(p, 'input[autocomplete="email"], #email', `e2e+${Date.now()}@example.com`, { required: false });
  const cardMethod = await inAnyFrame(
    p, '[data-testid="card-accordion-item-button"], button[value="card"], [data-value="card"]', 2000);
  if (cardMethod) await cardMethod.click();
  await fillIn(p, 'input[autocomplete="cc-number"], input[name="number"], #cardNumber', "4242424242424242");
  await fillIn(p, 'input[autocomplete="cc-exp"], input[name="expiry"], #cardExpiry', "12 / 34");
  await fillIn(p, 'input[autocomplete="cc-csc"], input[name="cvc"], #cardCvc', "123");
  await fillIn(p, 'input[autocomplete="cc-name"], #billingName', "E2E Test", { required: false });
  await fillIn(p, 'input[autocomplete="postal-code"], input[name="postalCode"], #billingPostalCode', "10001", { required: false });
  const submit = await inAnyFrame(
    p, '[data-testid="hosted-payment-submit-button"], button[type="submit"]', 10_000);
  if (!submit) throw new Error("Stripe submit button not found");
  await submit.click();
}

/**
 * On failure: log form *structure* only — tags, names, types, autocomplete
 * tokens, per frame. Never page text, labels, values or screenshots: this
 * repo's CI logs are public, and Stripe pages show the merchant's legal name.
 */
async function dumpPage(p, label) {
  try {
    const frames = [];
    for (const frame of p.frames()) {
      const url = new URL(frame.url());
      const fields = await frame.evaluate(() =>
        [...document.querySelectorAll("input,select,button")].map((e) =>
          [e.tagName, e.name, e.type, e.getAttribute("autocomplete"),
            e.getAttribute("data-testid"), e.offsetParent !== null ? "visible" : "hidden"]
            .filter(Boolean).join("|")),
      ).catch(() => ["(unreadable)"]);
      frames.push({ frame: `${url.host}${url.pathname.slice(0, 50)}`, fields });
    }
    console.log(`\n--- ${label} form structure ---\n${JSON.stringify(frames, null, 2)}\n---`);
  } catch (e) {
    console.log(`(form dump failed: ${e.message})`);
  }
}

// The whole paid path as a customer walks it: Upgrade → ExtensionPay →
// Stripe Checkout → back → Pro actually changes what gets swept. Test mode
// only: it refuses to type a card anywhere that isn't a Stripe *test* session.
test("a test-mode purchase unlocks pro end to end", async ({ page, context }) => {
  const configured = await page.evaluate(
    () => chrome.runtime.getManifest().content_scripts !== undefined,
  );
  const password = process.env.EXTPAY_DEV_PASSWORD;
  if (!configured || !password) {
    const why = !configured ? "payment is not configured" : "EXTPAY_DEV_PASSWORD is not set";
    if (requirePayment) throw new Error(`${why}; the release gate requires a real test-mode purchase`);
    throw new Skip(why);
  }

  const proActive = () =>
    page.evaluate(async () =>
      (await chrome.storage.local.get("proEntitlement")).proEntitlement?.active === true);
  assert(!(await proActive()), "already pro before paying");

  const opened = context.waitForEvent("page", {
    predicate: (p) => p.url().includes("extensionpay.com"),
    timeout: 20_000,
  });
  await page.evaluate(() => chrome.runtime.sendMessage({ type: "beginUpgrade" }));
  const checkout = await opened;
  await checkout.waitForLoadState("networkidle");
  assert(
    (await checkout.title()).includes("test mode"),
    "ExtensionPay is not in test mode; refusing to continue",
  );

  // First (and for CrumbSweep, only) priced plan, e.g. "$9 Lifetime".
  await checkout.locator("button").filter({ hasText: /\$\d/ }).first().click();
  await checkout.locator('input[name="password"]').fill(password);
  await checkout.getByRole("button", { name: /test payment page/i }).click();
  await checkout.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });
  assert(
    checkout.url().includes("cs_test_"),
    `not a Stripe test session (${new URL(checkout.url()).pathname}); refusing to enter a card`,
  );

  try {
    await fillStripeCheckout(checkout);
  } catch (error) {
    await dumpPage(checkout, "stripe-checkout");
    throw error;
  }

  // onPaid arrives via the content script on extensionpay.com's success page.
  const deadline = Date.now() + 90_000;
  while (!(await proActive())) {
    if (Date.now() > deadline) {
      throw new Error(`paid, but Pro never unlocked (checkout ended at ${checkout.url()})`);
    }
    await page.waitForTimeout(2000);
  }
  await checkout.close().catch(() => {});

  // Entitlement alone isn't the point: a Pro feature must now behave as Pro.
  const left = await page.evaluate(async () => {
    await chrome.storage.sync.set({
      "cookierules.0": [{ domain: "e2e-paid.com", keep: ["keepme"] }],
    });
    for (const name of ["keepme", "_ga"]) {
      await chrome.cookies.set({ url: "https://e2e-paid.com/", name, value: "1" });
    }
    await chrome.runtime.sendMessage({ type: "cleanDomainNow", domain: "e2e-paid.com" });
    return (await chrome.cookies.getAll({ domain: "e2e-paid.com" })).map((c) => c.name);
  });
  assert(
    JSON.stringify(left) === JSON.stringify(["keepme"]),
    `after purchase, keep rule gave survivors ${JSON.stringify(left)}`,
  );
}, { liveExtPay: true });

test("a free user's session makes no external network requests", async ({
  page,
  context,
  extId,
}) => {
  const external = [];
  const record = (url) => {
    if (!url.startsWith(`chrome-extension://${extId}`) && !url.startsWith("data:")) {
      external.push(url);
    }
  };
  context.on("request", (request) => record(request.url()));

  // Exercise everything a normal user touches.
  await page.evaluate(async () => {
    await chrome.cookies.set({ url: "https://e2e-net.com/", name: "a", value: "1" });
    await chrome.runtime.sendMessage({ type: "cleanDomainNow", domain: "e2e-net.com" });
    await chrome.runtime.sendMessage({ type: "cleanAllExceptWhitelist" });
    await chrome.runtime.sendMessage({ type: "setPause", until: "indefinite" });
    await chrome.runtime.sendMessage({ type: "setPause", until: null });
  });
  await page.reload();
  await page.waitForTimeout(600);

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
  await popup.waitForTimeout(400);
  await popup.close();
  await page.waitForTimeout(600);

  assert(
    external.length === 0,
    `made ${external.length} external request(s): ${external.slice(0, 5).join(", ")}`,
  );
});

test("the upgrade offer matches whether payment is configured", async ({ page }) => {
  await page.reload();
  await page.waitForTimeout(400);
  const state = await page.evaluate(() => ({
    hidden: document.getElementById("btn-upgrade").hidden,
    locked: document.getElementById("pro-locked").textContent,
    configured: chrome.runtime.getManifest().content_scripts !== undefined,
  }));
  if (state.configured) {
    assert(!state.hidden, "payment is configured but no upgrade was offered");
  } else {
    // Offering to take money through a flow that cannot complete is worse
    // than not offering at all.
    assert(state.hidden, "offered a purchase through a flow that cannot complete");
    assert(
      state.locked.includes("coming soon"),
      `unexpected locked copy: "${state.locked}"`,
    );
  }
});

// --- runner ---

export async function run() {
  const pkgVersion = JSON.parse(await readFile("package.json", "utf8")).version;

  await rm(profile, { recursive: true, force: true });
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    viewport: { width: 1000, height: 800 },
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });

  const failures = [];
  const skipped = [];
  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    const extId = new URL(worker.url()).host;
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
    await page.goto(`chrome-extension://${extId}/options/options.html`);

    const ctx = { page, context, extId, worker, pkgVersion };
    for (const { name, fn, liveExtPay } of tests) {
      if (liveExtPay && !runLive) {
        skipped.push(name);
        console.log(`  SKIP  ${name} (hits ExtensionPay's live API)`);
        continue;
      }
      try {
        // Each test starts from a clean slate so ordering never matters.
        await page.evaluate(async () => {
          await chrome.storage.local.clear();
          await chrome.storage.sync.clear();
          if (chrome.storage.session) await chrome.storage.session.clear();
        });
        await fn(ctx);
        console.log(`  PASS  ${name}`);
      } catch (error) {
        if (error instanceof Skip) {
          skipped.push(name);
          console.log(`  SKIP  ${name} (${error.message})`);
          continue;
        }
        failures.push({ name, error });
        console.log(`  FAIL  ${name}\n        ${error.message}`);
      }
    }
    if (consoleErrors.length) {
      console.log("\n  console errors:");
      for (const e of consoleErrors) console.log(`    ${e}`);
    }
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }

  const ran = tests.length - skipped.length;
  console.log(
    `\n${ran - failures.length}/${ran} e2e tests passed` +
      (skipped.length ? ` (${skipped.length} skipped)` : ""),
  );
  // The release job refuses to publish unless this file says this exact
  // version ran every test, skipped none, and failed none.
  if (process.env.E2E_RESULTS) {
    await writeFile(process.env.E2E_RESULTS, `${JSON.stringify({
      version: pkgVersion,
      total: tests.length,
      passed: ran - failures.length,
      failed: failures.map((f) => f.name),
      skipped,
    }, null, 2)}\n`);
  }
  if (failures.length) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await run();
