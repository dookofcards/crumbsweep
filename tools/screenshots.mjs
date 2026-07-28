// Automated store screenshots (run: npm run build && node tools/screenshots.mjs).
// Launches real Chrome with the extension loaded and captures 1280x800 PNGs
// of the options page, onboarding page, and popup into store-assets/.
//
// The extension is staged from a COPY of dist/ — the shipped build is never
// modified. The staging adds a screenshot-only popup harness (backdrop +
// iframe + a mocked active-tab query so the popup shows a realistic site)
// and seeds storage with plausible lists/counters. Everything rendered is
// the real shipped UI code.
import { chromium } from "playwright";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const stageDir = path.join(root, ".stage-ext");
const profileDir = path.join(root, ".stage-profile");
const outDir = path.join(root, "store-assets");

// --- stage the extension copy ---
await rm(stageDir, { recursive: true, force: true });
await rm(profileDir, { recursive: true, force: true });
await cp(path.join(root, "dist"), stageDir, { recursive: true });
await mkdir(outDir, { recursive: true });

const popupHtml = await readFile(
  path.join(stageDir, "popup", "popup.html"),
  "utf8",
);
await writeFile(
  path.join(stageDir, "popup", "popup-stage.html"),
  popupHtml.replace(
    '<script src="popup.js"></script>',
    '<script src="stage-mock.js"></script><script src="popup.js"></script>',
  ),
);
await writeFile(
  path.join(stageDir, "popup", "stage-mock.js"),
  `// Screenshot harness only: make the popup believe a real site is active.
const fakeTab = { id: 999, url: "https://github.com/dookofcards/crumbsweep", active: true };
const origQuery = chrome.tabs.query.bind(chrome.tabs);
chrome.tabs.query = (info) =>
  info && info.active ? Promise.resolve([fakeTab]) : origQuery(info);
`,
);
await writeFile(
  path.join(stageDir, "stage-frame.html"),
  `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin:0; height:100vh; display:flex; flex-direction:column; gap:28px;
    align-items:center; justify-content:center;
    background:linear-gradient(135deg,#d97706,#7c2d12);
    font-family:system-ui,sans-serif; }
  h1 { color:#fff; font-size:30px; margin:0; font-weight:800; letter-spacing:-.5px; }
  .shot { box-shadow:0 24px 80px rgba(0,0,0,.45); border-radius:12px; overflow:hidden; }
  iframe { width:360px; height:342px; border:none; background:#fff; display:block; }
  </style></head><body>
  <h1>Whitelist what you trust — sweep the rest</h1>
  <div class="shot"><iframe src="popup/popup-stage.html"></iframe></div>
  </body></html>`,
);

// --- launch Chrome with the staged extension ---
const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: { width: 1280, height: 800 },
  args: [
    `--disable-extensions-except=${stageDir}`,
    `--load-extension=${stageDir}`,
  ],
});

try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker");
  const extId = new URL(worker.url()).host;
  const extUrl = (p) => `chrome-extension://${extId}/${p}`;

  const page = await context.newPage();

  // Seed realistic data from an extension page (real storage formats).
  await page.goto(extUrl("options/options.html"));
  await page.evaluate(async () => {
    const pad = (n) => String(n).padStart(2, "0");
    const d = new Date();
    await chrome.storage.sync.set({
      "whitelist.0": ["amazon.com", "github.com", "google.com", "proton.me"],
      "greylist.0": ["reddit.com", "wikipedia.org"],
    });
    await chrome.storage.local.set({
      cleanStats: {
        total: 1284,
        today: 47,
        todayDate: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      },
    });
  });

  // 1. Options page (top), plus the populated lists section
  await page.reload();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, "screenshot-1-options.png") });
  await page.locator("#white-list").scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, -80); // keep the "Lists" heading in frame
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, "screenshot-4-lists.png") });

  // 2. Onboarding — open real sites first so the whitelist chips populate.
  for (const url of ["https://github.com", "https://www.wikipedia.org"]) {
    try {
      const tab = await context.newPage();
      await tab.goto(url, { timeout: 20000, waitUntil: "domcontentloaded" });
    } catch {
      // offline or slow site — onboarding just shows fewer chips
    }
  }
  await page.bringToFront();
  await page.goto(extUrl("onboarding/onboarding.html"));
  await page.waitForTimeout(700);
  await page.screenshot({
    path: path.join(outDir, "screenshot-2-onboarding.png"),
  });

  // 3. Popup in the stage frame
  await page.goto(extUrl("stage-frame.html"));
  await page.waitForTimeout(700);
  const domainShown = await page
    .frameLocator("iframe")
    .locator("#site-domain")
    .textContent();
  await page.screenshot({ path: path.join(outDir, "screenshot-3-popup.png") });
  console.log(`popup shows domain: ${domainShown}`);
} finally {
  await context.close();
}

await rm(stageDir, { recursive: true, force: true });
await rm(profileDir, { recursive: true, force: true });
console.log(`screenshots written to ${outDir}`);
