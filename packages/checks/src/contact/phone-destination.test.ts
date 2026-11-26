/**
 * C55.8: the phone destination rule. Every number here is synthetic: the US 555-01xx range, the
 * Ofcom drama ranges (020 7946 0xxx, 0808 157 0xxx, 0909 879 0xxx, 03069 99xxxx) and patterned
 * numbers in other plans, classified by the pinned `libphonenumber-js` 1.13.14 `/max` metadata.
 */
import { describe, expect, it } from 'vitest';
import { cpuMilliseconds } from '../document/testing.js';
import {
  E164_MAX_DIGITS,
  PHONE_DESTINATION_MAX_LENGTH,
  REFUSED_PHONE_NUMBER_TYPES,
  maskPhoneDestination,
  validatePhoneDestination,
} from './phone-destination.js';

const US = { allowedCountries: ['US'] };
const EVERYWHERE = { allowedCountries: ['US', 'CA', 'GB', 'FR', 'DE', 'IT'] };

describe('validatePhoneDestination (C55.8)', () => {
  it('accepts a valid number of an allowed region in E.164, whatever its spacing', () => {
    for (const value of [
      '+12025550100',
      '+1 202 555 0100',
      '+1 (202) 555-0100',
      '+1.202.555.0100',
    ]) {
      expect(validatePhoneDestination(value, US)).toEqual({
        ok: true,
        e164: '+12025550100',
        country: 'US',
        type: 'FIXED_LINE_OR_MOBILE',
      });
    }
  });

  it('ignores surrounding whitespace', () => {
    expect(validatePhoneDestination('  +1 202 555 0100\t', US)).toMatchObject({
      ok: true,
      e164: '+12025550100',
    });
  });

  it.each([
    ['+33 6 12 34 56 78', 'FR', 'MOBILE'],
    ['+49 177 1234567', 'DE', 'MOBILE'],
    ['+44 20 7946 0000', 'GB', 'FIXED_LINE'],
    ['+44 70 1234 5678', 'GB', 'PERSONAL_NUMBER'],
    ['+1 613 555 0123', 'CA', 'FIXED_LINE_OR_MOBILE'],
  ])(
    'accepts %s (%s, %s): libphonenumber cannot tell NANP mobiles from landlines',
    (value, country, type) => {
      expect(validatePhoneDestination(value, EVERYWHERE)).toMatchObject({
        ok: true,
        country,
        type,
      });
    },
  );

  it.each([
    ['202 555 0100', 'no + and country code'],
    ['0044 20 7946 0000', 'an international prefix instead of +'],
    ['+1 202 555 0100 ext. 22', 'an extension'],
    ['+1 202 555 0100;ext=22', 'an RFC 3966 extension'],
    ['+1 800 FLOWERS', 'vanity letters'],
    ['tel:+12025550100', 'a URI scheme'],
    ['+1 202 555 0100 +1 202 555 0101', 'two numbers'],
    ['call +1 202 555 0100', 'text around the number'],
    ['+', 'no digits'],
    ['++12025550100', 'two plus signs'],
    ['+1 202\n555 0100', 'a line break inside'],
  ])('refuses %j (%s) as otp_destination_invalid', (value) => {
    expect(validatePhoneDestination(value, US)).toEqual({
      ok: false,
      problem: 'otp_destination_invalid',
      refusal: 'unparseable',
    });
  });

  it('refuses more than 15 digits and more than the body cap before parsing', () => {
    expect(E164_MAX_DIGITS).toBe(15);
    expect(PHONE_DESTINATION_MAX_LENGTH).toBe(32);
    expect(validatePhoneDestination('+1202555010012345', US)).toMatchObject({
      ok: false,
      refusal: 'unparseable',
    });
    expect(validatePhoneDestination(`+1 202 555 0100${' '.repeat(40)}`, US)).toMatchObject({
      ok: true,
    });
    expect(validatePhoneDestination(`+1 ${'-'.repeat(40)}2025550100`, US)).toMatchObject({
      ok: false,
      refusal: 'unparseable',
    });
  });

  it('refuses a number outside the numbering plan as otp_destination_invalid', () => {
    expect(validatePhoneDestination('+44 7700 900123', EVERYWHERE)).toEqual({
      ok: false,
      problem: 'otp_destination_invalid',
      refusal: 'invalid_number',
    });
    expect(validatePhoneDestination('+1 2345', US)).toMatchObject({
      problem: 'otp_destination_invalid',
    });
  });

  it('refuses a valid number of a region the step does not allow', () => {
    expect(validatePhoneDestination('+33 6 12 34 56 78', US)).toEqual({
      ok: false,
      problem: 'otp_destination_not_allowed',
      refusal: 'country_not_allowed',
    });
  });

  it('refuses a non-geographic number, which no allowed country holds', () => {
    expect(validatePhoneDestination('+800 1234 5678', EVERYWHERE)).toEqual({
      ok: false,
      problem: 'otp_destination_not_allowed',
      refusal: 'no_region',
    });
  });

  it.each([
    ['+44 909 879 0000', 'PREMIUM_RATE'],
    ['+1 900 555 0100', 'PREMIUM_RATE'],
    ['+44 808 157 0000', 'TOLL_FREE'],
    ['+1 800 555 0100', 'TOLL_FREE'],
    ['+33 8 10 12 34 56', 'SHARED_COST'],
    ['+44 306 999 0000', 'UAN'],
    ['+44 7654 123456', 'PAGER'],
    ['+39 33 1234 56789', 'VOICEMAIL'],
  ])('refuses %s, a %s number (toll fraud or undeliverable)', (value, type) => {
    expect(REFUSED_PHONE_NUMBER_TYPES).toContain(type);
    expect(validatePhoneDestination(value, EVERYWHERE)).toEqual({
      ok: false,
      problem: 'otp_destination_not_allowed',
      refusal: 'type_not_allowed',
    });
  });

  it('refuses a VoIP number unless the step allows it', () => {
    expect(validatePhoneDestination('+33 9 12 34 56 78', EVERYWHERE)).toEqual({
      ok: false,
      problem: 'otp_destination_not_allowed',
      refusal: 'voip_not_allowed',
    });
    expect(
      validatePhoneDestination('+33 9 12 34 56 78', { ...EVERYWHERE, allowVoip: true }),
    ).toEqual({ ok: true, e164: '+33912345678', country: 'FR', type: 'VOIP' });
  });

  it('reads the region from the digits, never from the allowed list', () => {
    // +44 7911 is Guernsey's mobile range: GB alone does not allow it.
    expect(validatePhoneDestination('+44 7911 123456', { allowedCountries: ['GB'] })).toEqual({
      ok: false,
      problem: 'otp_destination_not_allowed',
      refusal: 'country_not_allowed',
    });
    expect(validatePhoneDestination('+44 7911 123456', { allowedCountries: ['GG'] })).toMatchObject(
      { ok: true, country: 'GG' },
    );
  });

  it('stays fast on a long hostile value', () => {
    expect(
      cpuMilliseconds(() => {
        for (let index = 0; index < 1_000; index += 1) {
          validatePhoneDestination(`+${'1 ('.repeat(10_000)}`, US);
        }
      }),
    ).toBeLessThan(2_000);
  });
});

describe('maskPhoneDestination (C52.2)', () => {
  it('shows the calling code and the last four digits only', () => {
    expect(maskPhoneDestination('+12025550100')).toBe('+1 ••• ••• 0100');
    expect(maskPhoneDestination('+33612345678')).toBe('+33 • •• •• 56 78');
    expect(maskPhoneDestination('+491771234567')).toBe('+49 ••• •••4567');
  });

  it('never shows more than four digits of the national number, within 64 characters', () => {
    for (const e164 of ['+12025550100', '+447012345678', '+3933123456789', '+80012345678']) {
      const masked = maskPhoneDestination(e164);
      const callingCodeDigits = masked.split(' ')[0]?.length ?? 0;
      const digits = masked.replace(/\D/g, '');
      expect(digits.length - (callingCodeDigits - 1)).toBe(4);
      expect(masked.endsWith(e164.slice(-1))).toBe(true);
      expect(masked.length).toBeLessThanOrEqual(64);
    }
  });

  it('masks a value it cannot parse down to its last four digits', () => {
    expect(maskPhoneDestination('+999123456')).toBe('+•••••3456');
  });
});
