// Build script: bundles TS with esbuild, generates manifest.json from the
// template + shared constants, and copies static assets into dist/.
// --prod additionally minifies and zips dist/ into a store-ready
// crumbsweep-v<version>.zip in the project root.
import * as esbuild from "esbuild";
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import {
  EXTENSION_NAME,
  EXTENSION_DESCRIPTION,
} from "./src/shared/constants.ts";

const watch = process.argv.includes("--watch");
const prod = process.argv.includes("--prod");
const dist = "dist";

async function buildManifest() {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  const template = await readFile("src/manifest.template.json", "utf8");
  const manifest = template
    .replaceAll("__EXTENSION_NAME__", EXTENSION_NAME)
    .replaceAll("__EXTENSION_DESCRIPTION__", EXTENSION_DESCRIPTION)
    .replaceAll("__VERSION__", pkg.version);
  JSON.parse(manifest); // fail the build on malformed output
  await writeFile(`${dist}/manifest.json`, manifest);
}

async function copyStatic() {
  await cp("src/popup/popup.html", `${dist}/popup/popup.html`);
  await cp("src/popup/popup.css", `${dist}/popup/popup.css`);
  await cp("src/options/options.html", `${dist}/options/options.html`);
  await cp("src/options/options.css", `${dist}/options/options.css`);
  await cp("src/onboarding/onboarding.html", `${dist}/onboarding/onboarding.html`);
  await cp("src/onboarding/onboarding.css", `${dist}/onboarding/onboarding.css`);
  await cp("src/icons", `${dist}/icons`, { recursive: true });
}

const bundleOptions = {
  entryPoints: [
    { in: "src/background/serviceWorker.ts", out: "background" },
    { in: "src/popup/popup.ts", out: "popup/popup" },
    { in: "src/options/options.ts", out: "options/options" },
    { in: "src/onboarding/onboarding.ts", out: "onboarding/onboarding" },
  ],
  outdir: dist,
  bundle: true,
  format: "iife",
  target: "chrome120",
  sourcemap: false,
  minify: prod,
  logLevel: "info",
};

function makeZip(version) {
  const zipName = `crumbsweep-v${version}.zip`;
  if (process.platform === "win32") {
    execFileSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path ${dist}\\* -DestinationPath ${zipName} -Force`,
    ]);
  } else {
    execFileSync("zip", ["-r", "-X", `../${zipName}`, "."], { cwd: dist });
  }
  return zipName;
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await buildManifest();
await copyStatic();

if (watch) {
  const ctx = await esbuild.context(bundleOptions);
  await ctx.watch();
  console.log("watching for changes...");
} else {
  await esbuild.build(bundleOptions);
  console.log(`built ${EXTENSION_NAME} into ${dist}/`);
  if (prod) {
    const pkg = JSON.parse(await readFile("package.json", "utf8"));
    const zipName = makeZip(pkg.version);
    console.log(`packaged store-ready ${zipName}`);
  }
}
