/**
 * C52.7: the one-time code problems, as their golden problems in
 * `contracts/fixtures/problems/flow/` word them. None carries a destination or a code.
 */
import { toTimestamp } from '@openverify/contracts';
import { Phase5ProblemError } from '../../errors.js';

export const alreadyConfirmed = () =>
  new Phase5ProblemError(
    'otp_already_confirmed',
    'The code was already confirmed; submit the verification.',
  );

export const attemptsExhausted = () =>
  new Phase5ProblemError(
    'otp_attempts_exhausted',
    'Too many wrong codes were entered; the verification was submitted.',
  );

export const channelNotConfigured = () =>
  new Phase5ProblemError(
    'otp_channel_not_configured',
    'No sender is configured for this one-time code channel in this environment.',
  );

export const codeExhausted = () =>
  new Phase5ProblemError(
    'otp_code_exhausted',
    'Too many wrong entries for this code; ask for a new one.',
  );

export const deliveryFailed = () =>
  new Phase5ProblemError(
    'otp_delivery_failed',
    'The code could not be sent. Check the destination or try again.',
  );

export const destinationRefused = (
  code: 'otp_destination_invalid' | 'otp_destination_not_allowed',
) =>
  code === 'otp_destination_invalid'
    ? new Phase5ProblemError(code, 'The phone number or email address cannot receive a code.')
    : new Phase5ProblemError(code, 'Codes cannot be sent to this destination in this verification.');

export const expired = () =>
  new Phase5ProblemError('otp_expired', 'The code has expired; ask for a new one.');

export const incorrect = (attemptsRemaining: number) =>
  new Phase5ProblemError('otp_incorrect', 'The code is not correct.', {
    members: { 'attempts-remaining': attemptsRemaining },
  });

export const notConfirmed = () =>
  new Phase5ProblemError(
    'otp_not_confirmed',
    'No code was confirmed and no send is left; the verification was submitted.',
  );

export const notSent = () => new Phase5ProblemError('otp_not_sent', 'No code was sent to confirm.');

export const resendTooSoon = (availableAt: Date, now: Date) =>
  new Phase5ProblemError('otp_resend_too_soon', 'A new code can be sent once the wait is over.', {
    members: { 'resend-available-at': toTimestamp(availableAt) },
    headers: {
      'retry-after': String(Math.max(1, Math.ceil((availableAt.getTime() - now.getTime()) / 1000))),
    },
  });
