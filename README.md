# CrumbSweep 🍪🧹

[![CI](https://github.com/dookofcards/crumbsweep/actions/workflows/ci.yml/badge.svg)](https://github.com/dookofcards/crumbsweep/actions/workflows/ci.yml)

**Automatically deletes a site's cookies when you close its last tab.**
Whitelist the sites you trust; everything else gets swept.

A [Manifest V3](https://developer.chrome.com/docs/extensions/develop/migrate)
Chrome extension and a spiritual successor to Cookie AutoDelete, which was
discontinued when Chrome retired Manifest V2. If you're switching,
**CrumbSweep imports your Cookie AutoDelete list in one click.**

👉 **[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/crumbsweep/kohfndmjmmfbmkiagfndfoglpimiaman)** · **[Website](https://dookofcards.github.io/crumbsweep/)** · **[Privacy policy](https://dookofcards.github.io/crumbsweep/privacy-policy.html)**

## How it works

1. Close the last tab for a site → a grace period starts (**15 seconds** by
   default, configurable 0–300s).
2. Reopen the site in time? Nothing happens — your session survives.
3. Otherwise the site's cookies are deleted automatically — unless the site
   is on your whitelist.

Matching is per **whole site** (eTLD+1 via the public suffix list), so
`mail.google.com` and `google.com` count as one site — and
`user-a.github.io` and `user-b.github.io` correctly count as two.

## Features

- **Whitelist** (never clean) and **greylist** (keep until browser restart)
- One-click add-current-site from the popup
- **Import your Cookie AutoDelete JSON export** — whitelist and greylist
  carry over; plain domain-per-line text files work too; export as JSON
- Clean the current site on demand, or everything except your whitelist
- Opt-in deeper cleaning: localStorage, IndexedDB, cache, service workers
- Pause auto-cleaning (15 min / 1 hour / until you resume)
- Badge counter: cookies cleaned today or for the current site
- Pinned tabs are never cleaned while pinned
- Conservative defaults — cookies only, nothing aggressive

## Privacy: zero data collection

No analytics, no telemetry, no accounts, no servers, **no network requests
of any kind**. The public suffix list is bundled. Everything runs and stays
on your device. Host access to all sites exists solely because Chrome's
cookie API requires it to *delete* cookies. See the
[privacy policy](docs/privacy-policy.html) — and since the code is right
here, you can verify all of this yourself.

## Building from source

Requires Node.js 24+.

```sh
npm install
npm run build      # development build → dist/ (load unpacked)
npm run watch      # rebuild on change
npm test           # unit tests (vitest)
npm run typecheck  # strict TypeScript check
npm run package    # minified store-ready crumbsweep-v<version>.zip
```

Load it: `chrome://extensions` → enable Developer mode → **Load unpacked** →
select `dist/`. The manual QA checklist lives in [TESTING.md](TESTING.md).

## Architecture (MV3 notes)

The background service worker can be killed at any moment, so **all state
lives in `chrome.storage`** — tab tracking is rebuilt from
`chrome.tabs.query` on every worker start, and grace-period countdowns are a
persistent queue driven by `chrome.alarms` (plus a soft timer for sub-30s
precision while the worker is alive). Cleanup can land late, never early.

```
src/
  background/serviceWorker.ts   event wiring only, thin
  core/tabTracker.ts            per-site open-tab refcounting, rebuildable
  core/cleanupQueue.ts          persistent pending-cleanup queue + alarms
  core/cleaner.ts               cookie + opt-in browsingData deletion
  core/lists.ts                 whitelist/greylist, eTLD+1 matching
  core/importExport.ts          Cookie AutoDelete import, JSON export
  core/badge.ts                 toolbar badge counter
  popup/ · options/ · onboarding/
  shared/                       settings schema, constants, messages
```

## Support

Found a bug or want a feature?
[Open an issue](../../issues). Please include your Chrome version and, for
cleaning bugs, the site involved.

CrumbSweep is free and collects nothing, which also means it earns nothing.
If it saved you some hassle, you can
[buy me a coffee](https://buymeacoffee.com/dookofcards) — entirely optional,
every feature stays free either way.

## License

[MIT](LICENSE) for the code. The CrumbSweep name, logo, and store artwork
are not covered — see [NOTICE](NOTICE) if you plan to fork and redistribute.

Not affiliated with or endorsed by Cookie AutoDelete; "Cookie AutoDelete" is
referenced only to describe compatibility.
