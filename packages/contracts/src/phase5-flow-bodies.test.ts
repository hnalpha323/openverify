/**
 * The Phase 5 flow API bodies (C52.2, C52.3, C52.5, C52.6), the OTP constants and limits (C55)
 * and the challenge bodies (C57.2, C57.3, C62.5). The route schemas that carry them are frozen in
 * Stage 1b (C54.2).
 */
import { describe, expect, it } from 'vitest';
import {
  ACTIVE_AUTHENTICATION_RESPONSE_MAX_BYTES,
  CHIP_CHALLENGE_LIMIT,
  CHIP_CHALLENGE_NONCE_HEX_LENGTH,
  CHIP_CHALLENGE_TTL_SECONDS,
  chipDeviceReportSchema,
  createChipChallengeBodySchema,
  flowChipChallengeResponseSchema,
  flowChipSubmitSchema,
} from './chip-challenges.js';
import {
  CRYPTO_CHALLENGE_LIMIT,
  CRYPTO_CHALLENGE_NONCE_LENGTH,
  CRYPTO_CHALLENGE_TTL_SECONDS,
  createCryptoChallengeBodySchema,
  flowCryptoChallengeResponseSchema,
  flowCryptoSubmitSchema,
} from './crypto-challenges.js';
import { createFlowVerificationBodySchema } from './flow-api.js';
import { ID_PREFIXES } from './ids.js';
import {
  OTP_CODE_LENGTH,
  OTP_CODE_TTL_SECONDS,
  OTP_HMAC_PREFIX,
  OTP_KEY_INFO,
  OTP_LIMITS,
  OTP_LIMIT_NAMES,
  OTP_MAX_ATTEMPTS_PER_CODE,
  OTP_MAX_SENDS,
  OTP_MAX_WRONG_ENTRIES,
  OTP_RESEND_COOLDOWNS_SECONDS,
  OTP_SMS_BUDGET_TRIPPED_AUDIT_ACTION,
  OTP_SMS_MAX_PER_HOUR,
  OTP_SMS_PREFIX_DIGITS,
  SANDBOX_SMS_SINK,
  flowOtpConfirmBodySchema,
  flowOtpSendBodySchema,
  otpCodeSchema,
  sandboxSmsSearchBodySchema,
  sandboxSmsSearchResponseSchema,
} from './otp.js';
import { flowSubmitVerificationBodySchema } from './selfie-captures.js';
import { AT_ISO } from './test-support.js';
import { API_VERIFICATION_TYPES } from './verification-types.js';
import {
  INPUTS_SCHEMA_BY_API_TYPE,
  INPUT_API_VERIFICATION_TYPES,
  MAX_ASSOCIATED_PERSONS,
  US_JURISDICTIONS,
  aamvaInputsSchema,
  businessWebsiteInputsSchema,
  databaseBusinessInputsSchema,
  databaseInputsSchema,
  flowInputsBodySchema,
  isAcceptableWebsiteUrl,
  isLei,
  registrationNumberAccepted,
  sanitizeInputValue,
} from './verification-inputs.js';

