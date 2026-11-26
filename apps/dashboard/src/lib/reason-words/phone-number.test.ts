/**
 * C51.2, C66: every reason the phone number checks can give, in words. The reasons are read from
 * the contracts (`checkReasonsOfType`), so one added there without words here fails this test.
 */
import { OTP_MAX_WRONG_ENTRIES } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { checkReasonsOfType } from '../../testing/phase5-reasons';
import { reasonText } from '../check-reasons';
import { PHONE_NUMBER_REASON_WORDS } from './phone-number';

const REASONS = checkReasonsOfType('verification/phone-number');
/** Short words: a capital first, no code, at most 60 characters. */
const WORDS = /^[A-Z][^_]{1,59}$/;
/** A sentence of explanation: a capital first, no code, a full stop at the end. */
const SENTENCE = /^[A-Z][^_]{9,239}\.$/;
/** The codes only the OTP checks give, which no shared word list has. */
const OTP_CODES = ['otp_attempts_exhausted', 'otp_not_confirmed', 'otp_delivery_unavailable'];

describe('the phone number reasons in words (C51.2, C66)', () => {
  it('reads every reason of the phone number checks from the contracts', () => {
    expect(REASONS.map(([, code]) => code)).toEqual(
      expect.arrayContaining(['input_missing', ...OTP_CODES]),
    );
  });

  it.each(REASONS)('says %s %s in short English words', (check, code) => {
    expect(reasonText(code, check)?.words, code).toMatch(WORDS);
  });

  it.each(OTP_CODES)('words %s itself, with a sentence saying what happened', (code) => {
    expect(PHONE_NUMBER_REASON_WORDS[code]?.words, code).toMatch(WORDS);
    expect(PHONE_NUMBER_REASON_WORDS[code]?.explanation, code).toMatch(SENTENCE);
  });

  it('says ten wrong codes ended the attempt (C55.5)', () => {
    expect(
      reasonText('otp_attempts_exhausted', 'phone_number_otp_comparison')?.explanation,
    ).toContain(`${String(OTP_MAX_WRONG_ENTRIES)} wrong codes`);
  });

  it('says a limit refusal is no failure of the user, and goes to review (C55.6)', () => {
    expect(
      reasonText('otp_delivery_unavailable', 'phone_number_otp_comparison')?.explanation,
    ).toMatch(/limit.*review/);
  });
});
