// Typed popup/options -> service worker messages.
export interface CleanDomainNowMessage {
  type: "cleanDomainNow";
  domain: string;
}

export interface CleanAllExceptWhitelistMessage {
  type: "cleanAllExceptWhitelist";
}

import type { PauseUntil } from "./pause.ts";

export interface SetPauseMessage {
  type: "setPause";
  /** Epoch ms, "indefinite", or null to resume. */
  until: PauseUntil | null;
}

export interface UndoSweepMessage {
  type: "undoSweep";
  sweepId: string;
}

/** Opens the ExtensionPay checkout. The only message that touches a network. */
export interface BeginUpgradeMessage {
  type: "beginUpgrade";
}

export type Message =
  | CleanDomainNowMessage
  | CleanAllExceptWhitelistMessage
  | SetPauseMessage
  | UndoSweepMessage
  | BeginUpgradeMessage;

export interface BeginUpgradeResponse {
  /** False when payment is not configured for this build. */
  started: boolean;
}

export interface CleanNowResponse {
  removed: number;
}

export interface UndoSweepResponse {
  restored: number;
  failed: number;
  available: boolean;
}
