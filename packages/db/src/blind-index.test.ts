/**
 * C31.8 blind index of identification numbers, under a per-environment subkey (Workflow 3B
 * review, G003). The expected digests were computed with an independent HMAC implementation
 * (OpenSSL 3.0.13), the subkey first, then the index under it:
 *   printf '%s' 'openverify/blind-index/v1|env_01K0000000000000000000SBXA' \
 *     | openssl dgst -sha256 -mac HMAC -macopt hexkey:0001...1f          # the subkey, hex
 *   printf '%s' 'UTO|passport|L898902C3' | openssl dgst -sha256 -mac HMAC -macopt hexkey:<subkey>
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BLIND_INDEX_KEY_ENV,
  BlindIndexKeyError,
  CHIP_DOCUMENT_NUMBER_INDEX_LABEL,
  CHIP_SOD_INDEX_LABEL,
  CRYPTO_ADDRESS_INDEX_LABEL,
  OTP_DESTINATION_INDEX_LABEL,
  REPORT_CRYPTO_ADDRESS_INDEX_LABEL,
  REPORT_MATCH_ENTRY_INDEX_LABEL,
  REPORT_MATCH_EVIDENCE_LABEL,
  blindIndexKeyFromEnv,
  chipDocumentNumberIndex,
  chipSodIndex,
  cryptoAddressIndex,
  extractionIndexOf,
  idClassGroup,
  identificationNumberIndex,
  normalizeIdentificationNumber,
  otpDestinationIndex,
  parseBlindIndexKey,
  reportCryptoAddressIndex,
  reportMatchEntryIndex,
  reportMatchEvidenceHash,
} from './blind-index.js';

/** Bytes 0x00..0x1f: a public test key, never a deployment's. */
const TEST_KEY = Uint8Array.from({ length: 32 }, (_, index) => index);
const TEST_KEY_B64 = Buffer.from(TEST_KEY).toString('base64');
/** Two synthetic environment ids. */
const SANDBOX = 'env_01K0000000000000000000SBXA';
const PRODUCTION = 'env_01K0000000000000000000PRDB';

