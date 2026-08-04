// The build script injects these into manifest.json, so a rename happens
// here and nowhere else.
export const EXTENSION_NAME = "CrumbSweep";
export const EXTENSION_DESCRIPTION =
  "Automatically deletes a site's cookies when you close its last tab. Whitelist the sites you trust; everything else gets swept.";

/** Outbound links shown in the UI. Nothing here is fetched at runtime. */
export const HOMEPAGE_URL = "https://dookofcards.github.io/crumbsweep/";
export const SUPPORT_URL = "https://buymeacoffee.com/dookofcards";
const STORE_URL =
  "https://chromewebstore.google.com/detail/crumbsweep/kohfndmjmmfbmkiagfndfoglpimiaman";
export const STORE_REVIEW_URL = `${STORE_URL}/reviews`;

/** Seconds to wait after the last tab for a domain closes before cleaning. */
export const DEFAULT_GRACE_PERIOD_SECONDS = 15;

/** Grace period bounds for the options slider. */
export const MIN_GRACE_PERIOD_SECONDS = 0;
export const MAX_GRACE_PERIOD_SECONDS = 300;
