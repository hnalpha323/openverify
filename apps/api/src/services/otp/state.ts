/**
 * C52.2, C55.4-C55.6: what the stored challenges and counts say about a phone or email
 * verification's code: the code the user last received (`guidance.otp`), whether it can still be
 * entered, when the next send is allowed (cooldowns of 30, 60, 120 and 240 s after sends 1 to 4,
 * on the application clock) and whether the verification has run out of ways to get a code.
 */
import {
  OTP_MAX_ATTEMPTS_PER_CODE,
  OTP_MAX_SENDS,
  OTP_RESEND_COOLDOWNS_SECONDS,
  toTimestamp,
  type otpGuidanceStateSchema,
} from '@openverify/contracts';
import type { OtpChallenge, OtpChallengeStatus, OtpVerificationState } from '@openverify/db';
import type { z } from 'zod';

export type OtpGuidanceState = z.infer<typeof otpGuidanceStateSchema>;

/** The statuses of a code that reached the user. */
const DELIVERED: ReadonlySet<OtpChallengeStatus> = new Set([
  'sent',
  'confirmed',
  'expired',
  'exhausted',
]);

/**
 * The newest challenge whose code reached the user (`sent`, `confirmed`, `expired` or
 * `exhausted`), or `null`: an errored send delivered nothing, a superseded code was replaced.
 * `challenges` are newest first, as `listOtpChallenges` reads them.
 */
export function deliveredChallenge(challenges: readonly OtpChallenge[]): OtpChallenge | null {
  return challenges.find((challenge) => DELIVERED.has(challenge.status)) ?? null;
}

/** Whether `challenge` can still be entered at `now`: open, unexpired, attempts left. */
export function isUsableCode(challenge: OtpChallenge | null, now: Date): boolean {
  return (
    challenge?.status === 'sent' &&
    challenge.expiresAt.getTime() > now.getTime() &&
    challenge.failedAttempts < OTP_MAX_ATTEMPTS_PER_CODE
  );
}

/**
 * When the next send is allowed: the newest delivered send plus the cooldown after `sends`
 * accepted sends (at once before any); `null` once no send is left or a code was confirmed.
 */
export function resendAvailableAt(
  challenges: readonly OtpChallenge[],
  sends: number,
  now: Date,
): Date | null {
  const delivered = deliveredChallenge(challenges);
  if (sends >= OTP_MAX_SENDS || delivered?.status === 'confirmed') {
    return null;
  }
  const cooldown = sends < 1 ? undefined : OTP_RESEND_COOLDOWNS_SECONDS[sends - 1];
  return delivered === null || cooldown === undefined
    ? now
    : new Date(delivered.sentAt.getTime() + cooldown * 1000);
}

/**
 * C55.6 (no dead end): every send was used and no code can be entered any more, so the only way
 * on is to submit the verification (the check then fails `otp_not_confirmed`).
 */
export function outOfCodes(
  challenges: readonly OtpChallenge[],
  state: OtpVerificationState | null,
  now: Date,
): boolean {
  return (
    state !== null &&
    state.sends >= OTP_MAX_SENDS &&
    !isUsableCode(deliveredChallenge(challenges), now)
  );
}

/** C52.2: `guidance.otp`, or `null` before a code reached the user. */
export function otpGuidanceState(input: {
  challenges: readonly OtpChallenge[];
  state: OtpVerificationState | null;
  /** The delivered challenge's destination, masked; `null` when it is gone. */
  maskedDestination: string | null;
  now: Date;
}): OtpGuidanceState | null {
  const delivered = deliveredChallenge(input.challenges);
  if (delivered === null || input.maskedDestination === null) {
    return null;
  }
  const sends = Math.min(input.state?.sends ?? 0, OTP_MAX_SENDS);
  const resendAt = resendAvailableAt(input.challenges, sends, input.now);
  return {
    'masked-destination': input.maskedDestination,
    'expires-at': toTimestamp(delivered.expiresAt),
    'resend-available-at': resendAt === null ? null : toTimestamp(resendAt),
    'sends-remaining': OTP_MAX_SENDS - sends,
    'attempts-remaining': isUsableCode(delivered, input.now)
      ? OTP_MAX_ATTEMPTS_PER_CODE - delivered.failedAttempts
      : 0,
  };
}
