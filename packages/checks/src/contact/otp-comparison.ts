/**
 * `phone_number_otp_comparison` and `email_address_otp_comparison` (R, user behaviour, C56): the
 * verification passes only when it holds a `confirmed` challenge for its own destination, that is
 * when the user entered the code sent there.
 *
 * Otherwise, in this order (C55.5, C55.6):
 * - ten wrong entries submitted it: `otp_attempts_exhausted` (failed, the user may start again);
 * - a limit refused the user, or the limit store was down: `otp_delivery_unavailable`
 *   (`not_applicable`, review: a gap on our side, never the user's failure);
 * - codes were sent but none was confirmed before the sends ran out: `otp_not_confirmed`
 *   (failed, so the client offers "start again");
 * - no destination, no OTP state, or no accepted send: `input_missing`.
 *
 * Metadata holds the channel, the counts and the limit's name, never the destination or a code;
 * provenance names the sender (`sandbox: true` for the sandbox sender).
 */
import type { CheckId, CheckProvider, CheckResult } from '@openverify/core';
import { checkResult } from '../result.js';
import type { EmailAddressContext, PhoneNumberContext } from './context.js';
import type { OtpCheckState } from './inputs.js';

export function phoneNumberOtpComparison(context: PhoneNumberContext): CheckResult {
  const { input } = context;
  return otpComparison(
    'phone_number_otp_comparison',
    'sms',
    input.phoneNumber,
    input.otp,
    input.sender,
  );
}

export function emailAddressOtpComparison(context: EmailAddressContext): CheckResult {
  const { input } = context;
  return otpComparison(
    'email_address_otp_comparison',
    'email',
    input.emailAddress,
    input.otp,
    input.sender,
  );
}

function otpComparison(
  checkId: CheckId,
  channel: 'sms' | 'email',
  destination: string | null,
  otp: OtpCheckState | null,
  sender: CheckProvider | null,
): CheckResult {
  const options = sender === null ? {} : { provider: sender };
  if (otp === null) {
    return checkResult(checkId, 'not_applicable', ['input_missing'], {}, options);
  }
  const metadata = {
    channel,
    sends: otp.sends,
    'failed-attempts': otp.wrongEntries,
    ...(otp.limitedReason === null ? {} : { 'limited-reason': otp.limitedReason }),
  };
  if (otp.confirmed && destination !== null) {
    return checkResult(checkId, 'passed', [], metadata, options);
  }
  if (otp.wrongEntries >= otp.maxWrongEntries) {
    return checkResult(checkId, 'failed', ['otp_attempts_exhausted'], metadata, options);
  }
  if (otp.limitedReason !== null) {
    // A limit or the limit store refused the user: no evidence either way, so review (C55.6).
    return checkResult(checkId, 'not_applicable', ['otp_delivery_unavailable'], metadata, options);
  }
  if (destination === null || otp.sends === 0) {
    return checkResult(checkId, 'not_applicable', ['input_missing'], metadata, options);
  }
  return checkResult(checkId, 'failed', ['otp_not_confirmed'], metadata, options);
}
