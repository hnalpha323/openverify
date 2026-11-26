/**
 * The phone and email one-time code vocabulary in words (C55, C56, C66), shared by the two OTP
 * types: the reasons both OTP comparisons give. Every number comes from the contracts.
 */
import { OTP_MAX_WRONG_ENTRIES } from '@openverify/contracts';
import type { ReasonWords } from './reason-words/types';
import type { WordsText } from './selfie-words';

/** The reasons of `phone_number_otp_comparison` and `email_address_otp_comparison` (C55.5, C55.6). */
export const OTP_REASON_WORDS: ReasonWords = Object.freeze({
  otp_attempts_exhausted: {
    words: 'Too many wrong codes',
    explanation: `The user entered ${String(OTP_MAX_WRONG_ENTRIES)} wrong codes across this verification's codes, which ended the attempt; they may start again.`,
  },
  otp_not_confirmed: {
    words: 'No code confirmed',
    explanation:
      'Codes were sent, but none was confirmed before the sends ran out or the last code expired; the user may start again.',
  },
  otp_delivery_unavailable: {
    words: 'A sending limit stopped the code',
    explanation:
      'A sending limit refused the user, or the limit store was down, so no code could be confirmed; this is no failure of the user, and a reviewer decides.',
  },
});

/** The channels the OTP comparisons record (`metadata.channel`), in words. */
const CHANNEL_WORDS: ReadonlyMap<string, string> = new Map([
  ['sms', 'Text message (SMS)'],
  ['email', 'Email'],
]);

/**
 * The limits that refuse a user (C55.6, `metadata['limited-reason']`), in words, each naming the
 * C55.7 limits it stands for (api-otp amendment 3). An `otp-ip-hour` refusal is not recorded, so
 * no reason names it.
 */
const LIMITED_REASON_WORDS: ReadonlyMap<string, WordsText> = new Map<string, WordsText>([
  [
    'destination',
    {
      words: 'A sending limit of the destination',
      explanation:
        'The hourly or daily sends to this destination, or the hourly sends to its number prefix, were used up (otp-destination-hour, otp-destination-day, otp-sms-prefix-hour).',
    },
  ],
  [
    'inquiry',
    {
      words: "The inquiry's daily sending limit",
      explanation: 'The sends one inquiry may make in a day were used up (otp-inquiry-day).',
    },
  ],
  [
    'guess',
    {
      words: "The destination's wrong-code budget",
      explanation:
        'Too many wrong codes were entered against this destination in a day, across inquiries (otp-destination-guess-day).',
    },
  ],
  [
    'environment',
    {
      words: "The environment's text message budget",
      explanation:
        "The environment's hourly text message budget, or a destination country's share of it, was used up (otp-sms-max-per-hour, otp-sms-country-hour).",
    },
  ],
  [
    'store_unavailable',
    {
      words: 'The limit store was unavailable',
      explanation: 'Valkey could not answer, so sends and confirmations failed closed.',
    },
  ],
]);

/** The delivery channel of an OTP comparison, in words; `undefined` for one it does not know. */
export function otpChannelText(channel: unknown): string | undefined {
  return typeof channel === 'string' ? CHANNEL_WORDS.get(channel) : undefined;
}

/** Which limit refused the user, in words; `undefined` for one it does not know. */
export function otpLimitedReasonText(reason: unknown): WordsText | undefined {
  return typeof reason === 'string' ? LIMITED_REASON_WORDS.get(reason) : undefined;
}

/**
 * ADR 0002 §3d, C55.10: the sandbox SMS sender, named beside the evidence. Only the SMS channel
 * has a sandbox sender; email goes through the API's mailer.
 */
export const OTP_SANDBOX_SENDER_TEXT =
  'The sandbox sender sends no text message: it keeps the code for tests to read, and is refused in production.';
