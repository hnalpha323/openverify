/**
 * C151.2, C151.3 (Workflow 9A, api-flow-engine): where a verification step of the flow stands, from
 * the inquiry's verifications of its type, judged as the C7/C30.5/C50.5 rules always judged them
 * (`verificationTypeState`): only the attempts the flow created count (a Phase 8 workflow's
 * verification is never the step's attempt, C151.4), and a failed verification is never counted
 * passed, whatever path follows.
 */
import {
  STEP_VERIFICATION_TYPES,
  stepMaxAttempts,
  type SupportedVerificationType,
  type VerificationStep,
} from '@openverify/contracts';
import type { VerificationWithChecks } from '@openverify/db';
import type { FlowV2Step } from '@openverify/flow-spec';
import {
  isRetryableFailure,
  verificationTypeState,
  type TypeState,
  type VerificationSummary,
} from '../jobs/inquiry-outcome.js';

/** The verification type a step of the flow creates, or `null` for a step that creates none. */
export function stepVerificationType(step: FlowV2Step): SupportedVerificationType | null {
  return Object.hasOwn(STEP_VERIFICATION_TYPES, step.type)
    ? (STEP_VERIFICATION_TYPES[step.type as keyof typeof STEP_VERIFICATION_TYPES] ?? null)
    : null;
}

/** The step's maximum attempts, by the v1 rule (the members are the v1 step's). */
export const maxAttemptsOf = (step: FlowV2Step): number =>
  stepMaxAttempts(step as unknown as VerificationStep);

/** C59.6: an `aamva` step whose attempts the server creates from the government ID decisions. */
export const isSilentStep = (step: FlowV2Step): boolean =>
  step.type === 'aamva' && (step as { source?: string }).source === 'government_id';

/** A verification the flow created: not one a Phase 8 workflow step created. */
export const isFlowVerification = (verification: VerificationWithChecks): boolean =>
  (verification as { workflowRunStepId?: string | null }).workflowRunStepId == null;

export interface StepVerificationOutcome {
  state: TypeState;
  /**
   * The step's outcome as `flowOutcome` and the projection read it: `passed`, `skipped`,
   * `needs_review` or `failed` once decided, `pending` while open.
   */
  status: 'passed' | 'skipped' | 'needs_review' | 'failed' | 'pending';
  /** Sent attempts (`initiated` and `confirmed` were never sent). */
  attempts: number;
  attemptsRemaining: number;
  /** The latest sent attempt, whose checks and extraction the scope reads. */
  latest: VerificationWithChecks | null;
}

const UNSENT: ReadonlySet<string> = new Set(['initiated', 'confirmed']);

/** Summaries the outcome rules read, with each AAMVA attempt's source (C59.6). */
export function summariesOf(
  verifications: readonly VerificationWithChecks[],
  sources: ReadonlyMap<string, string | null> = new Map(),
): VerificationSummary[] {
  return verifications.filter(isFlowVerification).map((verification) => ({
    id: verification.id,
    type: verification.type,
    status: verification.status,
    retryable: isRetryableFailure(verification.checks),
    sourceVerificationId: sources.get(verification.id) ?? null,
  }));
}

/** Where `step` stands among the inquiry's verifications (oldest first). */
export function stepVerificationOutcome(
  step: FlowV2Step,
  verifications: readonly VerificationWithChecks[],
  sources: ReadonlyMap<string, string | null> = new Map(),
): StepVerificationOutcome | null {
  const type = stepVerificationType(step);
  if (type === null) {
    return null;
  }
  const maxAttempts = maxAttemptsOf(step);
  const state = verificationTypeState(
    { type, maxAttempts, ...(isSilentStep(step) ? { silent: true as const } : {}) },
    summariesOf(verifications, sources),
  );
  const sent = verifications.filter(
    (verification) =>
      isFlowVerification(verification) &&
      verification.type === type &&
      !UNSENT.has(verification.status),
  );
  const latest = sent.at(-1) ?? null;
  const failures = sent.filter(
    (verification) => verification.status === 'failed' || verification.status === 'canceled',
  ).length;
  const status: StepVerificationOutcome['status'] =
    state === 'passed'
      ? latest?.status === 'skipped'
        ? 'skipped'
        : 'passed'
      : state === 'review'
        ? 'needs_review'
        : state === 'exhausted'
          ? 'failed'
          : 'pending';
  return {
    state,
    status,
    attempts: sent.length,
    attemptsRemaining: Math.max(0, maxAttempts - failures),
    latest,
  };
}