const accepts = (schema: { safeParse: (value: unknown) => { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;

/** Synthetic ULID bodies (C1). */
const ULID = '01M5CKS0D00R8HR9SJ7N456QK9';

describe('creating a verification of every type (C52.2)', () => {
  it.each(API_VERIFICATION_TYPES)('takes { type: %s }', (type) => {
    expect(accepts(createFlowVerificationBodySchema, { type })).toBe(true);
  });

  it('keeps the government ID options on the government ID only', () => {
    expect(
      accepts(createFlowVerificationBodySchema, { type: 'government-id', country: 'US' }),
    ).toBe(true);
    expect(accepts(createFlowVerificationBodySchema, { type: 'document', country: 'US' })).toBe(
      false,
    );
    expect(accepts(createFlowVerificationBodySchema, { type: 'business' })).toBe(false);
  });
});

describe('the Phase 5 ID prefixes', () => {
  it('name the OTP, crypto and chip challenges', () => {
    expect(ID_PREFIXES).toMatchObject({
      otpChallenge: 'otpc',
      cryptoChallenge: 'cwc',
      chipChallenge: 'chc',
    });
  });
});

describe('entered values (C52.3)', () => {
  const database = {
    'name-first': 'Avery',
    'name-middle': 'Q',
    'name-last': 'Example',
    birthdate: '1990-04-12',
    'address-street-1': '1 Sample Street',
    'address-street-2': 'Unit 2',
    'address-city': 'Utopia City',
    'address-subdivision': 'UT',
    'address-postal-code': '00000',
    'address-country-code': 'US',
    'identification-number': 'X1234567',
    'phone-number': '+15555550100',
    'email-address': 'avery@example.test',
  };

  it('name the four form types, each with its body', () => {
    expect(INPUT_API_VERIFICATION_TYPES).toEqual([
      'database',
      'aamva',
      'database-business',
      'business-website',
    ]);
    expect(Object.keys(INPUTS_SCHEMA_BY_API_TYPE)).toEqual(INPUT_API_VERIFICATION_TYPES);
  });

  it('take a database body of collected fields, each bounded, and nothing else', () => {
    expect(accepts(databaseInputsSchema, database)).toBe(true);
    expect(accepts(databaseInputsSchema, { 'name-first': 'Avery' })).toBe(true);
    for (const [label, change] of [
      ['an unknown member', { ssn: '1' }],
      ['an empty name', { 'name-first': '' }],
      ['a name of 201 characters', { 'name-last': 'x'.repeat(201) }],
      ['a partial birthdate', { birthdate: '1990-04' }],
      ['an impossible birthdate', { birthdate: '1990-13-01' }],
      ['a national phone number', { 'phone-number': '5555550100' }],
      ['an E.164 number with a leading zero', { 'phone-number': '+05555550100' }],
      ['an email without a domain', { 'email-address': 'avery@' }],
      ['an identification number of 65 characters', { 'identification-number': 'x'.repeat(65) }],
      ['an alpha-3 country', { 'address-country-code': 'USA' }],
      ['a street of 201 characters', { 'address-street-1': 'x'.repeat(201) }],
    ] as const) {
      expect(accepts(databaseInputsSchema, { ...database, ...change }), label).toBe(false);
    }
  });

  it('take an AAMVA body with a US state or territory as the issuing authority', () => {
    const aamva = {
      'name-first': 'Avery',
      'name-last': 'Example',
      birthdate: '1990-04-12',
      'identification-number': 'D1234567',
      'issuing-authority': 'CA',
      'issue-date': '2022-01-01',
      'expiration-date': '2030-01-01',
      'address-postal-code': '90001',
    };
    expect(accepts(aamvaInputsSchema, aamva)).toBe(true);
    expect(US_JURISDICTIONS).toHaveLength(56);
    for (const code of ['DC', 'PR', 'GU', 'VI', 'AS', 'MP', 'TX']) {
      expect(US_JURISDICTIONS, code).toContain(code);
    }
    for (const [label, change] of [
      ['a non-US authority', { 'issuing-authority': 'ON' }],
      ['a lower-case authority', { 'issuing-authority': 'ca' }],
      ['no licence number', { 'identification-number': undefined }],
      ['no birthdate', { birthdate: undefined }],
      ['a malformed issue date', { 'issue-date': '01/01/2022' }],
      ['an unknown member', { 'address-street-1': '1 Sample Street' }],
    ] as const) {
      expect(accepts(aamvaInputsSchema, { ...aamva, ...change }), label).toBe(false);
    }
  });

  it('take a business body with a registration number in its registry format and a valid LEI', () => {
    const business = {
      'business-name': 'Utopia Widgets Ltd',
      'country-code': 'GB',
      'registration-number': '01234567',
      lei: '5493000OVERIFY0TES72',
      'address-street-1': '1 Sample Street',
      'address-city': 'Utopia City',
      'address-postal-code': 'UT1 1AA',
      'associated-persons': [
        { 'name-first': 'Avery', 'name-last': 'Example', birthdate: '1990-04' },
        { 'name-first': 'Blake', 'name-last': 'Sample', birthdate: '1985-11-02' },
        { 'name-first': 'Casey', 'name-last': 'Sample' },
      ],
    };
    expect(accepts(databaseBusinessInputsSchema, business)).toBe(true);
    expect(MAX_ASSOCIATED_PERSONS).toBe(10);
    for (const [label, change] of [
      ['an empty name', { 'business-name': '' }],
      ['a name of 301 characters', { 'business-name': 'x'.repeat(301) }],
      ['a GB number outside the Companies House format', { 'registration-number': '1234567' }],
      ['a US number that is not a CIK', { 'country-code': 'US', 'registration-number': 'ABC' }],
      ['an LEI with a wrong check digit', { lei: '5493000OVERIFY0TES73' }],
      ['a lower-case LEI', { lei: '5493000overify0tes72' }],
      [
        'eleven associated persons',
        {
          'associated-persons': Array.from({ length: 11 }, () => ({
            'name-first': 'A',
            'name-last': 'B',
          })),
        },
      ],
      [
        'a person born on an impossible day',
        {
          'associated-persons': [{ 'name-first': 'A', 'name-last': 'B', birthdate: '1990-02-30' }],
        },
      ],
      [
        'a person with a year-only birthdate',
        { 'associated-persons': [{ 'name-first': 'A', 'name-last': 'B', birthdate: '1990' }] },
      ],
    ] as const) {
      expect(accepts(databaseBusinessInputsSchema, { ...business, ...change }), label).toBe(false);
    }
    expect(
      accepts(databaseBusinessInputsSchema, {
        ...business,
        'country-code': 'US',
        'registration-number': '0000320193',
      }),
    ).toBe(true);
    expect(
      accepts(databaseBusinessInputsSchema, {
        ...business,
        'country-code': 'DE',
        'registration-number': 'HRB12345',
      }),
    ).toBe(true);
  });

  it('read registration numbers per registry and LEIs by ISO 17442', () => {
    expect(registrationNumberAccepted('GB', '01234567')).toBe(true);
    expect(registrationNumberAccepted('GB', 'SC123456')).toBe(true);
    expect(registrationNumberAccepted('GB', 'SC12345')).toBe(false);
    expect(registrationNumberAccepted('US', '320193')).toBe(true);
    expect(registrationNumberAccepted('US', '12345678901')).toBe(false);
    expect(registrationNumberAccepted('FR', 'A'.repeat(20))).toBe(true);
    expect(registrationNumberAccepted('FR', 'A'.repeat(21))).toBe(false);
    expect(registrationNumberAccepted('FR', '123-456')).toBe(false);
    expect(isLei('529900SYNTHETIC00045')).toBe(true);
    expect(isLei('529900SYNTHETIC00046')).toBe(false);
    expect(isLei('529900SYNTHETIC0004')).toBe(false);
  });

  it('take a business website by an http or https URL of a named host on the default ports', () => {
    expect(
      accepts(businessWebsiteInputsSchema, {
        'website-url': 'https://shop.example/about',
        'business-name': 'Utopia Widgets Ltd',
      }),
    ).toBe(true);
    for (const url of ['https://old.example', 'http://new.example:80/', 'https://a.example:443']) {
      expect(isAcceptableWebsiteUrl(url), url).toBe(true);
    }
    for (const url of [
      'ftp://old.example',
      'https://localhost',
      'https://192.0.2.1',
      'https://[2001:db8::1]',
      'https://user:secret@old.example',
      'https://old.example:8443',
      `https://old.example/${'a'.repeat(2048)}`,
      'not a url',
      'javascript:alert(1)',
    ]) {
      expect(isAcceptableWebsiteUrl(url), url).toBe(false);
      expect(accepts(businessWebsiteInputsSchema, { 'website-url': url }), url).toBe(false);
    }
  });

  it('take any of the four bodies on the inputs route', () => {
    expect(accepts(flowInputsBodySchema, database)).toBe(true);
    expect(accepts(flowInputsBodySchema, { 'website-url': 'https://old.example' })).toBe(true);
    expect(accepts(flowInputsBodySchema, { unknown: 'x' })).toBe(false);
  });

  it('strip C0 controls and bidirectional overrides from an entered value', () => {
    expect(sanitizeInputValue('Ave\u0000ry\u202e Example\u2066')).toBe('Avery Example');
    expect(sanitizeInputValue('  Utopia\tCity ')).toBe('  UtopiaCity ');
  });
});

describe('OTP constants and limits (C55)', () => {
  it('make codes of six to ten digits, valid ten minutes, five tries each, ten wrong entries in all', () => {
    expect(OTP_CODE_LENGTH).toEqual({ min: 6, max: 10, default: 6 });
    expect(OTP_CODE_TTL_SECONDS).toBe(600);
    expect(OTP_MAX_ATTEMPTS_PER_CODE).toBe(5);
    expect(OTP_MAX_WRONG_ENTRIES).toBe(10);
  });

  it('allow five sends with growing cooldowns after the first four', () => {
    expect(OTP_MAX_SENDS).toBe(5);
    expect(OTP_RESEND_COOLDOWNS_SECONDS).toEqual([30, 60, 120, 240]);
  });

  it('name their own limits outside the C12 policies (a C12 amendment)', () => {
    expect(OTP_LIMIT_NAMES).toEqual([
      'otp-destination-hour',
      'otp-destination-day',
      'otp-ip-hour',
      'otp-inquiry-day',
      'otp-sms-prefix-hour',
      'otp-sms-country-hour',
      'otp-sms-max-per-hour',
      'otp-destination-guess-day',
    ]);
    expect(OTP_LIMITS).toEqual({
      'otp-destination-hour': { limit: 5, windowSeconds: 3600 },
      'otp-destination-day': { limit: 10, windowSeconds: 86_400 },
      'otp-ip-hour': { limit: 10, windowSeconds: 3600 },
      'otp-inquiry-day': { limit: 10, windowSeconds: 86_400 },
      'otp-sms-prefix-hour': { limit: 20, windowSeconds: 3600 },
      'otp-sms-country-hour': { budgetShare: 0.5, windowSeconds: 3600 },
      // The environment's whole budget an hour, under its own name (Stage 4 amendment).
      'otp-sms-max-per-hour': { budgetShare: 1, windowSeconds: 3600 },
      'otp-destination-guess-day': { limit: 20, windowSeconds: 86_400 },
    });
    expect(OTP_SMS_PREFIX_DIGITS).toBe(8);
  });

  it('bound the environment SMS budget by an install ceiling (V08)', () => {
    expect(OTP_SMS_MAX_PER_HOUR).toEqual({
      min: 1,
      default: 200,
      ceilingDefault: 1000,
      max: 1_000_000,
    });
    expect(OTP_SMS_BUDGET_TRIPPED_AUDIT_ACTION).toBe('environment.otp-sms-budget-tripped');
  });

  it('derive the code key and HMAC under their own labels (C55.3)', () => {
    expect(OTP_KEY_INFO).toBe('openverify/otp/v1');
    expect(OTP_HMAC_PREFIX).toBe('otp/v1|');
  });

  it('keep the sandbox sink small and short-lived (C55.10)', () => {
    expect(SANDBOX_SMS_SINK).toEqual({ maxEntries: 100, ttlSeconds: 900 });
  });
});

describe('OTP bodies (C55)', () => {
  it('send to a phone number or an email address, one of them', () => {
    expect(accepts(flowOtpSendBodySchema, { 'phone-number': '+15555550100' })).toBe(true);
    expect(accepts(flowOtpSendBodySchema, { 'email-address': 'avery@example.test' })).toBe(true);
    expect(
      accepts(flowOtpSendBodySchema, {
        'phone-number': '+15555550100',
        'email-address': 'avery@example.test',
      }),
    ).toBe(false);
    expect(accepts(flowOtpSendBodySchema, {})).toBe(false);
    expect(accepts(flowOtpSendBodySchema, { 'phone-number': 'x'.repeat(33) })).toBe(false);
    expect(accepts(flowOtpSendBodySchema, { 'email-address': 'x'.repeat(255) })).toBe(false);
  });

  it('confirm with six to ten digits, named code so stored API logs redact it', () => {
    expect(accepts(flowOtpConfirmBodySchema, { code: '123456' })).toBe(true);
    expect(accepts(flowOtpConfirmBodySchema, { code: '0123456789' })).toBe(true);
    for (const code of ['12345', '12345678901', '12345a', ' 123456', 123456]) {
      expect(accepts(otpCodeSchema, code), String(code)).toBe(false);
    }
  });

  it('search the sandbox sink by a number in the body, never the URL (C55.11)', () => {
    expect(accepts(sandboxSmsSearchBodySchema, { 'phone-number': '+15555550100' })).toBe(true);
    expect(accepts(sandboxSmsSearchBodySchema, {})).toBe(false);
    expect(
      accepts(sandboxSmsSearchResponseSchema, { data: [{ code: '123456', 'sent-at': AT_ISO }] }),
    ).toBe(true);
    expect(accepts(sandboxSmsSearchResponseSchema, { data: [{ code: '123456' }] })).toBe(false);
  });
});

describe('crypto wallet challenges (C57.2, C57.3)', () => {
  it('live ten minutes, the eleventh cancelling the verification, with a 16-character nonce', () => {
    expect(CRYPTO_CHALLENGE_TTL_SECONDS).toBe(600);
    expect(CRYPTO_CHALLENGE_LIMIT).toBe(10);
    expect(CRYPTO_CHALLENGE_NONCE_LENGTH).toBe(16);
  });

  it('are asked for a supported chain and a bounded address', () => {
    expect(
      accepts(createCryptoChallengeBodySchema, {
        'chain-id': 'eip155:1',
        'wallet-address': '0x52908400098527886E0F7030069857D2E4169EE7',
      }),
    ).toBe(true);
    for (const body of [
      { 'chain-id': 'cosmos:cosmoshub-4', 'wallet-address': 'cosmos1' },
      { 'chain-id': 'eip155:1', 'wallet-address': 'x'.repeat(129) },
      { 'chain-id': 'eip155:1', 'wallet-address': '' },
      { 'chain-id': 'eip155:1' },
    ]) {
      expect(accepts(createCryptoChallengeBodySchema, body), JSON.stringify(body)).toBe(false);
    }
  });

  it('answer the message to sign, once', () => {
    expect(
      accepts(flowCryptoChallengeResponseSchema, {
        id: `cwc_${ULID}`,
        message: 'example.test wants you to sign in ...',
        'expires-at': AT_ISO,
      }),
    ).toBe(true);
    expect(
      accepts(flowCryptoChallengeResponseSchema, {
        id: `cwc_${ULID}`,
        message: 'x'.repeat(4097),
        'expires-at': AT_ISO,
      }),
    ).toBe(false);
  });

  it('are submitted with a bounded signature and an optional signed message and scheme', () => {
    const crypto = { 'challenge-id': `cwc_${ULID}`, signature: '0x' + 'ab'.repeat(65) };
    expect(accepts(flowCryptoSubmitSchema, crypto)).toBe(true);
    expect(
      accepts(flowCryptoSubmitSchema, {
        ...crypto,
        'signed-message': 'msg',
        scheme: 'bip322-simple',
      }),
    ).toBe(true);
    expect(accepts(flowCryptoSubmitSchema, { ...crypto, signature: 'x'.repeat(1025) })).toBe(false);
    expect(accepts(flowCryptoSubmitSchema, { ...crypto, scheme: 'eip712' })).toBe(false);
    expect(accepts(flowCryptoSubmitSchema, { ...crypto, 'signed-message': 'é'.repeat(2049) })).toBe(
      false,
    );
  });
});

describe('chip challenges (C62.5)', () => {
  it('live five minutes, the eleventh cancelling the verification, with an 8-byte nonce', () => {
    expect(CHIP_CHALLENGE_TTL_SECONDS).toBe(300);
    expect(CHIP_CHALLENGE_LIMIT).toBe(10);
    expect(CHIP_CHALLENGE_NONCE_HEX_LENGTH).toBe(16);
    expect(ACTIVE_AUTHENTICATION_RESPONSE_MAX_BYTES).toBe(1024);
    expect(accepts(createChipChallengeBodySchema, {})).toBe(true);
    expect(accepts(createChipChallengeBodySchema, { nonce: '00' })).toBe(false);
  });

  it('answer the nonce in lower-case hex, once', () => {
    const response = { id: `chc_${ULID}`, nonce: '0123456789abcdef', 'expires-at': AT_ISO };
    expect(accepts(flowChipChallengeResponseSchema, response)).toBe(true);
    expect(
      accepts(flowChipChallengeResponseSchema, { ...response, nonce: '0123456789ABCDEF' }),
    ).toBe(false);
    expect(accepts(flowChipChallengeResponseSchema, { ...response, nonce: '0123' })).toBe(false);
  });

  it('are submitted with the nonce, a bounded Active Authentication response and a device report', () => {
    const chip = {
      'challenge-id': `chc_${ULID}`,
      nonce: '0123456789abcdef',
      'active-authentication-response': btoa(String.fromCharCode(...new Uint8Array(256))),
      'device-report': {
        protocols: [
          { protocol: 'pace', outcome: 'succeeded' },
          { protocol: 'active-authentication', outcome: 'succeeded' },
        ],
        'read-ms': 4200,
      },
    };
    expect(accepts(flowChipSubmitSchema, chip)).toBe(true);
    expect(
      accepts(flowChipSubmitSchema, {
        ...chip,
        'active-authentication-response': btoa(String.fromCharCode(...new Uint8Array(1025))),
      }),
    ).toBe(false);
    expect(
      accepts(flowChipSubmitSchema, { ...chip, 'active-authentication-response': '%%%' }),
    ).toBe(false);
    expect(
      accepts(chipDeviceReportSchema, { protocols: [{ protocol: 'magic', outcome: 'succeeded' }] }),
    ).toBe(false);
    expect(accepts(chipDeviceReportSchema, { 'read-ms': -1 })).toBe(false);
    expect(accepts(chipDeviceReportSchema, { model: 'Pixel' })).toBe(false);
  });
});

describe('submit bodies (C52.6)', () => {
  it('carry at most one of a selfie capture, a crypto signature or a chip read', () => {
    const crypto = { 'challenge-id': `cwc_${ULID}`, signature: '0xab' };
    const chip = { 'challenge-id': `chc_${ULID}`, nonce: '0123456789abcdef' };
    expect(accepts(flowSubmitVerificationBodySchema, {})).toBe(true);
    expect(accepts(flowSubmitVerificationBodySchema, { crypto })).toBe(true);
    expect(accepts(flowSubmitVerificationBodySchema, { chip })).toBe(true);
    expect(accepts(flowSubmitVerificationBodySchema, { crypto, chip })).toBe(false);
  });
});
