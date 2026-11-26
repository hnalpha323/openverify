// @vitest-environment node
import { OTP_LIMIT_NAMES } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { arrayOf, checksSource } from '../testing/checks-source';
import { OTP_SANDBOX_SENDER_TEXT, otpChannelText, otpLimitedReasonText } from './otp-words';

/** The limits that refuse a user, as the contact evaluators read them (C53.2, C55.6). */
const LIMITED_REASONS = arrayOf(checksSource('contact/inputs.ts'), 'OTP_LIMITED_REASONS');
const comparison = checksSource('contact/otp-comparison.ts');
/** Short words: a capital first, no code, at most 80 characters. */
const WORDS = /^[A-Z][^_]{1,79}$/;
/** A sentence of explanation: a capital first, no code, a full stop at the end. */
const SENTENCE = /^[A-Z][^_]{9,239}\.$/;

describe('the one-time code vocabulary in words (C55.6, C56, C66)', () => {
  it('reads the five limits that refuse a user from the evaluators', () => {
    expect(LIMITED_REASONS).toEqual([
      'destination',
      'inquiry',
      'guess',
      'environment',
      'store_unavailable',
    ]);
  });

  it.each(LIMITED_REASONS)('says the limit %s in words, and which limits it covers', (reason) => {
    const text = otpLimitedReasonText(reason);

    expect(text?.words, reason).toMatch(WORDS);
    expect(text?.explanation, reason).toMatch(SENTENCE);
  });

  it('names every limit whose refusal is recorded, and not otp-ip-hour, which none records (C55.7)', () => {
    const explanations = LIMITED_REASONS.map(
      (reason) => otpLimitedReasonText(reason)?.explanation ?? '',
    ).join(' ');

    for (const name of OTP_LIMIT_NAMES.filter((limit) => limit !== 'otp-ip-hour')) {
      expect(explanations, name).toContain(name);
    }
    expect(explanations).not.toContain('otp-ip-hour');
  });

  it('says both channels the OTP comparisons record', () => {
    expect(comparison).toContain("'sms'");
    expect(comparison).toContain("'email'");
    expect(otpChannelText('sms')).toBe('Text message (SMS)');
    expect(otpChannelText('email')).toBe('Email');
  });

  it.each(['constructor', 'toString', 'fax', 3, null, undefined])(
    'knows nothing of %s, a value it was not given words for',
    (value) => {
      expect(otpChannelText(value)).toBeUndefined();
      expect(otpLimitedReasonText(value)).toBeUndefined();
    },
  );

  it('says the sandbox sender sends nothing, and is refused in production (ADR 0002 §3d, C55.10)', () => {
    expect(OTP_SANDBOX_SENDER_TEXT).toMatch(SENTENCE);
    expect(OTP_SANDBOX_SENDER_TEXT).toMatch(/sends no text message/);
    expect(OTP_SANDBOX_SENDER_TEXT).toMatch(/refused in production/);
  });
});
