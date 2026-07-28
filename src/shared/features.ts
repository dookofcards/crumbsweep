// Pro-tier seam. The MVP ships free-only: every capability check returns
// false and there is deliberately no payment code. When the ExtensionPay
// unlock lands (post-launch), hasFeature becomes a lookup against the
// stored entitlement — call sites don't change.
export type ProFeature =
  | "containerRules"
  | "scheduledDeepCleans"
  | "listCloudSync";

export function hasFeature(_feature: ProFeature): boolean {
  return false; // free tier
}
