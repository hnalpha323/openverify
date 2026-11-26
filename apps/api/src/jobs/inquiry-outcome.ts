/**
 * When an inquiry is done (contracts C7, C30.5, C50.5). Each verification type the flow requires
 * is judged on its latest verification that was sent: an `initiated` one was never submitted
 * and a `confirmed` one (phone and email, C50.7) only had its code accepted, so a stray or
 * abandoned one neither hides an earlier result nor keeps the inquiry open:
 * - it fails once a required type has no attempt left: its latest verification failed and
 *   either that failure is not retryable (a fraud check failed, so there is nothing the user
 *   can fix and nothing to hint) or the step's attempts (`stepMaxAttempts`) are used up;
 * - a `canceled` verification counts as a failed attempt the user can retry: while the inquiry
 *   is pending, only the selfie capture cap cancels one (C40.2, the 11th capture create); every
 *   other cancel (expiry, the inquiry actions) ends the inquiry first;
 * - a latest `skipped` verification (AAMVA only, C50.7) is done, as a passed one is;
 * - a silent AAMVA step (`source: government_id`, C59.6) is judged on the attempt bound to the
 *   latest decided government ID verification, and is open until the worker created that
 *   attempt. The user can retry neither it nor, by then, the ID, so its failure is final, and
 *   the attempts the server created never use up the step's own;
 * - otherwise, once the latest verification of every required type is decided (`passed`,
 *   `skipped` or `needs_review`): `completed` when none needs review, else `needs_review`,
 *   which the worker applies as `completed` then `needs_review` in one transaction. An inquiry
 *   is never approved here;
 * - otherwise it stays pending, so the user can retry (a retry creates a new verification).
 */
import {
  isVerificationStep,
  STEP_VERIFICATION_TYPES,
  stepMaxAttempts,
  type SupportedVerificationType,
} from '@openverify/contracts';
import type { Flow } from '@openverify/flow-spec';

export interface RequiredVerification {
  type: SupportedVerificationType;
  maxAttempts: number;
  /**
   * C59.6: an `aamva` step with `source: government_id`, whose attempts the worker creates from
   * the government ID decisions.
   */
  silent?: true;
}

/** What the outcome needs to know about each verification of the inquiry. */
export interface VerificationSummary {
  type: string;
  status: string;
  /** For a failed verification: whether only user-fixable checks failed. */
  retryable: boolean;
  /** The verification's id: what a server-created AAMVA attempt is bound to (C59.6). */
  id?: string;
  /**
   * C59.6: for an AAMVA attempt the server created, the government ID verification it was
   * created from (`verification_inputs.source_verification_id`, Stage 1b); otherwise absent
   * or `null`.
   */
  sourceVerificationId?: string | null;
}

/** `needs_review` means: complete the inquiry, then mark it for review (C30.5). */
export type InquiryOutcome = 'completed' | 'failed' | 'needs_review';

/** The verification steps of a flow and how many attempts each allows (C50.2, C50.5). */
export function requiredVerifications(flow: Flow): RequiredVerification[] {
  return flow.steps.filter(isVerificationStep).map((step) => ({
    type: STEP_VERIFICATION_TYPES[step.type],
    maxAttempts: stepMaxAttempts(step),
    ...(step.type === 'aamva' && step.source === 'government_id' ? { silent: true as const } : {}),
  }));
}

/**
 * Where a required type stands: done (`passed`, a skip included), in `review`, `exhausted` (it ended
 * without passing: no attempt left, or a failure the user cannot fix) or still `open`.
 */
export type TypeState = 'passed' | 'review' | 'exhausted' | 'open';

/** Statuses of attempts that were never submitted, so say nothing yet (C50.7). */
const UNSENT: ReadonlySet<string> = new Set(['initiated', 'confirmed']);

/** The government ID statuses that run the C59.6 hook, which creates the silent attempt. */
const DECIDED_ID: ReadonlySet<string> = new Set(['passed', 'needs_review', 'failed']);

/**
 * C59.6: the silent AAMVA attempt bound to the latest decided government ID verification, or
 * `undefined` while the worker has not created it (or no ID was decided yet).
 */
function boundAttempt(
  verifications: readonly VerificationSummary[],
): VerificationSummary | undefined {
  const decided = verifications
    .filter(
      (verification) =>
        verification.type === 'government_id' && DECIDED_ID.has(verification.status),
    )
    .at(-1);
  if (decided?.id === undefined) {
    return undefined;
  }
  return verifications
    .filter(
      (verification) =>
        verification.type === 'aamva' &&
        verification.sourceVerificationId === decided.id &&
        !UNSENT.has(verification.status),
    )
    .at(-1);
}

/** C151.2, C151.3: the state of one required type (the flow engine reads each step's this way). */
export function verificationTypeState(
  required: RequiredVerification,
  verifications: readonly VerificationSummary[],
): TypeState {
  const ofType = verifications.filter(
    (verification) => verification.type === required.type && !UNSENT.has(verification.status),
  );
  const latest = required.silent === true ? boundAttempt(verifications) : ofType.at(-1);
  if (latest?.status === 'passed' || latest?.status === 'skipped') {
    return 'passed';
  }
  if (latest?.status === 'needs_review') {
    return 'review';
  }
  if (latest === undefined || !isFailedAttempt(latest)) {
    return 'open';
  }
  if (required.silent === true) {
    return 'exhausted';
  }
  const failures = ofType.filter(
    (verification) => isFailedAttempt(verification) && !isServerCreated(verification),
  ).length;
  const retryable = latest.status === 'canceled' || latest.retryable;
  return !retryable || failures >= required.maxAttempts ? 'exhausted' : 'open';
}

/** A failed attempt: failed, or canceled by the capture cap (C40.2), which the user can retry. */
const isFailedAttempt = (verification: VerificationSummary): boolean =>
  verification.status === 'failed' || verification.status === 'canceled';

/** C59.6: an AAMVA attempt the worker created; it never uses up the step's attempts. */
const isServerCreated = (verification: VerificationSummary): boolean =>
  verification.sourceVerificationId != null;

/**
 * The status the inquiry moves to, or `null` while it should stay pending.
 * @param verifications every verification of the inquiry, oldest first.
 */
export function decideInquiryOutcome(
  required: readonly RequiredVerification[],
  verifications: readonly VerificationSummary[],
): InquiryOutcome | null {
  if (required.length === 0) {
    return null;
  }
  const states: TypeState[] = required.map((entry) => verificationTypeState(entry, verifications));
  if (states.includes('exhausted')) {
    return 'failed';
  }
  if (!states.every((state) => state === 'passed' || state === 'review')) {
    return null;
  }
  return states.includes('review') ? 'needs_review' : 'completed';
}

/** The parts of a stored check that decide retryability. */
export interface StoredCheckOutcome {
  type: string;
  status: string;
  requirement: string;
}

/**
 * Whether a failed verification can be retried by the user: at least one required check
 * failed, and every required check that failed is a `user_behavior` check. This is the
 * decision engine's `retryable`, recomputed from stored checks.
 */
export function isRetryableFailure(checks: readonly StoredCheckOutcome[]): boolean {
  const failing = checks.filter(
    (check) => check.status === 'failed' && check.requirement === 'required',
  );
  return failing.length > 0 && failing.every((check) => check.type === 'user_behavior');
}
