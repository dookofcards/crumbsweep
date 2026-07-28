# Chrome Web Store Listing — Draft

> SEO targets woven into title/description: "cookie autodelete alternative",
> "delete cookies on tab close", "auto delete cookies", "manifest v3".
> All copy below is draft — edit freely. Screenshots still needed (popup,
> options, onboarding; 1280×800).

## Title (max 45 chars)

CrumbSweep – Auto Delete Cookies on Tab Close

## Short description (max 132 chars)

Automatically deletes a site's cookies when you close its last tab.
Whitelist sites you trust. A Cookie AutoDelete alternative.

## Category

Privacy & Security (or Workflow & Planning → Tools; Privacy preferred)

## Description

Close a tab, lose the crumbs. CrumbSweep automatically deletes cookies for a
site shortly after you close its last tab — so trackers don't follow you
around, and sites you never signed up for don't get to keep their data.

Looking for a Cookie AutoDelete alternative? Cookie AutoDelete was
discontinued when Chrome retired Manifest V2. CrumbSweep is built for
Manifest V3 from scratch — and it imports your Cookie AutoDelete whitelist
in one click, so switching takes seconds.

HOW IT WORKS
• Close the last tab for a site → a grace period starts (15 seconds by
  default, configurable 0–300s)
• Reopen the site in time? Nothing happens.
• Otherwise, the site's cookies are auto-deleted
• Whitelisted sites are never touched — stay logged in where it matters

FEATURES
• Whitelist (keep always) and greylist (keep until browser restart)
• One-click "whitelist this site" from the popup
• Import your old Cookie AutoDelete list (JSON), plain domain lists, and
  export your own
• Clean a site's cookies on demand, or everything except your whitelist
• Optional deeper cleaning: localStorage, IndexedDB, cache, service workers
  (off by default — you opt in)
• Pause auto-cleaning for 15 minutes, an hour, or until you resume
• Badge counter: cookies cleaned today or for the current site
• Whole-site matching: mail.google.com and google.com are one site
• Pinned tabs are never cleaned while pinned
• Conservative defaults: cookies only, sensible grace period, no surprises

PRIVACY: ZERO DATA COLLECTION
CrumbSweep collects nothing. No analytics, no tracking, no accounts, no
network requests — ever. Everything runs and stays on your device (your
settings sync only through your own Chrome profile). The code needs access
to all sites ("Read and change all your data on all websites") for one
reason only: Chrome's cookie API requires host access to delete a site's
cookies. That access is used exclusively to delete data, never to read or
send it anywhere.

Auto delete cookies. Keep the logins you choose. Sweep the rest.

## Single-purpose description (for the review form)

Automatically deletes site cookies (and, opt-in, related site data) when the
site's last tab is closed, with user-managed whitelist/greylist exceptions.

## Permission justifications (for the review form)

- cookies + host access <all_urls>: enumerate and delete cookies for any
  site the user browses; the extension's core function.
- tabs: track which sites have open tabs to know when a site's last tab
  closes; read the active tab's domain for the popup.
- storage: persist settings, lists, counters, and pending-cleanup state.
- alarms: fire the grace-period cleanup even if the service worker is
  suspended (Manifest V3).
- browsingData: opt-in removal of localStorage/IndexedDB/cache/service
  workers for cleaned sites.
- notifications (optional, runtime-requested): only if the user enables
  "notify when a site is cleaned".

## Privacy policy URL

The repo's `docs/` folder is a ready-made GitHub Pages site (repo Settings →
Pages → deploy from branch `main`, folder `/docs`). Once enabled:

- Website: `https://dookofcards.github.io/crumbsweep/`
- Privacy policy: `https://dookofcards.github.io/crumbsweep/privacy-policy.html`
  ← use this as the listing's privacy policy URL

## Support URL

`https://github.com/dookofcards/crumbsweep/issues`

## If the reviewer asks follow-up questions

Broad host permissions get extra scrutiny. Prepared response, adapt as
needed:

> CrumbSweep's single purpose is deleting cookies for sites the user closes.
> `chrome.cookies.getAll` / `chrome.cookies.remove` only operate on cookies
> whose host is covered by the extension's host permissions; since the user
> may close a tab for any site, cookie deletion requires `<all_urls>`. The
> extension cannot use `activeTab` or a fixed host list: cleaning happens
> after the tab is closed (no active tab exists), for domains that cannot be
> known in advance. No content scripts are injected, no page content is
> read, no webRequest listeners exist, and the extension makes zero network
> requests — the full source is public at
> https://github.com/dookofcards/crumbsweep and every build is reproducible
> from it (`npm ci && npm run package`).

Data-collection disclosure form: check **nothing** (no data collected in any
category); certify compliance.
