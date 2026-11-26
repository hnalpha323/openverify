/**
 * C55.5: `POST /api/v1/flow/verifications/:id/otp/confirm`, the code the user entered compared with
 * the open one, after the C52.1 preconditions:
 *
 * 1. a code that can no longer be entered answers at once: `otp_not_sent` before any, `otp_expired`
 *    (closing it), `otp_code_exhausted`; with no send left either, the server submits the
 *    verification (409 `otp_not_confirmed`, no dead end, C55.6);
 * 2. the destination's guess budget (fail closed);
 * 3. under the C40.6 locks, an attempt is reserved before the compare (P09: `failed_attempts + 1`
 *    conditional on the code being open, unexpired and under five tries); a code whose key left
 *    the keyring reads as expired; a match confirms the code, releases the attempt and moves the
 *    verification to `confirmed`; a wrong code counts a wrong entry, exhausts the code at its fifth
 *    try and submits the verification at the tenth wrong entry (409 `otp_attempts_exhausted`);
 * 4. after the commit, a wrong code counts against the guess budget and answers 422
 *    `otp_incorrect` with `attempts-remaining` (the counted attempt is committed with it).
 */
import {
  OTP_MAX_ATTEMPTS_PER_CODE,
  OTP_MAX_WRONG_ENTRIES,
  type FlowOtpConfirmBody,
  type FlowVerificationResource,
} from '@openverify/contracts';
import {
  closeOtpChallenge,
  confirmOtpChallenge,
  getOtpVerificationState,
  listOtpChallenges,
  openOtpChallengeDestination,
  otpKey,
  recordOtpWrongEntry,
  reserveOtpChallengeAttempt,
  type OtpChannel,
} from '@openverify/db';
import type { FlowSession } from '../../auth/flow-session.js';
import { ConflictError } from '../../errors.js';
import type { ApiDependencies } from '../context.js';
import {
  requireFlowVerificationUnderLock,
  type FlowVerificationTarget,
} from '../flow-preconditions.js';
import { findVerification, moveVerification } from '../verifications.js';
import { otpCodeMatches } from './codes.js';
import { otpContextOf, otpFlowView } from './context.js';
import { countWrongCode, guessBudgetOutcome } from './limits.js';
import {
  alreadyConfirmed,
  attemptsExhausted,
  codeExhausted,
  expired,
  incorrect,
  notConfirmed,
  notSent,
} from './problems.js';
import { afterServerSubmit, refuseUnlessAllowed, submitByServerInTx } from './records.js';
import { OTP_REQUEST_STATUSES, type OtpRequestContext, type OtpServiceOptions } from './send.js';
import { deliveredChallenge, isUsableCode, outOfCodes } from './state.js';

type Compared =
  | { kind: 'confirmed' }
  | { kind: 'already_confirmed' }
  | { kind: 'incorrect'; attemptsRemaining: number }
  | { kind: 'attempts_exhausted'; staged: Awaited<ReturnType<typeof submitByServerInTx>> }
  | { kind: 'unusable' }
  | { kind: 'key_gone' };

/** The HMAC input of a stored destination: E.164, or the lower-cased address (C55.3). */
function normalizedDestination(channel: OtpChannel, destination: string): string {
  return channel === 'email' ? destination.toLowerCase() : destination;
}

