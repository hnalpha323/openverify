/**
 * C55.5-C55.7: what an OTP request writes besides its code: a limit refusal (after which the user
 * may submit and the check answers `otp_delivery_unavailable`), the environment budget's trip
 * (one audit entry an hour), and the server's own submit of a verification that has no way left
 * to get a code (C55.6) or took ten wrong entries (C55.5). Every writer takes the C40.6 lock order:
 * the inquiry, then the verification, then its OTP rows.
 */
import { OTP_SMS_BUDGET_TRIPPED_AUDIT_ACTION } from '@openverify/contracts';
import {
  closeOpenOtpChallenges,
  latestAuditLogAt,
  lockInquiry,
  lockOtpSmsBudget,
  lockVerification,
  recordOtpLimited,
  type Db,
  type OtpLimitedReason,
  type Verification,
  type VerificationWithChecks,
} from '@openverify/db';
import type { StagedEvent } from '../../events/index.js';
import { Phase5ProblemError } from '../../errors.js';
import { appendSystemAuditEntry } from '../audit-log.js';
import type { ApiDependencies } from '../context.js';
import type { FlowVerificationTarget } from '../flow-preconditions.js';
import { moveVerification, stageVerificationEvent } from '../verifications.js';
import type { OtpLimitOutcome } from './limits.js';
import type { OtpRequestContext } from './send.js';

const HOUR_MS = 3_600_000;

/** C52.7: the problem of a limit refusal, or of the limit store being down. */
export const RATE_LIMITED_DETAIL =
  'Too many codes were asked for; continue to submit the verification for review.';
const STORE_UNAVAILABLE_DETAIL =
  'Codes cannot be sent or checked right now; continue to submit the verification for review.';

/**
 * C55.6: records that a limit (or its store) refused the user, under the lock order; nothing once
 * the verification has left `initiated`.
 */
export async function recordLimitRefusal(
  deps: ApiDependencies,
  target: FlowVerificationTarget,
  reason: OtpLimitedReason,
): Promise<void> {
  const { environmentId, id, inquiryId } = target.verification;
  await deps.db.transaction(async (tx) => {
    await lockInquiry(tx, environmentId, inquiryId);
    const locked = await lockVerification(tx, environmentId, id);
    if (locked?.status === 'initiated') {
      await recordOtpLimited(
        tx,
        environmentId,
        { verificationId: id, inquiryId },
        reason,
        deps.clock.now(),
      );
    }
  });
}

/**
 * C55.7 (V08): the environment's SMS budget tripped: one `environment.otp-sms-budget-tripped`
 * entry an hour at most, serialized across API instances, which the settings serve as
 * `otp-sms-budget-tripped-at`. A failure to record it is logged; the refusal stands.
 */
export async function recordBudgetTrip(
  deps: ApiDependencies,
  environmentId: string,
  budgetPerHour: number,
  request: OtpRequestContext,
): Promise<void> {
  try {
    await deps.db.transaction(async (tx) => {
      await lockOtpSmsBudget(tx, environmentId);
      const latest = await latestAuditLogAt(tx, environmentId, OTP_SMS_BUDGET_TRIPPED_AUDIT_ACTION);
      if (latest !== null && latest.getTime() > deps.clock.now().getTime() - HOUR_MS) {
        return;
      }
      await appendSystemAuditEntry(tx, environmentId, {
        action: OTP_SMS_BUDGET_TRIPPED_AUDIT_ACTION,
        resourceType: 'environment',
        resourceId: environmentId,
        metadata: { 'otp-sms-max-per-hour': budgetPerHour },
      });
    });
  } catch (error) {
    request.log.warn(
      { environmentId, error: (error as Error).name },
      'the OTP SMS budget trip was not recorded',
    );
  }
}

/**
 * Throws the C55.7 problem of a refused `outcome`, recording the refusal first when its limit
 * names a reason (the per-IP limit does not); returns when it was allowed.
 */
export async function refuseUnlessAllowed(
  deps: ApiDependencies,
  target: FlowVerificationTarget,
  outcome: OtpLimitOutcome,
): Promise<void> {
  if (outcome.allowed) {
    return;
  }
  if ('storeUnavailable' in outcome) {
    await recordLimitRefusal(deps, target, 'store_unavailable');
    throw new Phase5ProblemError('otp_rate_limited', STORE_UNAVAILABLE_DETAIL, {
      storeUnavailable: true,
    });
  }
  if (outcome.reason !== null) {
    await recordLimitRefusal(deps, target, outcome.reason);
  }
  throw new Phase5ProblemError('otp_rate_limited', RATE_LIMITED_DETAIL, {
    headers: { 'retry-after': String(outcome.retryAfterSeconds) },
  });
}

/**
 * The server submits `verification` (locked, `initiated`) in `tx`: its open code is closed and
 * `verification.submitted` staged; `null` when it was no longer `initiated`. Dispatch and enqueue
 * with {@link afterServerSubmit} once `tx` committed.
 */
export async function submitByServerInTx(
  tx: Db,
  deps: ApiDependencies,
  verification: Verification,
  checks: VerificationWithChecks['checks'],
  now: Date,
): Promise<StagedEvent[] | null> {
  await closeOpenOtpChallenges(tx, verification.environmentId, verification.id, 'superseded');
  const moved = await moveVerification(tx, verification, 'submitted', now);
  if (moved?.event == null) {
    return null;
  }
  return [
    await stageVerificationEvent(tx, deps.events, moved.event, { ...moved.verification, checks }, []),
  ];
}

/** Dispatches the events of a server submit and enqueues the verification's job. */
export async function afterServerSubmit(
  deps: ApiDependencies,
  verification: Pick<Verification, 'environmentId' | 'id'>,
  staged: StagedEvent[],
): Promise<void> {
  await deps.events.dispatch(staged);
  await deps.queue.enqueueProcessVerification({
    environmentId: verification.environmentId,
    verificationId: verification.id,
  });
}
