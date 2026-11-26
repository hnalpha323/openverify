/**
 * C55.2, C55.3: codes of six to ten digits from the CSPRNG, zero-padded; only an HMAC of the code
 * bound to its verification, channel and destination is stored, under the code key, and compared
 * in constant time.
 */
import { createHmac } from 'node:crypto';
import { OTP_HMAC_PREFIX } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { newOtpCode, otpCodeHmac, otpCodeMatches, type OtpCodeBinding } from './codes.js';

const KEY = new Uint8Array(32).fill(7);
const BINDING: OtpCodeBinding = {
  verificationId: 'ver_01M5CK3190XEVBM5ZXA76E1JSM',
  channel: 'sms',
  destination: '+12025550100',
};

describe('newOtpCode (C55.2)', () => {
  it('draws from [0, 10^length) and zero-pads to the length', () => {
    const calls: [number, number][] = [];
    const code = newOtpCode(6, (min, max) => {
      calls.push([min, max]);
      return 42;
    });

    expect(code).toBe('000042');
    expect(calls).toEqual([[0, 1_000_000]]);
    expect(newOtpCode(10, () => 9_999_999_999)).toBe('9999999999');
  });

  it.each([6, 7, 8, 9, 10])('makes a code of %i digits from the CSPRNG', (length) => {
    expect(newOtpCode(length)).toMatch(new RegExp(`^[0-9]{${String(length)}}$`, 'u'));
  });

  it.each([5, 11, 6.5, Number.NaN])('refuses a length of %s', (length) => {
    expect(() => newOtpCode(length)).toThrow(RangeError);
  });
});

describe('the code HMAC (C55.3)', () => {
  it('is HMAC-SHA-256 under the code key over the prefix, verification, channel, destination and code', () => {
    const expected = createHmac('sha256', KEY)
      .update(`${OTP_HMAC_PREFIX}${BINDING.verificationId}|sms|+12025550100|123456`, 'utf8')
      .digest();

    const hmac = otpCodeHmac(KEY, BINDING, '123456');

    expect(hmac).toHaveLength(32);
    expect(Buffer.from(hmac).equals(expected)).toBe(true);
  });

  it('binds the code to its verification, channel and destination', () => {
    const stored = otpCodeHmac(KEY, BINDING, '123456');

    expect(otpCodeMatches(KEY, BINDING, '123456', stored)).toBe(true);
    expect(otpCodeMatches(KEY, BINDING, '123457', stored)).toBe(false);
    expect(
      otpCodeMatches(KEY, { ...BINDING, verificationId: 'ver_01M5CK3190XEVBM5ZXA76E1JSN' }, '123456', stored),
    ).toBe(false);
    expect(otpCodeMatches(KEY, { ...BINDING, channel: 'email' }, '123456', stored)).toBe(false);
    expect(
      otpCodeMatches(KEY, { ...BINDING, destination: '+12025550101' }, '123456', stored),
    ).toBe(false);
    expect(otpCodeMatches(new Uint8Array(32).fill(8), BINDING, '123456', stored)).toBe(false);
  });

  it('matches nothing without a stored HMAC of the right length', () => {
    expect(otpCodeMatches(KEY, BINDING, '123456', null)).toBe(false);
    expect(otpCodeMatches(KEY, BINDING, '123456', new Uint8Array(16))).toBe(false);
  });
});
