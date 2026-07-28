import { getDomain as tldtsGetDomain } from "tldts";

// allowPrivateDomains matches browser cookie-scoping rules: private PSL
// entries like github.io are suffixes, so user-a.github.io and
// user-b.github.io are different sites.
const getDomain = (host: string): string | null =>
  tldtsGetDomain(host, { allowPrivateDomains: true });

/**
 * Registrable domain (eTLD+1) used as the tracking/cleaning unit, so
 * mail.google.com and google.com count as one site. Returns null for URLs
 * we never track or clean (chrome://, file://, extension pages, ...).
 * IPs and intranet hosts have no eTLD+1; the bare hostname is used instead.
 */
/** Registrable domain for a bare hostname (e.g. a cookie's domain attribute). */
export function domainForHost(host: string): string {
  const h = host.replace(/^\./, "").toLowerCase();
  return (getDomain(h) ?? h).toLowerCase();
}

export function domainForUrl(url: string | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (!host) return null;
  return (getDomain(host) ?? host).toLowerCase();
}
