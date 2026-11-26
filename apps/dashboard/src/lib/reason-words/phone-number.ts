/**
 * C54.5, C66: the reason codes of the `verification/phone-number` check in words (C51.2), for
 * operators. `phone_number_otp_comparison` gives the one-time code reasons, which the email type
 * shares (`lib/otp-words.ts`); `input_missing` keeps the shared words.
 */
import { OTP_REASON_WORDS } from '../otp-words';
import type { ReasonWords } from './types';

export const PHONE_NUMBER_REASON_WORDS: ReasonWords = Object.freeze({ ...OTP_REASON_WORDS });
