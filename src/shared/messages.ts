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

export type Message =
  | CleanDomainNowMessage
  | CleanAllExceptWhitelistMessage
  | SetPauseMessage;

export interface CleanNowResponse {
  removed: number;
}
