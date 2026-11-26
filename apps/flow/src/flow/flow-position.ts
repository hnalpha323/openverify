/**
 * Where the user is in a server-driven flow, derived only from `GET /api/v1/flow/session`.
 *
 * C151 (Workflow 9A, ADR 0008): the server decides every step. A Phase 9 session names its
 * `position` and serves the current step's client view (`step`, to a client that declared spec 2);
 * this client renders that step and never evaluates a transition or a route. Within the step, the
 * session's own facts (the consent, the verification attempts, the handoff state) say which screen
 * of the step to show, as before.
 *
 * A session without a `position` (from a server before Phase 9) is read as the v1 projection
 * (C151.6): its steps in list order. Its transitions are neither evaluated nor followed: the server
 * owns the path, refuses any step but the current one (`flow_step_not_current`, C151.4), and a
 * Phase 9 server always sends its position.
 *
 * Steps this client cannot run are reported as `unsupported`, never skipped.
 */
import {
  type FlowHandoff,
  type FlowSessionResponse,
  type FlowVerificationResource,
  isHandoffDone,
  type RetryHint,
  stepMaxAttempts,
  toVerificationResourceType,
  verificationTypeForStep,
} from '@openverify/contracts';
import type { FlowStep, ScreenClientView, ShareConsentClientView } from '@openverify/flow-spec';

/**
 * A step of the session's `flow`: a v1 step, or (C151.6, Workflow 9A Stage 1a (F)) a projection's
 * `server-continuation` placeholder, which this client cannot run and reports as unsupported.
 */
export type SessionFlowStep = FlowSessionResponse['flow']['steps'][number];

/** C150.5: how often a waiting session is read again when the server gives no hint (Workflow 9A). */
export const WAIT_POLL_MS = 2_000;

/** C151.5: the current step's client view, as a spec-2 session serves it. */
export type ClientStep = NonNullable<FlowSessionResponse['step']>;

/** C148.1: a `screen` step, as its client view serves it (never its `name`). */
export type ScreenStep = ScreenClientView;

export type ConsentStep = Extract<FlowStep, { type: 'consent' }>;
export type GovernmentIdStep = Extract<FlowStep, { type: 'government_id' }>;
export type SelfieStep = Extract<FlowStep, { type: 'selfie' }>;
export type PhoneOtpStep = Extract<FlowStep, { type: 'phone_otp' }>;
export type EmailOtpStep = Extract<FlowStep, { type: 'email_otp' }>;
/** C55: a step that confirms a destination with a one-time code. */
export type OtpStep = PhoneOtpStep | EmailOtpStep;
export type CryptoWalletStep = Extract<FlowStep, { type: 'crypto_wallet' }>;
export type DatabaseStep = Extract<FlowStep, { type: 'database' }>;
/** C50.3: `source: form` shows the AAMVA form; `source: government_id` has no screen (C59.6). */
export type AamvaStep = Extract<FlowStep, { type: 'aamva' }>;
/** C50.3, C60: a proof of address or another supporting document, uploaded as a PDF or a photo. */
export type DocumentStep = Extract<FlowStep, { type: 'document' }>;
/** C50.3, C61: a business looked up in business registries. */
export type DatabaseBusinessStep = Extract<FlowStep, { type: 'database_business' }>;
/** C50.3, C61: a business website, by its URL. */
export type BusinessWebsiteStep = Extract<FlowStep, { type: 'business_website' }>;
/** The steps the user does one verification attempt at a time. */
export type VerificationStep =
  | GovernmentIdStep
  | SelfieStep
  | OtpStep
  | CryptoWalletStep
  | DatabaseStep
  | AamvaStep
  | DocumentStep
  | DatabaseBusinessStep
  | BusinessWebsiteStep;
export type CompletionStep = Extract<FlowStep, { type: 'completion' }>;
/** C96.1 (Workflow 7A): the step that moves a desktop flow to a phone. */
export type HandoffStep = Extract<FlowStep, { type: 'device_handoff' }>;
export type FailureStep = Extract<FlowStep, { type: 'failure' }>;

/**
 * C207.10 (Workflow 10C): the `nfc` step as the session serves it: the projection's step, or the
 * spec-2 client view, which adds `fallbackAvailable` (C207.9).
 */
export type NfcStepView = Extract<SessionFlowStep | ClientStep, { type: 'nfc' }>;

export type UnsupportedReason =
  /** A step type this version of the web flow cannot run. */
  'step';

