/**
 * C52.2: the flow view of a phone or email verification: the step's countries (phone) and code
 * length, and `otp`, the code the user last received (masked destination, expiry, when the next
 * send is allowed, sends and attempts left), or `null` before one reached them. Never the code or
 * the destination itself.
 */
import { maskEmailDestination, maskPhoneDestination } from '@openverify/checks';
import { OTP_CODE_LENGTH } from '@openverify/contracts';
import {
  getOtpVerificationState,
  listOtpChallenges,
  openOtpChallengeDestination,
} from '@openverify/db';
import type { FlowGuidanceContext } from '../guidance/index.js';
import { deliveredChallenge, otpGuidanceState } from './state.js';

/** The flow attributes of a phone (`sms`) or email verification. */
export async function otpFlowAttributes(
  ctx: FlowGuidanceContext,
  channel: 'sms' | 'email',
): Promise<Readonly<Record<string, unknown>>> {
  const { step, verification, db, deps } = ctx;
  if (step?.type !== (channel === 'sms' ? 'phone_otp' : 'email_otp')) {
    return { guidance: null };
  }
  const { environmentId, id } = verification;
  const challenges = await listOtpChallenges(db, environmentId, id);
  const delivered = deliveredChallenge(challenges);
  const destination =
    delivered === null ? null : await openOtpChallengeDestination(db, environmentId, delivered.id);
  const otp = otpGuidanceState({
    challenges,
    state: await getOtpVerificationState(db, environmentId, id),
    maskedDestination:
      destination === null
        ? null
        : channel === 'sms'
          ? maskPhoneDestination(destination)
          : maskEmailDestination(destination),
    now: deps.clock.now(),
  });
  const codeLength = step.codeLength ?? OTP_CODE_LENGTH.default;
  return {
    guidance:
      step.type === 'phone_otp'
        ? { 'allowed-countries': step.allowedCountries, 'code-length': codeLength, otp }
        : { 'code-length': codeLength, otp },
  };
}
