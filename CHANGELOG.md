# Changelog

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