export type FlowPosition =
  | { readonly kind: 'consent'; readonly step: ConsentStep }
  /** C148: a screen of components, with the values of its fields the session sent (C151.5). */
  | {
      readonly kind: 'screen';
      readonly step: ScreenStep;
      readonly values: NonNullable<FlowSessionResponse['values']>;
    }
  /**
   * C150.5, C152.2: the server is waiting (a branch's facts, an action's workflow) or has not
   * moved on yet; the session is read again every `retryAfterMs`.
   */
  | { readonly kind: 'waiting'; readonly stepId: string | null; readonly retryAfterMs: number }
  /** C151.2: the flow stopped at its caps (`flow_loop_limit`); an operator resumes or expires it. */
  | { readonly kind: 'halted' }
  | {
      readonly kind: 'capture';
      readonly step: VerificationStep;
      /** 1-based attempt the user is about to make. */
      readonly attempt: number;
      readonly maxAttempts: number;
      /** An `initiated` verification to reuse, or `null` to create one. */
      readonly verificationId: string | null;
      /** User-fixable reasons the previous attempt failed. */
      readonly hints: readonly RetryHint[];
      /**
       * C64.1: the initiated attempt of a Phase 5 step being resumed, whose guidance says where it
       * stands (an open code, values already received).
       */
      readonly verification?: FlowVerificationResource;
      /** C64.1: the previous attempt was canceled (a wallet's challenge cap): start again. */
      readonly restarted?: true;
    }
  | {
      /** C64.1: a confirmed code is submitted at once, so resuming never strands it. */
      readonly kind: 'confirmed';
      readonly step: OtpStep;
      readonly verificationId: string;
      readonly attempt: number;
      readonly maxAttempts: number;
    }
  | {
      /** C59.6: a silent AAMVA step; the server creates, submits or skips its attempt. */
      readonly kind: 'silent';
      readonly step: AamvaStep;
    }
  | {
      readonly kind: 'processing';
      readonly step: VerificationStep;
      readonly verificationId: string;
      readonly attempt: number;
      readonly maxAttempts: number;
    }
  | {
      /** The last attempt failed; waiting for the server to fail the inquiry. */
      readonly kind: 'finalizing';
      readonly step: VerificationStep;
    }
  | { readonly kind: 'completion'; readonly step: CompletionStep | null }
  | { readonly kind: 'failure'; readonly step: FailureStep | null }
  | { readonly kind: 'expired' }
  | {
      readonly kind: 'unsupported';
      readonly step: SessionFlowStep | ClientStep;
      readonly reason: UnsupportedReason;
    }
  /**
   * C238.6 (Workflow 11A): a `share_consent` step's client view, composed by the server;
   * `clients-connect`'s screen (`steps/share-consent/`).
   */
  | { readonly kind: 'share-consent'; readonly step: ShareConsentClientView }
  /** C207.10 (Workflow 10C): an `nfc` step; `api-nfc`'s screen (`steps/nfc/`) says what a browser can do. */
  | { readonly kind: 'nfc'; readonly step: NfcStepView }
  /**
   * C96.3 (Workflow 7A; F01, V05): a handoff step not done yet (`pending`, `issued`, `rejected`,
   * `declined`, or no state from the server); `flow-handoff` builds its screen.
   */
  | {
      readonly kind: 'handoff';
      readonly step: HandoffStep;
      /** The state the server serves, or `null` from a server that serves none. */
      readonly handoff: FlowHandoff | null;
    };

type InquiryStatus = FlowSessionResponse['inquiry']['status'];

/**
 * Inquiry statuses after which the user has nothing left to do. Review outcomes (`approved`,
 * `declined`, `needs_review`) come after the user's part is complete, so the flow shows its
 * completion screen for them and never reveals the decision.
 */
const FINISHED: ReadonlySet<InquiryStatus> = new Set([
  'completed',
  'approved',
  'declined',
  'needs_review',
]);

function firstOfType<Type extends 'completion' | 'failure'>(
  steps: readonly SessionFlowStep[],
  type: Type,
): Extract<FlowStep, { type: Type }> | null {
  const found = steps.find((step) => step.type === type);
  return (found as Extract<FlowStep, { type: Type }> | undefined) ?? null;
}

/** The terminal step the server serves, else the first of its type the projection lists. */
function terminalStep<Type extends 'completion' | 'failure'>(
  session: FlowSessionResponse,
  type: Type,
): Extract<FlowStep, { type: Type }> | null {
  const served = session.step;
  if (served?.type === type) {
    return served as Extract<FlowStep, { type: Type }>;
  }
  return firstOfType(session.flow.steps, type);
}

