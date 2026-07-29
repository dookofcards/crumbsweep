// Captures fixed-size marketing tiles from HTML by screenshotting the
// element itself, so a 1500x500 div yields exactly a 1500x500 PNG.
// Run: node tools/capture-tiles.mjs
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const TILES = [
  { file: "tools/promo.html", sel: "#tile-small", out: "store-assets/promo-440x280.png" },
  { file: "tools/promo.html", sel: "#tile-marquee", out: "store-assets/promo-1400x560.png" },
  { file: "tools/promo.html", sel: "#tile-social", out: "store-assets/github-social-1280x640.png" },
  { file: "planning/cover.html", sel: "#cover-bmc", out: "planning/brand/bmc-cover-1500x500.png" },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
try {
  for (const { file, sel, out } of TILES) {
    await mkdir(path.dirname(out), { recursive: true });
    await page.goto(`file:///${path.resolve(file).replace(/\\/g, "/")}`);
    await page.waitForTimeout(200);
    await page.locator(sel).screenshot({ path: out });
    console.log(`wrote ${out}`);
  }
} finally {
  await browser.close();
}