/** C55.5: confirms a code (see the file header). */
export async function confirmOtp(
  deps: ApiDependencies,
  session: FlowSession,
  target: FlowVerificationTarget,
  body: FlowOtpConfirmBody,
  request: OtpRequestContext,
  options: OtpServiceOptions = {},
): Promise<FlowVerificationResource> {
  const { inquiry, verification } = target;
  const { environmentId } = session;
  if (verification.status === 'confirmed') {
    throw alreadyConfirmed();
  }
  const context = await otpContextOf(deps, inquiry, verification);
  const now = deps.clock.now();
  const challenges = await listOtpChallenges(deps.db, environmentId, verification.id);
  const delivered = deliveredChallenge(challenges);
  if (!isUsableCode(delivered, now) || delivered?.destinationIndex == null) {
    return answerUnusable(deps, session, target, now);
  }
  const destinationIndex = delivered.destinationIndex;
  await refuseUnlessAllowed(
    deps,
    target,
    await guessBudgetOutcome(deps.cache, destinationIndex, now),
  );

  const compared = await deps.db.transaction(async (tx): Promise<Compared> => {
    const { verification: locked } = await requireFlowVerificationUnderLock(
      tx,
      session,
      verification.id,
      OTP_REQUEST_STATUSES,
    );
    if (locked.status === 'confirmed') {
      return { kind: 'already_confirmed' };
    }
    const reserved = await reserveOtpChallengeAttempt(tx, environmentId, delivered.id, now);
    if (reserved === null) {
      return { kind: 'unusable' };
    }
    const { challenge } = reserved;
    const key = challenge.codeKeyId === null ? null : otpKey(deps.keyring, challenge.codeKeyId);
    const destination = await openOtpChallengeDestination(tx, environmentId, challenge.id);
    if (key === null || destination === null) {
      // C55.3: the code's KEK left the keyring (or its destination is gone): the user resends.
      await closeOtpChallenge(tx, environmentId, challenge.id, 'expired');
      return { kind: 'key_gone' };
    }
    const binding = {
      verificationId: verification.id,
      channel: context.channel,
      destination: normalizedDestination(context.channel, destination),
    };
    if (otpCodeMatches(key, binding, body.code, reserved.codeHmac)) {
      await confirmOtpChallenge(tx, environmentId, challenge.id, now);
      await moveVerification(tx, locked, 'confirmed', now);
      return { kind: 'confirmed' };
    }
    const counted = await recordOtpWrongEntry(
      tx,
      environmentId,
      { verificationId: verification.id, inquiryId: inquiry.id },
      OTP_MAX_WRONG_ENTRIES,
    );
    if (challenge.failedAttempts >= OTP_MAX_ATTEMPTS_PER_CODE) {
      await closeOtpChallenge(tx, environmentId, challenge.id, 'exhausted');
    }
    if (counted.wrongEntries >= OTP_MAX_WRONG_ENTRIES) {
      return {
        kind: 'attempts_exhausted',
        staged: await submitByServerInTx(tx, deps, locked, verification.checks, now),
      };
    }
    return {
      kind: 'incorrect',
      attemptsRemaining: OTP_MAX_ATTEMPTS_PER_CODE - challenge.failedAttempts,
    };
  });

  switch (compared.kind) {
    case 'confirmed':
      return otpFlowView(
        deps,
        deps.db,
        context,
        await findVerification(deps.db, environmentId, verification.id),
      );
    case 'already_confirmed':
      throw alreadyConfirmed();
    case 'key_gone':
      // Logged without ids (C55.3): which key is gone says nothing about one verification.
      request.log.warn({}, 'a one-time code under a KEK that left the keyring read as expired');
      throw expired();
    case 'unusable':
      return answerUnusable(deps, session, target, now);
    case 'attempts_exhausted': {
      await countWrongCode(deps.rateLimiter, deps.cache, destinationIndex, now, options.limits);
      if (compared.staged === null) {
        throw new ConflictError('The verification is no longer open.');
      }
      await afterServerSubmit(deps, verification, compared.staged);
      throw attemptsExhausted();
    }
    case 'incorrect':
      await refuseUnlessAllowed(
        deps,
        target,
        await countWrongCode(deps.rateLimiter, deps.cache, destinationIndex, now, options.limits),
      );
      throw incorrect(compared.attemptsRemaining);
  }
}

/**
 * A code that can no longer be entered, read again under the locks: with no send left either, the
 * server submits the verification (C55.6); otherwise the problem that says why, an expired open
 * code closed first. A code replaced meanwhile by a newer one reads as expired.
 */
async function answerUnusable(
  deps: ApiDependencies,
  session: FlowSession,
  target: FlowVerificationTarget,
  now: Date,
): Promise<never> {
  const { environmentId } = session;
  const { verification } = target;
  const settled = await deps.db.transaction(async (tx) => {
    const { verification: locked } = await requireFlowVerificationUnderLock(
      tx,
      session,
      verification.id,
      OTP_REQUEST_STATUSES,
    );
    if (locked.status === 'confirmed') {
      return { kind: 'already_confirmed' } as const;
    }
    const challenges = await listOtpChallenges(tx, environmentId, verification.id);
    const state = await getOtpVerificationState(tx, environmentId, verification.id);
    if (outOfCodes(challenges, state, now)) {
      return {
        kind: 'submitted',
        staged: await submitByServerInTx(tx, deps, locked, verification.checks, now),
      } as const;
    }
    const delivered = deliveredChallenge(challenges);
    if (delivered === null) {
      return { kind: 'not_sent' } as const;
    }
    if (delivered.status === 'sent' && delivered.expiresAt.getTime() <= now.getTime()) {
      await closeOtpChallenge(tx, environmentId, delivered.id, 'expired');
      return { kind: 'expired' } as const;
    }
    return delivered.status === 'expired' || isUsableCode(delivered, now)
      ? ({ kind: 'expired' } as const)
      : ({ kind: 'exhausted' } as const);
  });
  switch (settled.kind) {
    case 'already_confirmed':
      throw alreadyConfirmed();
    case 'submitted':
      if (settled.staged === null) {
        throw new ConflictError('The verification is no longer open.');
      }
      await afterServerSubmit(deps, verification, settled.staged);
      throw notConfirmed();
    case 'not_sent':
      throw notSent();
    case 'expired':
      throw expired();
    case 'exhausted':
      throw codeExhausted();
  }
}
