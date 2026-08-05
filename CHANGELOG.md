# Changelog

## 0.5.0 — 2026-08-04

Turns on the Pro purchase flow. **Do not upload this build until the Stripe
account behind ExtensionPay is connected** — until then the checkout page
cannot take money, and offering a purchase that fails is worse than not
offering one.

- CrumbSweep Pro can now be unlocked from the options page. One-time
  payment, handled by ExtensionPay.
- Privacy wording updated everywhere in the same release: the free version
  still makes no network requests of any kind, and the payment exception is
  stated plainly rather than the old claim being quietly softened.
- The payment library loads only after you click Upgrade. Never clicking it
  means no network request is ever made — verified by an automated test.

## 0.4.0 — 2026-08-04

Introduces CrumbSweep Pro. **Nothing that was free became paid**, and it
never will — Pro is only new, additive precision.

- **Stay logged in** (Pro): keep a site's login cookie while sweeping its
  trackers, instead of choosing between whitelisting the whole site and
  losing the session. Third-party cookies are never kept.
- **Keep specific cookies** (Pro): pick exactly which of a site's cookies
  survive, from the popup, with wildcards. Anyone can see the list and tick
  boxes; saving is the part that needs the unlock.
- **Restore older sweeps** (Pro). Undoing the most recent sweep stays free.
- **Scheduled deep clean** (Pro): sweep everything except your whitelist
  daily or weekly, regardless of how you browse. Respects pause, and turning
  it on starts the clock rather than cleaning immediately.
- Sites with a protected cookie keep their localStorage too, since clearing
  it would sign you out anyway.

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
