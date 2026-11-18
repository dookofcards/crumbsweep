# CrumbSweep — notes for Claude

Manifest V3 Chrome extension that deletes a site's cookies when its last tab
closes. Free core, optional one-time "Pro" unlock sold through ExtensionPay
(which runs on the maintainer's connected Stripe account). Solo side project:
prefer simple, low-maintenance solutions over clever ones.

Live listing: `https://chromewebstore.google.com/detail/crumbsweep/kohfndmjmmfbmkiagfndfoglpimiaman`
Site + privacy policy: GitHub Pages from `main` → `/docs`.

## Hard rules

1. **Releases are autonomous, money is not.** Follow "Release standard"
   below without asking: commit, push to `main`, tag, and release once the
   gate passes. Never, under any circumstances: enter a real card or pay in
   live mode, use a Stripe live key, force-push, delete or overwrite a
   published tag or release, roll back or unpublish a store item, or change
   the ExtensionPay plans or price. Those need the maintainer.
2. **Use the public handle `dookofcards` only.** Never write the maintainer's
   real name, personal email, or the Windows account name into code, commits,
   listing copy, or the site. **CI logs and artifacts are public too.** Stripe
   and ExtensionPay pages display the account's legal name, so tests must
   never log their page text or upload screenshots of them. Log form
   structure only (see `dumpPage` in `tools/e2e.mjs`).
3. **Never commit `planning/`, `brief.md`, `.env*`, or `*.zip`.** `planning/`
   holds pricing and strategy and is gitignored on purpose.
4. **Privacy claim:** "the free version makes no network requests of any kind."
   Any change that adds a request breaks the store listing, the privacy policy,
   and the e2e test `a free user's session makes no external network requests`.
   Don't add analytics, remote config, or update pings.
5. **ExtPay.js is AGPLv3 and the extension is MIT.** It ships as a separate,
   unmodified `dist/extpay/ExtPay.js`, never bundled. See NOTICE and
   `src/background/payment.ts`.
6. **Copy stays in sync.** If what the extension does changes, update these in
   the same commit: `STORE_LISTING.md` (permission justifications),
   `docs/privacy-policy.html` (bump the effective date), `docs/index.html`,
   and `CHANGELOG.md`.

## Commands

```sh
npm ci
npm run typecheck
npm test            # vitest, 103 unit tests
npm run build       # → dist/ (load unpacked from here)
npm run package     # minified build + crumbsweep-v<version>.zip in repo root
CI=1 node tools/e2e.mjs   # Playwright drives real Chrome. CI=1 skips the 2 live ExtensionPay tests
# Release-gate mode: what the release workflow runs, against the minified store build
npm run package && CI=1 RUN_PAYMENT_E2E=1 EXTPAY_DEV_PASSWORD=… E2E_RESULTS=e2e-results.json node tools/e2e.mjs
```

**Windows gotcha:** if vitest reports "failed to find the runner" for every
file, the shell is in `c:\…` (lowercase drive letter) and vitest loads twice.
Run it from `C:\Users\…\ChromeProj` (PowerShell `Set-Location 'C:\…'`). The
tests themselves are fine.

Version comes from `package.json` alone; `build.mjs` stamps it into the
manifest. The extension name and the short description come from
`src/shared/constants.ts`.

## Release standard (fully autonomous; set by the maintainer 2026-11-18)

Applies to every one of the maintainer's extensions. Every extension has a
**Free** tier and a **Pro** tier sold through **ExtensionPay**.

**The gate.** A version may be published only when, for that exact version:
- typecheck and unit tests pass;
- every e2e test passes on the minified store build, with **none skipped**.
  That covers:
  - **Free:** the core features work, Pro features are locked, and a free
    session makes zero network requests.
  - **Pro:** the features behave correctly with an entitlement.
  - **Pro purchase:** a real end-to-end purchase through ExtensionPay test
    mode and the Stripe test card `4242 4242 4242 4242`, after which a Pro
    feature must actually work.

The workflow enforces this. `tools/e2e.mjs` writes `e2e-results.json`, and
`tools/cws.mjs` refuses to upload unless that file matches the zip's version
with zero failed and zero skipped. Never add a bypass flag, never mark a test
skipped to get it through, and never upload by any other path.

Test mode is automatic for unpacked installs: ExtPay gives them a
`development` key. It needs the ExtensionPay developer password, stored in
secret `EXTPAY_DEV_PASSWORD`. The purchase test refuses to type a card unless
the page title says "test mode" and the Stripe URL contains `cs_test_`.

**The loop.** When asked to release (or when a release is due):
1. Run the gate locally in release-gate mode (see Commands).
2. **Pass:** decide the version.
   - If the current `package.json` version is already live or already
     tagged, bump it: patch for fixes, minor for features.
   - Add a `## x.y.z — YYYY-MM-DD` entry to CHANGELOG written for users.
   - Commit, push to `main`, then `git tag vX.Y.Z && git push origin vX.Y.Z`.
   - Watch the Release workflow until it reports `submitted: PENDING_REVIEW`
     (or `PUBLISHED`). Then report the result in one short message.
3. **Fail:** find the root cause, fix it, and run the gate again. Up to
   **3 fix attempts** per failure. Fix the product, not the test. Change a
   test only when the test itself is wrong, and say why in the commit
   message. If it's still failing after 3 attempts, stop and send the
   maintainer the failing test, the error, and what was tried.
4. Contact the maintainer only for a step that needs their login
   (dashboard, ExtensionPay, Google, Stripe), for anything under hard rule 1,
   or after step 3 gives up.
5. Store review can reject an update. If it's rejected, read the reason and
   fix it under the same loop. If the fix would change the extension's
   purpose, permissions, or privacy claims, ask first.

## Review watcher and rejection fixes

- `.github/workflows/review-watch.yml` runs daily at 13:23 UTC.
  - It reads the store status (`tools/cws.mjs status --out`) and commits
    `release/store-status.json` only when the status changed.
  - It opens one `store-review` issue (assigned to the owner) when an update
    is rejected, warned or taken down, and closes it once a newer version is
    live.
  - A keepalive call stops GitHub from disabling the schedule after 60 quiet
    days.
- **The store API never returns the rejection reason.** It's only in
  Google's email and the dashboard, so the issue asks the owner to paste it.
  That owner comment starts `.github/workflows/store-fix.yml`:
  - **fix** job: Claude Code headless, with no store or payment secrets,
    writes the fix on `fix/store-review-<n>` and runs the tests.
  - **guard** job: `tools/fix-guard.mjs`, plain code. It releases the fix
    (fast-forwards main, tags, dispatches `release.yml`, which runs the full
    gate) unless the diff touches purpose, permissions, privacy, CI or the
    release tooling. In that case it opens a PR for the owner instead.
- Needs repo secret `CLAUDE_CODE_OAUTH_TOKEN` and the Claude GitHub App
  installed on the repo.

## Release pipeline

Stages 1, 2 and 5 are built. Stage 3 is planned. Stage 4 was dropped.
Pushing a version tag starts the release, and the pipeline runs on its own
after that.

### 1. Build and test (exists: `.github/workflows/ci.yml`)
Runs on every push and PR: typecheck → unit → build → e2e under xvfb, with
`CI` set so the live payment test is skipped. Don't loosen it.

### 2. Store assets (exists: `tools/screenshots.mjs`, `tools/capture-tiles.mjs`)
Screenshots must be exactly 1280×800. The small promo tile must be exactly
440×280 and the marquee exactly 1400×560, because the store rejects any size
that isn't exact. `capture-tiles.mjs` clips to integer layout bounds and
throws if a PNG comes out the wrong size. Don't go back to
`locator.screenshot()`: it rounded a fractional offset and produced 440×281.

### 3. Listing text and landing page (planned: `tools/gen-listing.mjs`)
- One source file, `store/listing.json`, holds the name, short description,
  long description, feature bullets, and permission justifications.
- The script writes `STORE_LISTING.md` and fills marked regions in
  `docs/index.html` (`<!-- gen:features -->…<!-- /gen:features -->`). Keep
  the hand-written layout and styles; only the marked regions are generated.
- The script checks the store limits and fails the build if one is broken:
  manifest `name` ≤ 75 characters, manifest `description` (this *is* the
  store short description) ≤ 132, and each justification ≤ 1,000.
- Store facts that shape this stage:
  - The store **title is the manifest `name`** ("CrumbSweep"), and the
    **short description is the manifest `description`**. The SEO title and
    short description drafted in `STORE_LISTING.md` are not live until
    they're moved into `constants.ts`.
  - The Web Store API **cannot edit listing text, screenshots, or the privacy
    form**. Those are pasted into the Developer Dashboard by hand. The
    generator only produces text to paste, and it never pretends to sync it.
- Run it in CI with `--check`: regenerate, then fail if `git diff` is not empty.

### 4. Payments (decided 2026-11-18: no Stripe API code)
Pro stays on ExtensionPay. ExtensionPay creates the Stripe objects through
Stripe Connect, and the product and price are managed in the ExtensionPay
dashboard. Don't add a Stripe SDK, Stripe keys, or Payment Links to this
repo. A Payment Link can't tell the extension who paid, and the alternative
(a webhook plus a license server) would break the "we operate no servers"
promise.

### 5. Publish to the Chrome Web Store (planned: `.github/workflows/release.yml`)
- Triggered by pushing a `v*.*.*` tag, or by `workflow_dispatch` with
  `dry_run: true` as the default.
- **verify** job: checks the tag equals the `package.json` version and that
  `CHANGELOG.md` has an entry for it. Then it runs typecheck and unit tests,
  runs `npm run package`, and runs e2e in release-gate mode against that
  same `dist/`. It uploads the zip plus `e2e-results.json` as the artifact
  `tested-build`.
- **release** job: downloads `tested-build` and never rebuilds, so the bytes
  that were tested are the bytes uploaded. It runs the gate and uploads, then
  attaches the same zip to a GitHub Release.
- **publish** job: runs in `environment: chrome-web-store`, which scopes the
  secrets. It has no required reviewer, because the tag push is the
  approval. Steps:
  1. `tools/cws.mjs` (no dependencies) signs a JWT with the service-account
     key in `CWS_SERVICE_ACCOUNT_KEY` and exchanges it for an access token.
     It reads the live status and refuses to upload when the package isn't
     newer than the live version, a review is pending, or the item is taken
     down. Don't switch to an OAuth refresh token: Google expires those after
     7 days for apps left in "Testing" status, so it would break silently.
  2. `POST https://chromewebstore.googleapis.com/upload/v2/publishers/$CWS_PUBLISHER_ID/items/kohfndmjmmfbmkiagfndfoglpimiaman:upload`
     with the zip as the body. Poll the upload status until it succeeds.
  3. `POST …/v2/publishers/$CWS_PUBLISHER_ID/items/kohfndmjmmfbmkiagfndfoglpimiaman:publish`
     with the default publish type, so the update goes live automatically
     once review passes.
  - Use API **V2**. v1.1 support ended 2026-10-15. With `dry_run`, every
    step before upload runs.
- Status: **built**. Pushing a `v*.*.*` tag releases. Running the workflow
  by hand from `main` (`gh workflow run release.yml`) is always a dry run.
- Secrets: `CWS_SERVICE_ACCOUNT_KEY` and `CWS_PUBLISHER_ID` (set
  2026-11-18), plus `EXTPAY_DEV_PASSWORD` (set by the maintainer), all
  secrets on the `chrome-web-store` environment. That
  environment accepts deployments only from branch `main` and tags
  `v*.*.*`. Never echo the secrets, and never put them in the repo.
- Local check, read-only:
  `CWS_SERVICE_ACCOUNT_KEY_FILE=<key.json> CWS_PUBLISHER_ID=… CWS_EXTENSION_ID=… node tools/cws.mjs status`
- The Google Cloud project `extension-publisher` and its service account
  `cws-publisher@extension-publisher-515116.iam.gserviceaccount.com` are
  **shared by all of the maintainer's extensions**. Don't rename them or
  scope them to CrumbSweep. The key lives in gitignored `JSON/`.

## Store-readiness status (checked 2026-11-18, local v0.5.1, live v0.1.0)

OK: MV3 with a service worker; `minimum_chrome_version` 120; no remote code
(ExtPay is bundled); no `eval`, `new Function`, or `innerHTML` in `src/`;
icons 16/32/48/128 at the correct sizes; five 1280×800 screenshots; privacy
policy hosted, matches behavior, and discloses ExtensionPay/Stripe; every
permission has a justification; `notifications` is optional; the content
script runs only on `extensionpay.com`. Typecheck, 103 unit tests, and 25/25
e2e tests pass (1 skipped).

To fix or decide:
- The live store has **0.1.0** (updated 2026-08-04). Versions 0.4.0–0.5.1
  were never uploaded, so the first automated release ships Pro and the
  payment flow together. `CHANGELOG` 0.5.0 says not to upload 0.5.x until
  Stripe is connected in ExtensionPay. Only the maintainer can confirm that.
- "Extension Tools" is the maintainer's intended business name. It's the
  store's "Offered by" line and the live Stripe public business name and
  statement descriptor. The Stripe **Sandbox** shows a different name that
  can't be changed. Only tests see it, so it's not a release blocker, but it
  must still never appear in logs (hard rule 2).
- The privacy form in `STORE_LISTING.md` says "check nothing". That predates
  the payment flow. Payment details and email go to ExtensionPay/Stripe on
  their site, not through the extension. Re-read the form wording before the
  next submission.
- `tabs` permission is probably redundant: `<all_urls>` already exposes
  `tab.url`, and `tabs.query`/`onRemoved`/`create` don't need it. Removing it
  shrinks what reviewers look at. Remove it only if e2e still passes.
- `<all_urls>` means every update gets an in-depth review. Expect a review of
  several days, and keep the prepared reviewer answer in `STORE_LISTING.md`.
- Never save the service-account JSON key inside the repo folder. Once it's
  in GitHub secrets, delete the downloaded file. (`.env*` is gitignored as a
  backstop.)
