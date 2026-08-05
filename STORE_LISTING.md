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

SEE WHAT IT SWEPT
• Activity log: what was cleaned, when, and which cookies came from a
  different site than the one you were on
• Undo a sweep: closed a tab and lost a session you wanted? Put the cookies
  back with one click

CRUMBSWEEP PRO (optional, one-time)
Everything above is free and always will be. Pro adds precision:
• Stay logged in — keep a site's login cookie while sweeping its trackers,
  instead of whitelisting the whole site and keeping both
• Keep specific cookies — pick exactly which of a site's cookies survive
• Restore older sweeps (undoing the most recent one stays free)
• Scheduled deep clean — daily or weekly

PRIVACY: ZERO DATA COLLECTION
CrumbSweep collects nothing. No analytics, no tracking, no accounts. The
free version makes no network requests of any kind. Everything runs and
stays on your device (your settings sync only through your own Chrome
profile). The code needs access to all sites ("Read and change all your data
on all websites") for one reason only: Chrome's cookie API requires host
access to delete a site's cookies. That access is used exclusively to delete
data, never to read or send it anywhere.

If you choose to buy Pro, payment is handled by ExtensionPay. That is the
only situation in which CrumbSweep contacts a server, it happens only after
you click Upgrade, and it never sends your lists, settings, or anything
about your browsing.

Auto delete cookies. Keep the logins you choose. Sweep the rest.

## Single-purpose description (for the review form)

Automatically deletes site cookies (and, opt-in, related site data) when the
site's last tab is closed, with user-managed whitelist/greylist exceptions.

## Permission justifications (one field per permission, max 1,000 chars each)

### cookies

CrumbSweep's single purpose is deleting a site's cookies after the user
closes its last tab. This permission is the core of that function:
chrome.cookies.getAll() enumerates the cookies of the site being cleaned (or
shown in the popup), and chrome.cookies.remove() deletes them, across all
cookie stores, including partitioned (CHIPS) cookies. Cookie data is
enumerated only to be deleted — never read for any other purpose, stored, or
transmitted. Cookie data is never sent anywhere; the extension's only
network access is the optional payment flow described below, which sends no
cookie or browsing data at all.

### tabs

Used to detect the triggering event of the extension's single purpose: a
site's last tab closing. The extension listens to tab open/close/navigation
events and keeps a per-site count of open tabs so it can start the
grace-period countdown when a count reaches zero, cancel it if the user
reopens the site, and exempt sites with pinned tabs. It also reads the
active tab's URL so the popup can show the current site's protection status.
Only the URL's domain is used; browsing history is not recorded, stored
beyond the open-tab bookkeeping, or transmitted.

### storage

Persists all extension state: user settings (grace period, opt-in data
types, badge mode), the whitelist/greylist (in chrome.storage.sync so lists
follow the user's own Chrome profile), cleaned-cookie counters, and internal
bookkeeping (per-site open-tab counts and the pending-cleanup queue). This
persistence is required under Manifest V3 because the service worker can be
terminated at any time. All data stays in extension storage on the user's
device; nothing is transmitted anywhere.

### alarms

Grace-period countdowns must survive service worker termination under
Manifest V3. When a site's last tab closes, the cleanup's due time is
persisted and a chrome.alarms alarm is scheduled to wake the service worker
and perform the deletion even if the worker was killed mid-countdown. A
setTimeout would silently die with the worker; alarms are the only reliable
mechanism for this.

### browsingData

Used only for the optional "deeper clean" the user can enable in settings —
removing localStorage, IndexedDB, cache, and service workers for the
specific origins of a site being cleaned, via chrome.browsingData.remove()
with an origins filter. All of these options are OFF by default; if the user
enables none of them, this API is never called.

### notifications

Optional permission, requested at runtime only if the user turns on "Show a
brief notification when a site is cleaned" in settings (off by default).
Used solely to show that toast — the site name and number of cookies
removed. If the user declines the permission prompt, the setting reverts and
stays off.

### Host permission (<all_urls>)

Cookie deletion is the extension's single purpose, and chrome.cookies can
only access cookies for hosts covered by host permissions. Because the user
may close a tab for any website, cleaning requires <all_urls>. Narrower
alternatives cannot work: activeTab is unusable because cleaning happens
after the tab is closed (no active tab exists), and a fixed host list is
impossible because the sites a user will visit cannot be known in advance.
Host access is used exclusively to delete cookies and, opt-in, related site
data. The extension reads no page content and uses no webRequest listeners.
Its only content script matches https://extensionpay.com/* and exists solely
to receive the payment-completed callback for the optional one-time Pro
purchase; it runs on no other site and touches no user content. Full source
code is public: https://github.com/dookofcards/crumbsweep

### Remote code / network use (for the review form)

No remote code. All code is bundled in the package. The optional Pro
purchase is handled by the ExtensionPay library, which ships inside the
package as extpay/ExtPay.js and is loaded only after the user clicks
"Unlock CrumbSweep Pro". A user who never clicks it makes no network
requests at all, which can be confirmed in the service worker's DevTools
Network panel. No cookie data, browsing data, lists, or settings are ever
transmitted.

## Privacy policy URL

The repo's `docs/` folder is a ready-made GitHub Pages site (repo Settings →
Pages → deploy from branch `main`, folder `/docs`). Once enabled:

- Website: `https://dookofcards.github.io/crumbsweep/`
- Privacy policy: `https://dookofcards.github.io/crumbsweep/privacy-policy.html`
  ← use this as the listing's privacy policy URL

## Support URL

`https://github.com/dookofcards/crumbsweep/issues`

## Test instructions (for the reviewer)

No account, login, or configuration is required. To verify the core function:

1. Install — an onboarding tab opens automatically.
2. Visit https://www.wikipedia.org and confirm it set cookies (DevTools →
   Application → Cookies).
3. Close the Wikipedia tab and wait ~30 seconds (default grace period is
   15s; it can fire up to ~30s later if the service worker was suspended).
4. Revisit wikipedia.org — its cookies were deleted (the site treats you as
   a first-time visitor; DevTools shows cookies freshly re-created).
5. Whitelist test: click the toolbar icon on any site → "Whitelist this
   site" → close the site's tabs, wait 30s, revisit — cookies survive and
   the popup shows a green "Protected" badge.
6. The grace period, greylist, opt-in data types, and list import/export
   are on the options page.
7. The options page also shows an Activity log of what was swept. It records
   cookie names only, never values, and is stored locally.

Paid features (optional): the Pro section of the options page is inactive
unless the user makes a one-time purchase. To review those features without
paying, run this in the extension's service worker console and reload:

    chrome.storage.local.set({ proEntitlement: { active: true, checkedAt: Date.now() } })

All processing is local. Unless the user clicks "Unlock CrumbSweep Pro", the
extension makes no network requests at all, which can be confirmed in the
service worker's DevTools Network panel. Source code:
https://github.com/dookofcards/crumbsweep

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
