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

export type Message =
  | CleanDomainNowMessage
  | CleanAllExceptWhitelistMessage
  | SetPauseMessage
  | UndoSweepMessage;

export interface CleanNowResponse {
  removed: number;
}

export interface UndoSweepResponse {
  restored: number;
  failed: number;
  available: boolean;
}
