// Heuristic: is this cookie the thing that keeps you logged in?
//
// The compromise at the heart of this category is that protecting a site
// means whitelisting it — and keeping all of its trackers too. This splits
// that: keep the login, sweep the rest.
//
// Guessing wrong in the two directions is not symmetric. Keeping a tracker by
// mistake is a small privacy miss the user can correct with a rule. Dropping
// a session by mistake logs someone out of their bank. So the deny list is
// checked first and wins, and beyond that the rules lean toward keeping.
import { domainForHost } from "./domain.ts";

/**
 * Analytics and ad cookies that would otherwise trip the auth patterns.
 * Hotjar's `_hjSessionUser_123` is the motivating case: it contains
 * "session" and is not one.
 */
const TRACKER_PATTERNS: RegExp[] = [
  /^_ga($|_)/i, // Google Analytics
  /^_gid$|^_gat/i,
  /^__utm/i,
  /^_fbp$|^_fbc$|^fr$/i, // Meta
  /^_hj/i, // Hotjar, incl. _hjSessionUser_*
  /^_uet[sv]id$/i, // Microsoft UET
  /^_clck$|^_clsk$|^MUID$|^ANONCHK$|^SRM_B$/i, // Microsoft Clarity / Bing
  /^IDE$|^DSID$|^NID$|^1P_JAR$|^AID$|^TAID$/i, // DoubleClick / Google ads
  /^personalization_id$/i,
  /^mp_[0-9a-f]+_mixpanel$/i,
  /^__hstc$|^__hssrc$|^__hssc$|^hubspotutk$/i,
  /^ajs_/i, // Segment
  /^amplitude_/i,
  /^intercom-/i,
  /^optimizely/i,
  /^cto_/i, // Criteo
  /^sc_at$|^scid$/i, // Snap
  /^_pin_unauth$|^_pinterest_/i,
  /^_tt_enable_cookie$|^_ttp$/i, // TikTok
  /^li_sugr$|^bcookie$|^bscookie$|^UserMatchHistory$/i, // LinkedIn ads
  /^_rdt_uuid$/i, // Reddit ads
  /^guest_id/i,
];

/**
 * Names that mean "you are signed in". Anchored to word boundaries so `sid`
 * matches `sid` and `PHP_sid` but not `considered`.
 */
const AUTH_PATTERNS: RegExp[] = [
  /(^|[._-])sess(ion)?([._-]?id)?([._-]|$)/i,
  /(^|[._-])s?sid([._-]|$)/i,
  /(^|[._-])auth(entication)?([._-]|$)/i,
  /(^|[._-])(access|refresh|id)?[._-]?token([._-]|$)/i,
  /(^|[._-])jwt([._-]|$)/i,
  /(^|[._-])login([._-]|$)/i,
  /(^|[._-])remember([._-]|$)/i,
  /(^|[._-])credential/i,
  /(^|[._-])csrf|xsrf/i, // not auth, but losing it breaks every form post
  /^phpsessid$/i,
  /^jsessionid$/i,
  /^asp\.net_sessionid$/i,
  /^connect\.sid$/i,
  /^_?identity/i,
  /^sails\.sid$/i,
  /^laravel_session$/i,
  /^_rails_session$/i,
  /^wordpress_logged_in/i,
  /^ci_session$/i,
];

const matchesAny = (name: string, patterns: RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(name));

/**
 * A cookie is protected only when it is first-party to the site being swept,
 * is not a known tracker, and looks like an auth or session cookie.
 *
 * Third-party cookies are never protected: a `sid` set by an ad network is an
 * ad network's id for you, which is exactly what this extension is for.
 */
export function isLikelySessionCookie(
  cookie: Pick<chrome.cookies.Cookie, "name" | "domain">,
  siteDomain: string | null,
): boolean {
  const host = cookie.domain.replace(/^\./, "");
  if (siteDomain !== null && domainForHost(host) !== siteDomain) return false;
  if (matchesAny(cookie.name, TRACKER_PATTERNS)) return false;
  return matchesAny(cookie.name, AUTH_PATTERNS);
}

/** Split a sweep into what to keep and what to remove. */
export function partitionBySession<
  T extends Pick<chrome.cookies.Cookie, "name" | "domain">,
>(cookies: T[], siteDomain: string | null): { keep: T[]; sweep: T[] } {
  const keep: T[] = [];
  const sweep: T[] = [];
  for (const cookie of cookies) {
    (isLikelySessionCookie(cookie, siteDomain) ? keep : sweep).push(cookie);
  }
  return { keep, sweep };
}