describe('identificationNumberIndex (C31.8)', () => {
  it.each([
    [
      'the ICAO TD3 example of the test issuer',
      {
        environmentId: SANDBOX,
        issuingAuthorityCode: 'UTO',
        classGroup: 'passport',
        identificationNumber: 'L898902C3',
      },
      'eae9d19e5288c05f2a6b491eaa3c95942fb6432856054d4236e5b529920d21fa',
    ],
    [
      'an AAMVA number with separators and lower case',
      {
        environmentId: SANDBOX,
        issuingAuthorityCode: '636014',
        classGroup: 'drivers_license',
        identificationNumber: ' y987-6543 ',
      },
      'b55047979379964539e82980d3abf2e653c80d821f5da3c673f53e7ae221ad86',
    ],
    [
      'a one-letter ICAO issuer code',
      {
        environmentId: SANDBOX,
        issuingAuthorityCode: 'D',
        classGroup: 'national_id',
        identificationNumber: 'ZX1234567',
      },
      '9c685723b1af61a0f7ea1c68645d44da6991c39aa271d98676ab29361aaa68f2',
    ],
    [
      'a class that could not be established',
      {
        environmentId: SANDBOX,
        issuingAuthorityCode: 'UTO',
        classGroup: 'unknown',
        identificationNumber: 'D23145890',
      },
      '07df276dff17e41ae17c21919b9c7f1283772792eee593fc639a6e02334fa1f3',
    ],
    [
      'the same document in another environment',
      {
        environmentId: PRODUCTION,
        issuingAuthorityCode: 'UTO',
        classGroup: 'passport',
        identificationNumber: 'L898902C3',
      },
      'dc65f437b8b0a8d697955b736c76dc3a1bb71f396e46f6d118dc1472f6c0bf9e',
    ],
  ] as const)('matches the HMAC-SHA-256 vector for %s', (_label, input, expected) => {
    expect(identificationNumberIndex(TEST_KEY, input)).toBe(expected);
  });

  it('depends on the key', () => {
    const otherKey = new Uint8Array(32).fill(0xff);
    const input = {
      environmentId: SANDBOX,
      issuingAuthorityCode: 'UTO',
      classGroup: 'passport',
      identificationNumber: 'L898902C3',
    } as const;
    expect(identificationNumberIndex(otherKey, input)).toBe(
      'b564904254d0e7e71283ea428dc8e8a232758a95968cd4cb78cb6da2a632c8f5',
    );
  });

  it('separates environments: equal numbers give unrelated indexes (G003)', () => {
    const index = (environmentId: string) =>
      identificationNumberIndex(TEST_KEY, {
        environmentId,
        issuingAuthorityCode: 'UTO',
        classGroup: 'passport',
        identificationNumber: 'L898902C3',
      });
    expect(index(SANDBOX)).not.toBe(index(PRODUCTION));
    expect(index(SANDBOX)).toBe(index(SANDBOX));
  });

  it('gives the same index to the same number however it was printed or read', () => {
    const index = (identificationNumber: string) =>
      identificationNumberIndex(TEST_KEY, {
        environmentId: SANDBOX,
        issuingAuthorityCode: 'uto',
        classGroup: 'passport',
        identificationNumber,
      });
    expect(index('L898902C3')).toBe(index('l898 902-c3'));
    expect(index('L898902C3')).toBe(index('L898902C3<<<'));
    expect(index('L898902C3')).not.toBe(index('L898902C4'));
  });

  it('separates issuers and class groups', () => {
    const index = (issuingAuthorityCode: string, classGroup: 'passport' | 'national_id') =>
      identificationNumberIndex(TEST_KEY, {
        environmentId: SANDBOX,
        issuingAuthorityCode,
        classGroup,
        identificationNumber: 'L898902C3',
      });
    expect(index('UTO', 'passport')).not.toBe(index('UTO', 'national_id'));
    expect(index('UTO', 'passport')).not.toBe(index('D', 'passport'));
  });

  it('has nothing to index without a number', () => {
    expect(
      identificationNumberIndex(TEST_KEY, {
        environmentId: SANDBOX,
        issuingAuthorityCode: 'UTO',
        classGroup: 'passport',
        identificationNumber: ' -<< ',
      }),
    ).toBeNull();
  });

  it('refuses an index without an environment id (G003)', () => {
    expect(() =>
      identificationNumberIndex(TEST_KEY, {
        environmentId: ' ',
        issuingAuthorityCode: 'UTO',
        classGroup: 'passport',
        identificationNumber: 'L898902C3',
      }),
    ).toThrow(TypeError);
  });

  it('refuses a key that is not 32 bytes', () => {
    expect(() =>
      identificationNumberIndex(new Uint8Array(16), {
        environmentId: SANDBOX,
        issuingAuthorityCode: 'UTO',
        classGroup: 'passport',
        identificationNumber: 'L898902C3',
      }),
    ).toThrow(BlindIndexKeyError);
  });
});

describe('normalizeIdentificationNumber and idClassGroup', () => {
  it('upper-cases the number and keeps only A-Z and 0-9', () => {
    expect(normalizeIdentificationNumber(' d-231 4589.07<< ')).toBe('D231458907');
    expect(normalizeIdentificationNumber('ñ12')).toBe('12');
  });

  it('numbers each class separately, and an unestablished class as unknown', () => {
    expect(idClassGroup('passport')).toBe('passport');
    expect(idClassGroup('drivers_license')).toBe('drivers_license');
    expect(idClassGroup(null)).toBe('unknown');
  });
});

