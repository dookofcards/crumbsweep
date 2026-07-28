# CrumbSweep — Manual QA Checklist

Run against a build loaded unpacked from `dist/` (`npm run build`, then
`chrome://extensions` → Load unpacked). Automated unit tests: `npm test`.

**Cookie inspection helper** — in the extension's service worker console:

```js
chrome.cookies.getAll({ domain: "example.com" }).then(c => console.log(c.length, c));
```

**State inspection** — `chrome.storage.local.get(console.log)` (tab tracking,
pending queue, stats, pause) and `chrome.storage.sync.get(console.log)`
(settings, lists).

## Install & baseline

- [ ] Loads unpacked with no errors/warnings on the extension card.
- [ ] Service worker console is clean (no errors) after install and after
      browsing for a few minutes.
- [ ] Onboarding page opens exactly once, on first install (not on reload or
      update). Chips whitelist/un-whitelist open sites; import works; grace
      period text matches settings.
- [ ] DevTools → Network on any extension page: **zero network requests** at
      runtime (everything is bundled).

## Core loop

- [ ] **Last-tab close cleans after grace period:** open a cookie-setting
      site, close its last tab, wait grace + a few seconds → cookies gone.
- [ ] **Reopen within grace cancels:** close last tab, Ctrl+Shift+T within
      the grace period → cookies survive; nothing cleans later.
- [ ] **eTLD+1 grouping:** with tabs on `mail.google.com` and
      `www.google.com`, closing only one does NOT clean; closing both does.
- [ ] **Grace period setting respected:** set 60s → clean happens after ~60s
      not 15s. Set 0s → cleans within a couple of seconds.
- [ ] **SW killed mid-countdown still cleans:** close a site's last tab, then
      immediately kill the worker (chrome://serviceworker-internals → Stop,
      or close its DevTools and wait). Cookies are still cleaned, at up to
      ~30s late (alarm minimum) — late is OK, never early.
- [ ] **Pinned tab exemption:** site pinned in one window; open+close a
      normal tab for it elsewhere → never cleaned while the pin exists.

## Lists

- [ ] Whitelisted site is never cleaned (tab close + wait).
- [ ] Greylisted site is NOT cleaned on tab close.
- [ ] **Greylist cleaned on browser restart:** greylist a site, quit Chrome
      fully (check background processes), relaunch → its cookies are gone.
- [ ] Whitelist survives browser restart.
- [ ] Popup pill matches options page state in both directions.
- [ ] Adding a URL (`https://mail.google.com/x`) to a list stores `google.com`.
- [ ] A domain moved to one list disappears from the other.

## Import / export

- [ ] `samples/cad-export-sample.json` imports: `github.com` + `google.com`
      white, `wikipedia.org` + `example.co.uk` grey, 4 skipped.
- [ ] Re-importing the same file adds 0 (idempotent merge).
- [ ] Plain .txt import prompts for target list; domains normalize.
- [ ] Import never demotes a whitelisted domain to grey.
- [ ] Export → re-import round-trips after deleting an entry.
- [ ] A garbage file shows the friendly error, adds nothing.

## Popup

- [ ] Clean-now removes cookies immediately (even whitelisted/open — explicit
      action), reports the count, bumps counters.
- [ ] chrome:// pages show "no site cookies to manage", counters intact.
- [ ] Counters: today resets on date rollover; total never does.

## Deep clean (opt-in), badge, pause, notifications

- [ ] With localStorage opt-in: value set in DevTools is gone after
      auto-clean; without opt-in it survives while cookies are cleaned.
- [ ] Badge "today" counts up on cleans; "current site" mode switches with
      the active tab; "off" clears; changes apply immediately from options.
- [ ] Pause: badge shows grey "II"; tab closes during pause never clean, even
      after resume; timed pause expires on its own; "until I resume" persists
      across browser restart; greylist startup-clean is skipped while paused.
- [ ] Notifications: toggle prompts for permission; denying reverts the
      toggle; enabled → toast on auto-clean only (not clean-now).
- [ ] "Clean all except whitelisted" spares the whitelist, cleans greylist,
      shows confirm first.

## Incognito

- [ ] Default (not allowed in incognito): incognito browsing is untouched.
- [ ] With "Allow in Incognito" enabled: closing the last incognito tab for a
      site cleans the incognito cookie store; a site open ONLY in incognito
      is not cleaned while that tab lives.
