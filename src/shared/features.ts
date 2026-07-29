// Paid-tier capability checks. Everything is free tier today; this indirection
// exists so gated call sites don't change when entitlement lookup is added.
export type ProFeature =
  | "containerRules"
  | "scheduledDeepCleans"
  | "listCloudSync";

export function hasFeature(_feature: ProFeature): boolean {
  return false;
}
