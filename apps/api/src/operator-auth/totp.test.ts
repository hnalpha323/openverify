import { otpauthUriSchema, totpSecretSchema } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import {
  TOTP_SECRET_BYTES,
  base32Decode,
  base32Encode,
  hotp,
  newTotpSecret,
  otpauthUri,
  totpCode,
  totpStep,
  verifyTotp,
} from './totp.js';

/** RFC 6238 Appendix B seeds: ASCII "1234567890" repeated to the key length of each hash. */
const SEED_SHA1 = Buffer.from('12345678901234567890', 'ascii');
const SEED_SHA256 = Buffer.from('12345678901234567890123456789012', 'ascii');
const SEED_SHA512 = Buffer.from(
  '1234567890123456789012345678901234567890123456789012345678901234',
  'ascii',
);

/** RFC 6238 Appendix B: Unix time (seconds), then the 8-digit TOTP for SHA-1, SHA-256, SHA-512. */
const RFC6238_VECTORS = [
  [59, '94287082', '46119246', '90693936'],
  [1111111109, '07081804', '68084774', '25091201'],
  [1111111111, '14050471', '67062674', '99943326'],
  [1234567890, '89005924', '91819424', '93441116'],
  [2000000000, '69279037', '90698825', '38618901'],
  [20000000000, '65353130', '77737706', '47863826'],
] as const;

/** RFC 4226 Appendix D: HOTP values of the SHA-1 seed for counters 0 to 9. */
const RFC4226_VECTORS = [
  '755224',
  '287082',
  '359152',
  '969429',
  '338314',
  '254676',
  '287922',
  '162583',
  '399871',
  '520489',
];

const at = (seconds: number) => new Date(seconds * 1000);

describe('hotp', () => {
  it.each(RFC4226_VECTORS.map((code, counter) => [counter, code] as const))(
    'matches RFC 4226 for counter %i',
    (counter, code) => {
      expect(hotp(SEED_SHA1, counter)).toBe(code);
    },
  );
});

describe('totpCode', () => {
  it.each(RFC6238_VECTORS)(
    'matches RFC 6238 at T=%i for SHA-1, SHA-256 and SHA-512',
    (time, sha1, sha256, sha512) => {
      const step = totpStep(at(time));
      expect(hotp(SEED_SHA1, step, { digits: 8, algorithm: 'sha1' })).toBe(sha1);
      expect(hotp(SEED_SHA256, step, { digits: 8, algorithm: 'sha256' })).toBe(sha256);
      expect(hotp(SEED_SHA512, step, { digits: 8, algorithm: 'sha512' })).toBe(sha512);
    },
  );

  it('uses SHA-1, 6 digits and 30 second steps for a base32 secret (C15)', () => {
    const secret = base32Encode(SEED_SHA1);

    // The last six digits of the RFC 6238 SHA-1 vector at T=59.
    expect(totpCode(secret, at(59))).toBe('287082');
    expect(totpStep(at(59))).toBe(1);
    expect(totpStep(at(60))).toBe(2);
  });
});

describe('base32', () => {
  it.each([
    ['', ''],
    ['f', 'MY'],
    ['fo', 'MZXQ'],
    ['foo', 'MZXW6'],
    ['foob', 'MZXW6YQ'],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI'],
  ])('encodes and decodes the RFC 4648 vector %j without padding', (plain, encoded) => {
    expect(base32Encode(Buffer.from(plain, 'ascii'))).toBe(encoded);
    expect(Buffer.from(base32Decode(encoded)).toString('ascii')).toBe(plain);
  });

  it('decodes case-insensitively and ignores padding and spaces, as people type secrets', () => {
    expect(Buffer.from(base32Decode('mzxw 6ytb oi======')).toString('ascii')).toBe('foobar');
  });

  it('refuses characters outside the alphabet', () => {
    expect(() => base32Decode('MZXW1')).toThrow(RangeError);
  });
});

describe('newTotpSecret', () => {
  it('draws 160 random bits as an unpadded base32 secret the contract accepts', () => {
    const secret = newTotpSecret();

    expect(TOTP_SECRET_BYTES).toBe(20);
    expect(secret).toHaveLength(32);
    expect(totpSecretSchema.safeParse(secret).success).toBe(true);
    expect(newTotpSecret()).not.toBe(secret);
  });

  it('uses the injected randomness', () => {
    expect(newTotpSecret((size) => Buffer.alloc(size, 0))).toBe('A'.repeat(32));
  });
});

describe('verifyTotp', () => {
  const secret = base32Encode(SEED_SHA1);
  const now = at(1111111111);
  const step = totpStep(now);
  const codeAt = (offset: number) => totpCode(secret, at(1111111111 + offset * 30));

  it('accepts the current code and returns its step', () => {
    expect(verifyTotp(secret, codeAt(0), now)).toBe(step);
  });

  it('accepts the previous and the next step, and nothing further (C15: plus or minus one step)', () => {
    expect(verifyTotp(secret, codeAt(-1), now)).toBe(step - 1);
    expect(verifyTotp(secret, codeAt(1), now)).toBe(step + 1);
    expect(verifyTotp(secret, codeAt(-2), now)).toBeNull();
    expect(verifyTotp(secret, codeAt(2), now)).toBeNull();
  });

  it('refuses a step at or before the last used one (replay protection)', () => {
    expect(verifyTotp(secret, codeAt(0), now, { lastUsedStep: step })).toBeNull();
    expect(verifyTotp(secret, codeAt(-1), now, { lastUsedStep: step - 1 })).toBeNull();
    expect(verifyTotp(secret, codeAt(1), now, { lastUsedStep: step })).toBe(step + 1);
  });

  it('refuses malformed codes and secrets without throwing', () => {
    expect(verifyTotp(secret, '12345', now)).toBeNull();
    expect(verifyTotp(secret, '1234567', now)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', now)).toBeNull();
    expect(verifyTotp('not base32!', '123456', now)).toBeNull();
  });
});

describe('otpauthUri', () => {
  it('builds the key URI authenticator apps scan, with the issuer and the C15 parameters', () => {
    const uri = otpauthUri({
      secret: 'JBSWY3DPEHPK3PXP',
      accountName: 'operator+mfa@example.test',
      issuer: 'OpenVerify',
    });

    expect(uri).toBe(
      'otpauth://totp/OpenVerify:operator%2Bmfa%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=OpenVerify&algorithm=SHA1&digits=6&period=30',
    );
    expect(otpauthUriSchema.safeParse(uri).success).toBe(true);
  });

  it('encodes spaces and colons in the issuer', () => {
    const uri = otpauthUri({
      secret: 'JBSWY3DPEHPK3PXP',
      accountName: 'a@example.test',
      issuer: 'Open Verify: Dev',
    });

    expect(uri).toContain('/Open%20Verify%3A%20Dev:a%40example.test?');
    expect(uri).toContain('&issuer=Open%20Verify%3A%20Dev&');
    expect(otpauthUriSchema.safeParse(uri).success).toBe(true);
  });
});
