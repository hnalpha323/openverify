/** C56: the phone and email OTP comparisons (C55.5, C55.6). */
import { describe, expect, it } from 'vitest';
import { emailAddressContext, phoneNumberContext } from './context.js';
import { OTP_LIMITED_REASONS } from './inputs.js';
import { emailAddressOtpComparison, phoneNumberOtpComparison } from './otp-comparison.js';
import {
  EMAIL_CHECKS,
  PHONE_CHECKS,
  SANDBOX_SMS_SENDER,
  SMTP_SENDER,
  TEST_EMAIL_ADDRESS,
  TEST_PHONE_NUMBER,
  emailInput,
  otpState,
  phoneInput,
  templateOf,
} from './testing.js';

const phone = (overrides: Parameters<typeof phoneInput>[0] = {}) =>
  phoneNumberOtpComparison(phoneNumberContext(phoneInput(overrides), templateOf(PHONE_CHECKS)));
const email = (overrides: Parameters<typeof emailInput>[0] = {}) =>
  emailAddressOtpComparison(emailAddressContext(emailInput(overrides), templateOf(EMAIL_CHECKS)));

describe('phone_number_otp_comparison (C56)', () => {
  it('passes a verification holding a confirmed code, naming the sender', () => {
    expect(phone()).toEqual({
      name: 'phone_number_otp_comparison',
      status: 'passed',
      type: 'user_behavior',
      reasons: [],
      metadata: { channel: 'sms', sends: 1, 'failed-attempts': 0 },
      stage: 'ga',
      confidence: null,
      provenance: {
        'implementation-version': 1,
        provider: SANDBOX_SMS_SENDER,
        thresholds: {},
      },
    });
  });

  it('passes a confirmed code whatever came before it', () => {
    const result = phone({
      otp: otpState({ sends: 3, wrongEntries: 9, limitedReason: 'destination' }),
    });
    expect(result.status).toBe('passed');
    expect(result.metadata).toEqual({
      channel: 'sms',
      sends: 3,
      'failed-attempts': 9,
      'limited-reason': 'destination',
    });
  });

  it('fails otp_attempts_exhausted when ten wrong entries submitted it (C55.5)', () => {
    const result = phone({ otp: otpState({ confirmed: false, sends: 2, wrongEntries: 10 }) });
    expect(result).toMatchObject({
      status: 'failed',
      reasons: ['otp_attempts_exhausted'],
      metadata: { channel: 'sms', sends: 2, 'failed-attempts': 10 },
    });
  });

  it('keeps the user’s own exhaustion ahead of a limit refusal', () => {
    const result = phone({
      otp: otpState({ confirmed: false, wrongEntries: 12, limitedReason: 'guess' }),
    });
    expect(result.reasons).toEqual(['otp_attempts_exhausted']);
  });

  it.each(OTP_LIMITED_REASONS)(
    'answers otp_delivery_unavailable (review) when the %s limit refused the user (C55.6)',
    (limitedReason) => {
      const result = phone({
        otp: otpState({ confirmed: false, sends: 1, wrongEntries: 2, limitedReason }),
      });
      expect(result).toMatchObject({
        status: 'not_applicable',
        reasons: ['otp_delivery_unavailable'],
        metadata: {
          channel: 'sms',
          sends: 1,
          'failed-attempts': 2,
          'limited-reason': limitedReason,
        },
      });
    },
  );

  it('answers otp_delivery_unavailable also when a limit refused the very first send', () => {
    const result = phone({
      otp: otpState({ confirmed: false, sends: 0, limitedReason: 'store_unavailable' }),
    });
    expect(result.reasons).toEqual(['otp_delivery_unavailable']);
    // The refusal came before any challenge stored the destination.
    expect(
      phone({
        phoneNumber: null,
        otp: otpState({ confirmed: false, sends: 0, limitedReason: 'destination' }),
      }).reasons,
    ).toEqual(['otp_delivery_unavailable']);
  });

  it('fails otp_not_confirmed when codes were sent but none was confirmed (C55.6)', () => {
    const result = phone({ otp: otpState({ confirmed: false, sends: 5, wrongEntries: 3 }) });
    expect(result).toMatchObject({ status: 'failed', reasons: ['otp_not_confirmed'] });
  });

  it.each([
    ['no OTP state', { otp: null }],
    ['no accepted send', { otp: otpState({ confirmed: false, sends: 0 }) }],
    ['no destination', { phoneNumber: null }],
  ])('answers input_missing with %s, never a pass', (_why, overrides) => {
    expect(phone(overrides)).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
  });

  it('does not pass a confirmed state without a destination', () => {
    expect(phone({ phoneNumber: null }).status).toBe('not_applicable');
  });

  it('omits the provider when no sender delivered a code', () => {
    const result = phone({ sender: null, otp: null });
    expect(result.provenance).toEqual({ 'implementation-version': 1, thresholds: {} });
  });

  it('never copies the number into the result', () => {
    const serialized = JSON.stringify(phone());
    expect(serialized).not.toContain(TEST_PHONE_NUMBER.slice(1));
    expect(serialized).not.toContain('5550100');
  });
});

describe('email_address_otp_comparison (C56)', () => {
  it('passes a verification holding a confirmed code, naming the mailer', () => {
    expect(email()).toMatchObject({
      name: 'email_address_otp_comparison',
      status: 'passed',
      type: 'user_behavior',
      metadata: { channel: 'email', sends: 1, 'failed-attempts': 0 },
      provenance: { provider: SMTP_SENDER },
    });
  });

  it('follows the same order as the phone check', () => {
    expect(email({ otp: otpState({ confirmed: false, wrongEntries: 10 }) }).reasons).toEqual([
      'otp_attempts_exhausted',
    ]);
    expect(
      email({ otp: otpState({ confirmed: false, limitedReason: 'inquiry' }) }).reasons,
    ).toEqual(['otp_delivery_unavailable']);
    expect(email({ otp: otpState({ confirmed: false, sends: 2 }) }).reasons).toEqual([
      'otp_not_confirmed',
    ]);
    expect(email({ emailAddress: null }).reasons).toEqual(['input_missing']);
  });

  it('never copies the address into the result', () => {
    expect(JSON.stringify(email())).not.toContain(TEST_EMAIL_ADDRESS);
    expect(JSON.stringify(email())).not.toContain('lovelace');
  });
});
