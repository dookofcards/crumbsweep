// Automated store screenshots (run: npm run build && node tools/screenshots.mjs).
// Launches real Chrome with the extension loaded and captures 1280x800 PNGs
// into store-assets/.
//
// The extension is staged from a COPY of dist/ — the shipped build is never
// modified. The staging adds a screenshot-only popup harness (backdrop +
// iframe + a mocked active-tab query so the popup shows a realistic site)
// and seeds storage with plausible lists, counters and sweep history.
// Everything rendered is the real shipped UI code.
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
const fakeTab = { id: 999, url: "https://www.nytimes.com/section/world", active: true };
const origQuery = chrome.tabs.query.bind(chrome.tabs);
chrome.tabs.query = (info) =>
  info && info.active ? Promise.resolve([fakeTab]) : origQuery(info);
`,
);
const frame = (headline, src, w, h) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin:0; height:100vh; display:flex; flex-direction:column; gap:26px;
    align-items:center; justify-content:center;
    background:linear-gradient(135deg,#d97706,#7c2d12);
    font-family:system-ui,sans-serif; }
  h1 { color:#fff; font-size:29px; margin:0; font-weight:800; letter-spacing:-.5px;
    text-align:center; max-width:900px; }
  .shot { box-shadow:0 24px 80px rgba(0,0,0,.45); border-radius:12px; overflow:hidden; }
  iframe { width:${w}px; height:${h}px; border:none; background:#fff; display:block; }
  </style></head><body>
  <h1>${headline}</h1>
  <div class="shot"><iframe src="${src}"></iframe></div>
  </body></html>`;

await writeFile(
  path.join(stageDir, "stage-frame.html"),
  frame(
    "Closed a tab and lost a session? Put it back.",
    "popup/popup-stage.html",
    360,
    625,
  ),
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
    const now = Date.now();
    const hour = 3600_000;
    const c = (name, host, thirdParty) => ({ name, host, thirdParty });
    const sweep = (domain, at, trigger, cookies) => ({
      id: crypto.randomUUID(),
      domain,
      at,
      trigger,
      count: cookies.length,
      cookies,
    });

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
      sweepLog: [
        sweep("nytimes.com", now - 0.4 * hour, "tab-close", [
          c("nyt-a", "nytimes.com", false),
          c("_ga", "nytimes.com", false),
          c("IDE", "doubleclick.net", true),
          c("_fbp", "facebook.com", true),
          c("uid", "scorecardresearch.com", true),
          c("anj", "adnxs.com", true),
        ]),
        sweep("theverge.com", now - 2.2 * hour, "tab-close", [
          c("_sp_id", "theverge.com", false),
          c("IDE", "doubleclick.net", true),
          c("uid", "adnxs.com", true),
          c("_fbp", "facebook.com", true),
        ]),
        sweep("stackoverflow.com", now - 5 * hour, "tab-close", [
          c("prov", "stackoverflow.com", false),
          c("IDE", "doubleclick.net", true),
        ]),
        sweep("booking.com", now - 7 * hour, "manual", [
          c("bkng", "booking.com", false),
          c("_gcl_au", "booking.com", false),
          c("uid", "criteo.com", true),
        ]),
        sweep("reddit.com", now - 27 * hour, "startup", [
          c("session_tracker", "reddit.com", false),
          c("_fbp", "facebook.com", true),
        ]),
      ],
    });
    // Undo buffer is memory-only; seed it so the popup shows the offer.
    await chrome.storage.session.set({
      undoBuffer: [
        {
          sweepId: "shot",
          at: now - 60_000,
          domain: "nytimes.com",
          cookies: Array.from({ length: 6 }, (_, i) => ({
            name: `c${i}`,
            value: "x",
            domain: "nytimes.com",
            path: "/",
          })),
        },
      ],
    });
  });

  // 1. Options page (top)
  await page.reload();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(outDir, "screenshot-1-options.png") });

  // 2. Activity — the thing that shows what it actually caught. Anchor the
  // section heading near the top so the whole story fits in frame.
  await page.locator("#activity-log details").first().click();
  await page.evaluate(() => {
    const heading = [...document.querySelectorAll("h2")].find(
      (h) => h.textContent.trim() === "Activity",
    );
    heading.scrollIntoView({ block: "start" });
    window.scrollBy(0, -24);
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, "screenshot-2-activity.png") });

  // 3. Lists + Cookie AutoDelete import — the switcher hook.
  await page.evaluate(() => {
    const heading = [...document.querySelectorAll("h2")].find(
      (h) => h.textContent.trim() === "Lists",
    );
    heading.scrollIntoView({ block: "start" });
    window.scrollBy(0, -24);
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, "screenshot-3-lists.png") });

  // 4. Popup, with undo offered and recent sweeps.
  await page.goto(extUrl("stage-frame.html"));
  await page.waitForTimeout(800);
  const domainShown = await page
    .frameLocator("iframe")
    .locator("#site-domain")
    .textContent();
  await page.screenshot({ path: path.join(outDir, "screenshot-4-popup.png") });
  console.log(`popup shows domain: ${domainShown}`);

  // 5. Onboarding — open real sites first so the whitelist chips populate.
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
    path: path.join(outDir, "screenshot-5-onboarding.png"),
  });
} finally {
  await context.close();
}

await rm(stageDir, { recursive: true, force: true });
await rm(profileDir, { recursive: true, force: true });
console.log(`screenshots written to ${outDir}`);
