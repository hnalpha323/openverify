/**
 * C52.8, C56: what a phone or email verification's stored codes prove, read once for its attribute
 * hook and its job: its destination (the confirmed code's, else the newest one's; `null` once
 * redacted), when it was confirmed, its counts, and the sender that delivered its codes.
 */
import type { OtpCheckState } from '@openverify/checks';
import { OTP_MAX_WRONG_ENTRIES } from '@openverify/contracts';
import type { CheckProvider } from '@openverify/core';
import {
  getOtpVerificationState,
  listOtpChallenges,
  openOtpChallengeDestination,
  type Db,
  type OtpChallenge,
  type OtpVerificationState,
} from '@openverify/db';
import { deliveredChallenge } from './state.js';

export interface OtpEvidence {
  /** E.164 or the address; PII. `null` before any code or once redacted. */
  destination: string | null;
  /** The confirmed code, if the user entered one. */
  confirmed: OtpChallenge | null;
  /** Newest first. */
  challenges: OtpChallenge[];
  state: OtpVerificationState | null;
  /** The sender of the confirmed code, else of the newest delivered one. */
  sender: CheckProvider | null;
}

/** The evidence of the verification `verificationId`, read with `db`. */
export async function loadOtpEvidence(
  db: Db,
  environmentId: string,
  verificationId: string,
): Promise<OtpEvidence> {
  const challenges = await listOtpChallenges(db, environmentId, verificationId);
  const confirmed = challenges.find((challenge) => challenge.status === 'confirmed') ?? null;
  const shown = confirmed ?? challenges[0] ?? null;
  const delivering = confirmed ?? deliveredChallenge(challenges);
  return {
    destination:
      shown === null ? null : await openOtpChallengeDestination(db, environmentId, shown.id),
    confirmed,
    challenges,
    state: await getOtpVerificationState(db, environmentId, verificationId),
    sender:
      delivering?.provider == null
        ? null
        : { id: delivering.provider, sandbox: delivering.provider === 'sandbox' },
  };
}

/**
 * C56: the OTP comparison's input: whether a code was confirmed, the counts and the limit that
 * refused the user; `null` when the verification has neither a code nor a count.
 */
export function otpCheckStateOf(evidence: OtpEvidence): OtpCheckState | null {
  const { state } = evidence;
  if (state === null && evidence.challenges.length === 0) {
    return null;
  }
  return {
    confirmed: evidence.confirmed !== null,
    sends: state?.sends ?? 0,
    wrongEntries: state?.wrongEntries ?? 0,
    maxWrongEntries: OTP_MAX_WRONG_ENTRIES,
    limitedReason: state?.limitedReason ?? null,
  };
}
