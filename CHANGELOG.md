# Changelog

## 0.3.0 — 2026-08-04

- **Undo a sweep.** Closed a tab and lost a session you wanted? The popup
  offers to put the cookies back, with every attribute intact.
- Cookies waiting to be restored are held in memory only, never written to
  disk. They last 10 minutes and are gone when Chrome closes — the popup
  says so rather than implying more.
- Sweeps too large to hold are not offered for undo at all, instead of
  restoring part of one and calling it done.

## 0.2.0 — 2026-08-04

- **Activity log.** Options now shows what was swept: a 7-day summary, the
  hosts that set the most cookies, and a per-sweep breakdown grouped by day.
  Cookies set by a different site than the one you visited are called out.
- Popup shows the three most recent sweeps.
- History is metadata only — cookie names, hosts, counts and timestamps.
  Values are never written to storage. Kept 30 days on this device, cleared
  with one button, never sent anywhere.

## 0.1.1 — 2026-08-04

- Options page footer: version number, website link, and a support link

## 0.1.0 — 2026-07-28

Initial release.

- Auto-clean a site's cookies after its last tab closes, with a configurable
  grace period (default 15s; reopening in time cancels)
- Whitelist (keep always) and greylist (keep until browser restart)
- Cookie AutoDelete JSON import, plain domain-list import, JSON export
- Popup: site status, one-click listing, clean-now, cleaned counters
- Options: grace slider, opt-in localStorage/IndexedDB/cache/service-worker
  cleaning, list management, clean-all-except-whitelist
- Toolbar badge (today / current site / off), pause (15 min / 1 h / manual),
  optional clean notifications
- Whole-site matching via the public suffix list (incl. private suffixes)
- Pinned-tab exemption; all cookie stores handled; partitioned (CHIPS)
  cookies included
- Zero data collection; no runtime network requests