describe('the blind index key (OPENVERIFY_BLIND_INDEX_KEY)', () => {
  it('is base64 of 32 bytes', () => {
    expect(BLIND_INDEX_KEY_ENV).toBe('OPENVERIFY_BLIND_INDEX_KEY');
    expect(parseBlindIndexKey(TEST_KEY_B64)).toEqual(TEST_KEY);
    expect(blindIndexKeyFromEnv({ [BLIND_INDEX_KEY_ENV]: ` ${TEST_KEY_B64} ` })).toEqual(TEST_KEY);
  });

  it.each([
    ['missing', undefined, /is required/],
    ['blank', '  ', /is required/],
    [
      'the change-me placeholder',
      'change-me-base64-of-32-random-bytes',
      /base64 of 32 random bytes/,
    ],
    ['16 bytes', Buffer.alloc(16, 1).toString('base64'), /base64 of 32 random bytes/],
    ['not base64', '!'.repeat(44), /base64 of 32 random bytes/],
  ])('refuses a key that is %s, without echoing it', (_label, value, message) => {
    let thrown: unknown;
    try {
      parseBlindIndexKey(value);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(BlindIndexKeyError);
    expect((thrown as Error).message).toMatch(message);
    expect((thrown as Error).message).toMatch(/^OPENVERIFY_BLIND_INDEX_KEY /);
    if (value !== undefined && value.trim() !== '') {
      expect((thrown as Error).message).not.toContain(value.trim());
    }
  });
});

describe('extractionIndexOf (C31.8, the worker and blind-index:rebuild)', () => {
  const fields = (code: string | null, number: string | null) => ({
    'issuing-authority-code': code,
    'identification-number': number,
  });

  it('is the C31.8 index of the issuer code, the class group and the number, per environment', () => {
    expect(
      extractionIndexOf(TEST_KEY, {
        environmentId: SANDBOX,
        fields: fields('UTO', 'L898902C3'),
        classGroup: 'passport',
      }),
    ).toBe('eae9d19e5288c05f2a6b491eaa3c95942fb6432856054d4236e5b529920d21fa');
    expect(
      extractionIndexOf(TEST_KEY, {
        environmentId: SANDBOX,
        fields: fields('UTO', 'D23145890'),
        classGroup: 'unknown',
      }),
    ).toBe('07df276dff17e41ae17c21919b9c7f1283772792eee593fc639a6e02334fa1f3');
    expect(
      extractionIndexOf(TEST_KEY, {
        environmentId: PRODUCTION,
        fields: fields('UTO', 'L898902C3'),
        classGroup: 'passport',
      }),
    ).toBe('dc65f437b8b0a8d697955b736c76dc3a1bb71f396e46f6d118dc1472f6c0bf9e');
  });

  it('has none without an issuer code, so numbers of unknown issuers never match', () => {
    expect(
      extractionIndexOf(TEST_KEY, {
        environmentId: SANDBOX,
        fields: fields(null, 'L898902C3'),
        classGroup: 'passport',
      }),
    ).toBeNull();
    expect(
      extractionIndexOf(TEST_KEY, {
        environmentId: SANDBOX,
        fields: fields('  ', 'L898902C3'),
        classGroup: 'passport',
      }),
    ).toBeNull();
  });

  it('has none without a number, or with nothing left of it after normalization', () => {
    expect(
      extractionIndexOf(TEST_KEY, {
        environmentId: SANDBOX,
        fields: fields('UTO', null),
        classGroup: 'passport',
      }),
    ).toBeNull();
    expect(
      extractionIndexOf(TEST_KEY, {
        environmentId: SANDBOX,
        fields: fields('UTO', '<<- '),
        classGroup: 'passport',
      }),
    ).toBeNull();
  });

  it('refuses a key that is not 32 bytes', () => {
    expect(() =>
      extractionIndexOf(new Uint8Array(16), {
        environmentId: SANDBOX,
        fields: fields('UTO', 'L898902C3'),
        classGroup: 'passport',
      }),
    ).toThrow(BlindIndexKeyError);
  });
});

/**
 * C53.2: the Workflow 5A indexes, under the same per-environment subkey, each behind its own
 * label so no value indexes alike in two of them. Vectors computed with OpenSSL 3.0.13:
 *   printf '%s' 'openverify/otp-destination/v1|sms|+15550100009' \
 *     | openssl dgst -sha256 -mac HMAC -macopt hexkey:<the SANDBOX subkey above>
 */
describe('the OTP destination and crypto address indexes (C53.2)', () => {
  it('names their labels', () => {
    expect(OTP_DESTINATION_INDEX_LABEL).toBe('openverify/otp-destination/v1');
    expect(CRYPTO_ADDRESS_INDEX_LABEL).toBe('openverify/crypto-address/v1');
  });

  it('matches the HMAC-SHA-256 vectors', () => {
    expect(
      otpDestinationIndex(TEST_KEY, {
        environmentId: SANDBOX,
        channel: 'sms',
        destination: '+15550100009',
      }),
    ).toBe('7272367ddd1d7d121a2111d775918869e6c7ea2a1bbd1877e187648f5194d6aa');
    expect(
      otpDestinationIndex(TEST_KEY, {
        environmentId: PRODUCTION,
        channel: 'sms',
        destination: '+15550100009',
      }),
    ).toBe('d3d735b0bee55438f06b3e35fe58133c55dee7a2c27c518b435c8267c136069d');
    expect(
      otpDestinationIndex(TEST_KEY, {
        environmentId: SANDBOX,
        channel: 'email',
        destination: 'avery@example.test',
      }),
    ).toBe('f56778848a3040651d9e41cc34d61c84bca6a0a6e6c8841af2dadf39c8040f2c');
    expect(
      cryptoAddressIndex(TEST_KEY, {
        environmentId: SANDBOX,
        address: '0x00000000000000000000000000000000000000aa',
      }),
    ).toBe('87abf6578f433e7f4d675d61786299d19e7d6f2a597f5bf14fa8df5c595ab246');
  });

  it('indexes an email address lower-cased and trimmed, and a number as given', () => {
    const email = (destination: string) =>
      otpDestinationIndex(TEST_KEY, { environmentId: SANDBOX, channel: 'email', destination });
    expect(email(' Avery@Example.TEST ')).toBe(email('avery@example.test'));
    const sms = (destination: string) =>
      otpDestinationIndex(TEST_KEY, { environmentId: SANDBOX, channel: 'sms', destination });
    expect(sms(' +15550100009')).toBe(sms('+15550100009'));
    expect(sms('+15550100009')).not.toBe(sms('+15550100008'));
  });

  it('keeps channels, labels and environments apart', () => {
    const value = '+15550100009';
    expect(
      otpDestinationIndex(TEST_KEY, { environmentId: SANDBOX, channel: 'sms', destination: value }),
    ).not.toBe(
      otpDestinationIndex(TEST_KEY, {
        environmentId: SANDBOX,
        channel: 'email',
        destination: value,
      }),
    );
    expect(cryptoAddressIndex(TEST_KEY, { environmentId: SANDBOX, address: value })).not.toBe(
      otpDestinationIndex(TEST_KEY, { environmentId: SANDBOX, channel: 'sms', destination: value }),
    );
    expect(cryptoAddressIndex(TEST_KEY, { environmentId: SANDBOX, address: value })).not.toBe(
      cryptoAddressIndex(TEST_KEY, { environmentId: PRODUCTION, address: value }),
    );
  });

  it('refuses a key that is not 32 bytes, or no environment', () => {
    const short = new Uint8Array(16);
    expect(() =>
      otpDestinationIndex(short, { environmentId: SANDBOX, channel: 'sms', destination: '+1' }),
    ).toThrow(BlindIndexKeyError);
    expect(() => cryptoAddressIndex(short, { environmentId: SANDBOX, address: 'x' })).toThrow(
      BlindIndexKeyError,
    );
    expect(() => cryptoAddressIndex(TEST_KEY, { environmentId: ' ', address: 'x' })).toThrow(
      TypeError,
    );
  });
});

/**
 * C53.3, C62.6: the chip indexes under the environment subkey, each with its own label. Vectors
 * computed with OpenSSL 3.0.13 (the SANDBOX subkey is 24781f30…0507):
 *   printf '%s' "openverify/chip-sod/v1|$(hex of bytes 0x00..0x3f)" \
 *     | openssl dgst -sha256 -mac HMAC -macopt hexkey:<the SANDBOX subkey>
 *   printf '%s' 'openverify/chip-document-number/v1|UTO|X12K45P78' | openssl dgst … (same key)
 */
describe('the chip SOD and document number indexes (C53.3)', () => {
  const signature = Uint8Array.from({ length: 64 }, (_, index) => index);

  it('names their labels', () => {
    expect(CHIP_SOD_INDEX_LABEL).toBe('openverify/chip-sod/v1');
    expect(CHIP_DOCUMENT_NUMBER_INDEX_LABEL).toBe('openverify/chip-document-number/v1');
  });

  it('matches the HMAC-SHA-256 vectors', () => {
    expect(chipSodIndex(TEST_KEY, { environmentId: SANDBOX, signature })).toBe(
      '0281df20bdc39711ce5fe934438c8ff1cb35f14b7c7bb45c302e14be7df9378e',
    );
    expect(chipSodIndex(TEST_KEY, { environmentId: PRODUCTION, signature })).toBe(
      'cf9e639121faa93395a516078ac81668e61ac7b84ffc58617efb9af4a04dac48',
    );
    expect(
      chipDocumentNumberIndex(TEST_KEY, {
        environmentId: SANDBOX,
        issuingState: 'UTO',
        documentNumber: 'X12K45P78',
      }),
    ).toBe('7acd18e9887d07bb507adce49f6bd82d683e75fd7aad2447cbee50654f22a221');
  });

  it('indexes a document number without its fillers and spaces, upper-cased', () => {
    const index = (documentNumber: string, issuingState = 'UTO') =>
      chipDocumentNumberIndex(TEST_KEY, { environmentId: SANDBOX, issuingState, documentNumber });
    expect(index(' x12k45p78<< ')).toBe(index('X12K45P78'));
    expect(index('X12K45P78', 'D<<')).not.toBe(index('X12K45P78'));
  });

  it('refuses a key that is not 32 bytes, or no environment', () => {
    expect(() => chipSodIndex(new Uint8Array(16), { environmentId: SANDBOX, signature })).toThrow(
      BlindIndexKeyError,
    );
    expect(() =>
      chipDocumentNumberIndex(TEST_KEY, {
        environmentId: '',
        issuingState: 'UTO',
        documentNumber: 'X1',
      }),
    ).toThrow(TypeError);
  });
});

describe('C73.2, C73.4, C75.3: the report blind indexes', () => {
  const key = new Uint8Array(32).fill(0x6c);
  const environmentId = 'env_01JB0000000000000000000000';
  const hmac = (label: string, text: string) =>
    createHmac(
      'sha256',
      createHmac('sha256', key)
        .update(`openverify/blind-index/v1|${environmentId}`, 'utf8')
        .digest(),
    )
      .update(`${label}|${text}`, 'utf8')
      .digest('hex');

  it('names three labels of their own', () => {
    expect([
      REPORT_CRYPTO_ADDRESS_INDEX_LABEL,
      REPORT_MATCH_ENTRY_INDEX_LABEL,
      REPORT_MATCH_EVIDENCE_LABEL,
    ]).toEqual([
      'openverify/report-crypto-address/v1',
      'openverify/report-match-entry/v1',
      'openverify/report-match-evidence/v1',
    ]);
  });

  it('keys a report crypto address and a match entry under the environment subkey', () => {
    expect(reportCryptoAddressIndex(key, { environmentId, address: '0xabc' })).toBe(
      hmac(REPORT_CRYPTO_ADDRESS_INDEX_LABEL, '0xabc'),
    );
    expect(
      reportMatchEntryIndex(key, { environmentId, entryKey: 'openverify-sandbox:SYN-1' }),
    ).toBe(hmac(REPORT_MATCH_ENTRY_INDEX_LABEL, 'openverify-sandbox:SYN-1'));
    expect(
      reportCryptoAddressIndex(key, {
        environmentId: 'env_01JB0000000000000000000001',
        address: '0xabc',
      }),
    ).not.toBe(hmac(REPORT_CRYPTO_ADDRESS_INDEX_LABEL, '0xabc'));
  });

  it('frames the evidence as one JSON array, so no two splits give one input (P10)', () => {
    const one = reportMatchEvidenceHash(key, { environmentId, parts: ['a', 'b c'] });
    const two = reportMatchEvidenceHash(key, { environmentId, parts: ['a b', 'c'] });

    expect(one).toBe(hmac(REPORT_MATCH_EVIDENCE_LABEL, JSON.stringify(['a', 'b c'])));
    expect(one).not.toBe(two);
    expect(reportMatchEvidenceHash(key, { environmentId, parts: ['k', ['x', 'y']] })).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  it('refuses a key that is not 32 bytes', () => {
    expect(() =>
      reportMatchEntryIndex(new Uint8Array(16), { environmentId, entryKey: 'x' }),
    ).toThrow(BlindIndexKeyError);
  });
});