function terminalPosition(session: FlowSessionResponse): FlowPosition | null {
  const { status } = session.inquiry;
  if (FINISHED.has(status)) {
    return { kind: 'completion', step: terminalStep(session, 'completion') };
  }
  if (status === 'failed') {
    return { kind: 'failure', step: terminalStep(session, 'failure') };
  }
  if (status === 'expired') {
    return { kind: 'expired' };
  }
  return null;
}

const isOtpStep = (step: VerificationStep): step is OtpStep =>
  step.type === 'phone_otp' || step.type === 'email_otp';

/** The attempts of `step`'s verification type, oldest first. */
function attemptsOf(
  step: VerificationStep,
  verifications: readonly FlowVerificationResource[],
): FlowVerificationResource[] {
  const type = verificationTypeForStep(step.type);
  const resourceType = type === null ? null : toVerificationResourceType(type);
  return verifications.filter((verification) => verification.type === resourceType);
}

/** The position for an unfinished verification step, or `null` once the step is done. */
function verificationPosition(
  step: VerificationStep,
  verifications: readonly FlowVerificationResource[],
): FlowPosition | null {
  const attempts = attemptsOf(step, verifications);
  const latest = attempts.at(-1);
  const used = attempts.length;
  // C50.2: the step's own count, else its type's default.
  const maxAttempts = stepMaxAttempts(step);
  // Government ID and selfie keep their Phase 1-4 positions; the Phase 5 steps add what C64.1 needs.
  const phase5 = step.type !== 'government_id' && step.type !== 'selfie';
  const nextAttempt = (hints: readonly RetryHint[], restarted = false): FlowPosition =>
    used < maxAttempts
      ? {
          kind: 'capture',
          step,
          attempt: used + 1,
          maxAttempts,
          verificationId: null,
          hints,
          ...(restarted ? { restarted: true } : {}),
        }
      : { kind: 'finalizing', step };

  if (latest === undefined) {
    return nextAttempt([]);
  }
  const { status, 'retry-hints': hints } = latest.attributes;
  switch (status) {
    // C30.6: a verification an operator reviews is done for the user, without retry hints.
    case 'passed':
    case 'skipped':
    case 'needs_review':
      return null;
    case 'initiated':
      return {
        kind: 'capture',
        step,
        attempt: used,
        maxAttempts,
        verificationId: latest.id,
        hints: [],
        ...(phase5 ? { verification: latest } : {}),
      };
    case 'confirmed':
      if (isOtpStep(step)) {
        return { kind: 'confirmed', step, verificationId: latest.id, attempt: used, maxAttempts };
      }
      return { kind: 'processing', step, verificationId: latest.id, attempt: used, maxAttempts };
    case 'submitted':
      return { kind: 'processing', step, verificationId: latest.id, attempt: used, maxAttempts };
    case 'failed':
    case 'requires_retry':
      // C30.1, C50.5: a failure without a hint failed a fraud check, which is never retryable, so
      // the server fails the inquiry. It decides the verification before it settles the inquiry,
      // so wait for that rather than offer an attempt it would refuse.
      return hints.length === 0 ? { kind: 'finalizing', step } : nextAttempt(hints);
    case 'canceled':
      // C64.1: a wallet attempt ends when its challenges run out (C57.2): say so, then start again.
      return nextAttempt([], step.type === 'crypto_wallet');
  }
}

/**
 * C59.6: a silent AAMVA step has no screen and the client never creates or submits it. It is done
 * once the server's latest attempt is decided or skipped; a failure has no retry (C50.5), so the
 * inquiry is about to fail; anything else waits on the server.
 */
function silentPosition(
  step: AamvaStep,
  verifications: readonly FlowVerificationResource[],
): FlowPosition | null {
  switch (attemptsOf(step, verifications).at(-1)?.attributes.status) {
    case 'passed':
    case 'skipped':
    case 'needs_review':
      return null;
    case 'failed':
    case 'requires_retry':
      return { kind: 'finalizing', step };
    default:
      return { kind: 'silent', step };
  }
}

