// End-to-end tests against a real Chrome with the extension loaded.
//
// Unit tests (vitest) cover pure logic; this covers everything that needs the
// actual chrome.* APIs — cookie removal and restore, storage round-trips,
// service-worker messaging. Run: npm run build && node tools/e2e.mjs
//
// Tests run inside the options page, which shares the extension origin and
// service worker with the real thing, so chrome.* behaves exactly as shipped.
import { chromium } from "playwright";
import { readFile, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");
const profile = path.join(root, ".e2e-profile");

const tests = [];
export const test = (name, fn) => tests.push({ name, fn });

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
  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    const extId = new URL(worker.url()).host;
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
    await page.goto(`chrome-extension://${extId}/options/options.html`);

    const ctx = { page, context, extId, worker, pkgVersion };
    for (const { name, fn } of tests) {
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

  console.log(`\n${tests.length - failures.length}/${tests.length} e2e tests passed`);
  if (failures.length) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await run();
