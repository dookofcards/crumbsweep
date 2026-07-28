// Single source of truth for branding and defaults.
// The build script injects EXTENSION_NAME into the manifest, so a rename
// only ever happens here.

export const EXTENSION_NAME = "CrumbSweep";
export const EXTENSION_DESCRIPTION =
  "Automatically deletes a site's cookies when you close its last tab. Whitelist the sites you trust; everything else gets swept.";

/** Seconds to wait after the last tab for a domain closes before cleaning. */
export const DEFAULT_GRACE_PERIOD_SECONDS = 15;

/** Grace period bounds for the options slider. */
export const MIN_GRACE_PERIOD_SECONDS = 0;
export const MAX_GRACE_PERIOD_SECONDS = 300;