/** The position for a step, or `null` when the user has already completed it. */
function stepPosition(
  step: SessionFlowStep | ClientStep,
  session: FlowSessionResponse,
): FlowPosition | null {
  switch (step.type) {
    case 'completion':
      return { kind: 'completion', step };
    case 'failure':
      return { kind: 'failure', step };
    case 'consent':
      return session.consent === null ? { kind: 'consent', step } : null;
    case 'government_id':
    case 'selfie':
    case 'phone_otp':
    case 'email_otp':
    case 'crypto_wallet':
    case 'database':
    case 'document':
    case 'database_business':
    case 'business_website':
      return verificationPosition(step, session.verifications);
    case 'aamva':
      return step.source === 'form'
        ? verificationPosition(step, session.verifications)
        : silentPosition(step, session.verifications);
    // `form` has no screen yet.
    // C151.6 (owner option (i)): a placeholder stands for steps only a spec-2 client runs.
    case 'screen':
      return { kind: 'screen', step, values: session.values ?? {} };
    // C207.10 (Workflow 10C; Phase 5 C64.1 amended): a browser cannot read a chip; `api-nfc`'s
    // screen (`steps/nfc/`) says so and offers the author's fallback where the step has one.
    case 'nfc':
      return { kind: 'nfc', step };
    case 'form':
    case 'server-continuation':
      return { kind: 'unsupported', step, reason: 'step' };
    // C238.6 (Workflow 11A): the share-consent screen is `clients-connect`'s (`steps/share-consent/`),
    // from the client view the server composed; a step without one is the unsupported screen.
    case 'share_consent':
      return 'text' in step
        ? { kind: 'share-consent', step }
        : { kind: 'unsupported', step, reason: 'step' };
    // C96.1, C96.3 (F01, V05): done once the inquiry's handoff is redeemed, continued here or
    // skipped; after a rejection or a decline the step shows again, in its slot in FlowRenderer
    // (Workflow 7A Stage 1b (H)), with `flow-handoff`'s screen. While the phone works the step
    // stays too (K7A-5): the session's writes are refused, so a reloaded desktop must not move on.
    case 'device_handoff':
      return session.handoff !== null &&
        session.handoff !== undefined &&
        isHandoffDone(session.handoff.state) &&
        session.handoff['handed-off'] !== true
        ? null
        : { kind: 'handoff', step, handoff: session.handoff ?? null };
  }
}

type ServerPosition = NonNullable<FlowSessionResponse['position']>;

/** The step a server position names: the served client view, else the projection's entry. */
function currentStep(
  session: FlowSessionResponse,
  stepId: string,
): SessionFlowStep | ClientStep | null {
  if (session.step?.id === stepId) {
    return session.step;
  }
  return session.flow.steps.find((step) => step.id === stepId) ?? null;
}

/** C151.5: the screen for the server's position. */
function serverPosition(session: FlowSessionResponse, position: ServerPosition): FlowPosition {
  const stepId = position['step-id'];
  const waiting: FlowPosition = {
    kind: 'waiting',
    stepId,
    retryAfterMs: position['retry-after-ms'] ?? WAIT_POLL_MS,
  };
  switch (position.state) {
    case 'waiting':
      return waiting;
    case 'halted':
      return { kind: 'halted' };
    case 'ended': {
      // The person's part is over (a completion or failure step, or a missing fact that sends the
      // inquiry to review, C150.4); the inquiry's own status follows in a moment.
      const step = stepId === null ? null : currentStep(session, stepId);
      return step?.type === 'failure'
        ? { kind: 'failure', step }
        : { kind: 'completion', step: step?.type === 'completion' ? step : null };
    }
    case 'active': {
      const step = stepId === null ? null : currentStep(session, stepId);
      // C94.6, C96.5 (Phase 7): a session that holds no consent of its own (a phone a handoff
      // redeemed after the flow passed its consent step) records its own before anything else;
      // the server accepts that consent and it moves nothing.
      // On a flow-spec 2 version the projection leaves that consent out, and the server serves its
      // client view as `step` instead (contracts B48); its members are the v1 consent step's.
      const consent =
        session.flow.steps.find((entry) => entry.type === 'consent') ??
        (session.step?.type === 'consent' ? session.step : undefined);
      if (session.consent === null && consent !== undefined && step?.type !== 'consent') {
        return { kind: 'consent', step: consent };
      }
      if (step === null) {
        // Active with no step this client was given: the server moves on in a moment.
        return waiting;
      }
      // A step whose part is done here (a decided attempt, recorded consent) waits for the server.
      return stepPosition(step, session) ?? waiting;
    }
  }
}

/**
 * A session without a server position: the v1 projection (C151.6), in list order. Nothing is
 * evaluated and no transition is followed (C150.4, C151.5).
 */
function listPosition(session: FlowSessionResponse): FlowPosition {
  for (const step of session.flow.steps) {
    const position = stepPosition(step, session);
    if (position !== null) {
      return position;
    }
  }

  // Every step is done and the flow has no terminal step: the user's part is complete.
  return { kind: 'completion', step: null };
}

/** Resolves the step the user should see now. Pure; never throws. */
export function resolveFlowPosition(session: FlowSessionResponse): FlowPosition {
  const terminal = terminalPosition(session);
  if (terminal !== null) {
    return terminal;
  }
  return session.position === undefined
    ? listPosition(session)
    : serverPosition(session, session.position);
}
