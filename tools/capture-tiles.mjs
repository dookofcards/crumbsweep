// Captures fixed-size marketing tiles from HTML by screenshotting the
// element itself, so a 440x280 div yields exactly a 440x280 PNG.
// `scale` renders at that device pixel ratio — use it where a platform wants
// high-resolution artwork rather than exact dimensions.
// Run: node tools/capture-tiles.mjs
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const TILES = [
  // Chrome Web Store requires these exact pixel sizes — keep scale at 1.
  { file: "tools/promo.html", sel: "#tile-small", out: "store-assets/promo-440x280.png" },
  { file: "tools/promo.html", sel: "#tile-marquee", out: "store-assets/promo-1400x560.png" },
  { file: "tools/promo.html", sel: "#tile-social", out: "store-assets/github-social-1280x640.png" },
  // Buy Me a Coffee wants >=1600x400 and warns about low resolution: 2x -> 3200x800.
  { file: "planning/cover.html", sel: "#cover-bmc", out: "planning/brand/bmc-cover-3200x800.png", scale: 2 },
];

const browser = await chromium.launch();
try {
  for (const { file, sel, out, scale = 1 } of TILES) {
    await mkdir(path.dirname(out), { recursive: true });
    const page = await browser.newPage({
      viewport: { width: 1700, height: 900 },
      deviceScaleFactor: scale,
    });
    await page.goto(`file:///${path.resolve(file).replace(/\\/g, "/")}`);
    await page.waitForTimeout(200);
    await page.locator(sel).screenshot({ path: out });
    await page.close();
    console.log(`wrote ${out}${scale > 1 ? ` (${scale}x)` : ""}`);
  }
} finally {
  await browser.close();
}
