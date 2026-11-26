/**
 * C51.2, C66: every reason the email address checks can give, in words. The reasons are read from
 * the contracts (`checkReasonsOfType`), so one added there without words here fails this test.
 */
import { describe, expect, it } from 'vitest';
import { checkReasonsOfType } from '../../testing/phase5-reasons';
import { reasonText } from '../check-reasons';
import { EMAIL_ADDRESS_REASON_WORDS } from './email-address';

const REASONS = checkReasonsOfType('verification/email-address');
/** Short words: a capital first, no code, at most 60 characters. */
const WORDS = /^[A-Z][^_]{1,59}$/;
/** A sentence of explanation: a capital first, no code, a full stop at the end. */
const SENTENCE = /^[A-Z][^_]{9,239}\.$/;
/** The codes only the email checks give, which no shared word list has. */
const OWN_CODES = [
  'otp_attempts_exhausted',
  'otp_not_confirmed',
  'otp_delivery_unavailable',
  'disposable_domain',
  'list_unavailable',
  'domain_not_found',
  'domain_rejects_mail',
  'no_mail_server',
];

describe('the email address reasons in words (C51.2, C66)', () => {
  it('reads every reason of the three email address checks from the contracts', () => {
    expect(new Set(REASONS.map(([check]) => check))).toEqual(
      new Set([
        'email_address_otp_comparison',
        'email_address_disposable_detection',
        'email_address_mx_detection',
      ]),
    );
    expect(REASONS.map(([, code]) => code)).toEqual(expect.arrayContaining(OWN_CODES));
  });

  it.each(REASONS)('says %s %s in short English words', (check, code) => {
    expect(reasonText(code, check)?.words, code).toMatch(WORDS);
  });

  it.each(OWN_CODES)('words %s itself, with a sentence saying what happened', (code) => {
    expect(EMAIL_ADDRESS_REASON_WORDS[code]?.words, code).toMatch(WORDS);
    expect(EMAIL_ADDRESS_REASON_WORDS[code]?.explanation, code).toMatch(SENTENCE);
  });

  it('says what a null MX record and a missing list mean (C56)', () => {
    expect(reasonText('domain_rejects_mail', 'email_address_mx_detection')?.explanation).toMatch(
      /null MX/,
    );
    expect(
      reasonText('list_unavailable', 'email_address_disposable_detection')?.explanation,
    ).toMatch(/review/);
  });

  it('says the same words for a code both OTP types give', () => {
    const phone = reasonText('otp_not_confirmed', 'phone_number_otp_comparison');

    expect(phone?.words).toMatch(WORDS);
    expect(reasonText('otp_not_confirmed', 'email_address_otp_comparison')).toEqual(phone);
  });
});
