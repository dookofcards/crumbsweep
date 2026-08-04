// ExtensionPay integration — the only code in CrumbSweep that touches the
// network, and it is unreachable until the user asks for it.
//
// Three constraints shaped this file:
//
// 1. "No network requests of any kind" is the headline privacy claim. So
//    ExtPay is not bundled into the service worker: it is a separate file
//    pulled in with importScripts() only after the user has clicked Upgrade.
//    A user who never clicks never loads it, never parses it, never connects.
//
// 2. ExtPay.js is AGPLv3 while CrumbSweep is MIT. Shipping it as a discrete,
//    unmodified file keeps the two separable and identifiable rather than
//    melting AGPL code into an MIT bundle. See NOTICE.
//
// 3. The upstream sample registers a content script on every http(s) page.
//    That is unacceptable here — the extensionpay.com match is the only one
//    needed for payment callbacks, and it is the only one in our manifest.
import { EXTENSIONPAY_ID, paymentConfigured } from "../shared/constants.ts";
import { getEntitlement, setEntitlement } from "../shared/features.ts";

const EXTPAY_SCRIPT = "extpay/ExtPay.js";
const PURCHASE_INITIATED_KEY = "purchaseInitiated";
/** Entitlement is cached; re-check at most weekly, never on every startup. */
const REVALIDATE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

interface ExtPayUser {
  paid: boolean;
  paidAt: string | Date | null;
  email: string | null;
}

interface ExtPayClient {
  getUser: () => Promise<ExtPayUser>;
  openPaymentPage: (planNickname?: string) => Promise<void>;
  onPaid: { addListener: (callback: (user: ExtPayUser) => void) => void };
  startBackground: () => void;
}

declare function importScripts(...urls: string[]): void;

export async function hasInitiatedPurchase(): Promise<boolean> {
  const stored = await chrome.storage.local.get(PURCHASE_INITIATED_KEY);
  return stored[PURCHASE_INITIATED_KEY] === true;
}

async function markPurchaseInitiated(): Promise<void> {
  await chrome.storage.local.set({ [PURCHASE_INITIATED_KEY]: true });
}

let client: ExtPayClient | undefined;

/**
 * Loads ExtPay on first use. Module scope dies with the service worker, so
 * this re-runs after a wake-up — importScripts is idempotent within a worker
 * and the whole path is gated on the user having opted in.
 */
function loadClient(): ExtPayClient | undefined {
  if (client !== undefined) return client;
  if (!paymentConfigured()) return undefined;
  try {
    const global = self as unknown as {
      ExtPay?: (id: string) => ExtPayClient;
    };
    if (global.ExtPay === undefined) importScripts(EXTPAY_SCRIPT);
    if (global.ExtPay === undefined) return undefined;
    client = global.ExtPay(EXTENSIONPAY_ID);
    return client;
  } catch {
    // Missing file or a blocked import must never break sweeping, which is
    // the part of the extension that actually matters.
    return undefined;
  }
}

/**
 * Wires payment callbacks — but only for a user who has already started a
 * purchase. Everyone else keeps a service worker that cannot reach the
 * network at all.
 */
export async function startPaymentBackground(): Promise<void> {
  if (!paymentConfigured()) return;
  if (!(await hasInitiatedPurchase())) return;
  const extpay = loadClient();
  if (extpay === undefined) return;
  extpay.startBackground();
  extpay.onPaid.addListener((user) => {
    void setEntitlement(user.paid === true);
  });
}

/** The one place a network connection is opened, from an explicit click. */
export async function beginUpgrade(): Promise<boolean> {
  if (!paymentConfigured()) return false;
  await markPurchaseInitiated();
  const extpay = loadClient();
  if (extpay === undefined) return false;
  extpay.startBackground();
  extpay.onPaid.addListener((user) => {
    void setEntitlement(user.paid === true);
  });
  await extpay.openPaymentPage();
  return true;
}

/**
 * Re-checks a cached entitlement at most weekly. A network failure keeps the
 * cached answer: a paying user must not lose their features because their
 * wifi dropped.
 */
export async function revalidateEntitlement(force = false): Promise<void> {
  if (!paymentConfigured()) return;
  if (!(await hasInitiatedPurchase())) return;
  const entitlement = await getEntitlement();
  if (!force && Date.now() - entitlement.checkedAt < REVALIDATE_INTERVAL_MS) {
    return;
  }
  const extpay = loadClient();
  if (extpay === undefined) return;
  try {
    const user = await extpay.getUser();
    await setEntitlement(user.paid === true);
  } catch {
    // Offline, or ExtensionPay is down. Keep what we had.
  }
}
