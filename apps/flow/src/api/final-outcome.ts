/**
 * Answers after which the flow cannot go on, whatever screen made the call (C19):
 * - 401 with `code: session_expired` or `session_canceled` (C10): the session is no longer
 *   active, and a retry with the same token can never succeed. A canceled session's `reason`
 *   (C25.8) says why: its inquiry expired (the link-expired screen), was redacted (the redacted
 *   screen), or finished; a finished inquiry, a missing reason and a reason this version does
 *   not know show the ended screen;
 * - 410: the inquiry was redacted (C9 `redacted`, Workflow 2B F018), so nothing more may be
 *   collected.
 *
 * Every other error stays with the screen that made the call, which offers a retry.
 */
import {
  FLOW_SESSION_INACTIVE_CODES,
  type FlowSessionInactiveCode,
  type Problem,
  type SessionCanceledReason,
} from '@openverify/contracts';
import { FlowApiError, type FlowApiClient } from './flow-api-client';

export type FinalOutcome =
  /** The session's own time ran out, or it was expired through the server API. */
  | 'session-expired'
  /** The session was canceled because its inquiry finished, or for a reason not known here. */
  | 'session-canceled'
  /** The inquiry was redacted (410, or a session canceled with `inquiry_redacted`). */
  | 'redacted'
  /** The session was canceled because its inquiry expired (C25.8 `inquiry_expired`). */
  | 'inquiry-expired';

const BY_CANCEL_REASON: Readonly<Record<SessionCanceledReason, FinalOutcome>> = {
  inquiry_expired: 'inquiry-expired',
  inquiry_redacted: 'redacted',
  inquiry_finished: 'session-canceled',
};

function outcomeOfInactive(code: FlowSessionInactiveCode, problem: Problem): FinalOutcome {
  if (code === 'session_expired') {
    return 'session-expired';
  }
  // A problem's `reason` is also Connect's (`consent_required`, Workflow 11A); only a cancel reason
  // is read here.
  const { reason } = problem;
  return reason !== undefined && Object.hasOwn(BY_CANCEL_REASON, reason)
    ? BY_CANCEL_REASON[reason as SessionCanceledReason]
    : 'session-canceled';
}

function isInactiveCode(code: string | undefined): code is FlowSessionInactiveCode {
  return (FLOW_SESSION_INACTIVE_CODES as readonly (string | undefined)[]).includes(code);
}

/** The final outcome an error means, or `null` when the screen should handle it. */
export function finalOutcomeOf(error: unknown): FinalOutcome | null {
  if (!(error instanceof FlowApiError) || error.kind !== 'http') {
    return null;
  }
  if (error.status === 410) {
    return 'redacted';
  }
  const { problem } = error;
  const code = problem?.code;
  return error.status === 401 && problem !== null && isInactiveCode(code)
    ? outcomeOfInactive(code, problem)
    : null;
}

/**
 * Wraps a client so that any call answered with a final outcome reports it to `onFinal`
 * (which replaces the screen), then rejects as before.
 */
export function withFinalOutcomes(
  client: FlowApiClient,
  onFinal: (outcome: FinalOutcome) => void,
): FlowApiClient {
  const guard = async <T>(call: Promise<T>): Promise<T> => {
    try {
      return await call;
    } catch (error: unknown) {
      const outcome = finalOutcomeOf(error);
      if (outcome !== null) {
        onFinal(outcome);
      }
      throw error;
    }
  };
  return {
    getSession: (signal) => guard(client.getSession(signal)),
    acceptConsent: (body, signal) => guard(client.acceptConsent(body, signal)),
    createVerification: (body, signal) => guard(client.createVerification(body, signal)),
    createSelfieCapture: (verificationId, body, signal) =>
      guard(client.createSelfieCapture(verificationId, body, signal)),
    // Every argument as given, so a call without the C153.2 capture method stays the same call.
    uploadFile: (...args) => guard(client.uploadFile(...args)),
    submitVerification: (verificationId, signal, body) =>
      guard(client.submitVerification(verificationId, signal, body)),
    getVerification: (verificationId, signal) =>
      guard(client.getVerification(verificationId, signal)),
    sendOtp: (verificationId, body, signal) => guard(client.sendOtp(verificationId, body, signal)),
    confirmOtp: (verificationId, body, signal) =>
      guard(client.confirmOtp(verificationId, body, signal)),
    enterInputs: (verificationId, body, signal) =>
      guard(client.enterInputs(verificationId, body, signal)),
    createCryptoChallenge: (verificationId, body, signal) =>
      guard(client.createCryptoChallenge(verificationId, body, signal)),
    // C94.2 (Workflow 7A): a signal body's final outcome ends the flow as any call's does.
    sendSignals: (body, signal) => guard(client.sendSignals(body, signal)),
    // C96.3 (Workflow 7A): the issuing session's handoff calls end the flow alike.
    // Workflow 9A (C148.5, C171.4).
    submitScreen: (stepId, body, signal) => guard(client.submitScreen(stepId, body, signal)),
    extendSelfieCapture: (captureId, signal) =>
      guard(client.extendSelfieCapture(captureId, signal)),
    createHandoff: (body, signal) => guard(client.createHandoff(body, signal)),
    continueHandoffHere: (signal) => guard(client.continueHandoffHere(signal)),
    getCurrentHandoff: (signal) => guard(client.getCurrentHandoff(signal)),
    rejectHandoff: (signal) => guard(client.rejectHandoff(signal)),
    // C160.6 (Workflow 9B): an asset read never ends the flow; it is passed through as it is.
    getThemeAsset: (assetId, signal) => client.getThemeAsset(assetId, signal),
    // C207.10 (Workflow 10C): a client-unable report's final outcome ends the flow as any call's.
    reportClientUnable: (verificationId, reason, signal) =>
      guard(client.reportClientUnable(verificationId, reason, signal)),
    // C238.4, C237.6 (Workflow 11A): a share-consent exit's final outcome ends the flow as any call's.
    acceptShareConsent: (stepId, body, signal) =>
      guard(client.acceptShareConsent(stepId, body, signal)),
    declineShareConsent: (stepId, signal) => guard(client.declineShareConsent(stepId, signal)),
    withdrawShareConsent: (stepId, signal) => guard(client.withdrawShareConsent(stepId, signal)),
  };
}
