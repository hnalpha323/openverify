import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, hotp, msUntilNextStep, totpCode, totpStep } from './totp.js';

/** RFC 6238 Appendix B: the SHA-1 seed "12345678901234567890" (8-digit codes), as base32. */
const RFC_SEED = new TextEncoder().encode('12345678901234567890');
const RFC_SECRET = base32Encode(RFC_SEED);

describe('base32Encode and base32Decode', () => {
  it('follow the RFC 4648 test vectors, without padding', () => {
    const ascii = (text: string) => new TextEncoder().encode(text);
    expect(
      ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar'].map((text) => base32Encode(ascii(text))),
    ).toEqual(['', 'MY', 'MZXQ', 'MZXW6', 'MZXW6YQ', 'MZXW6YTB', 'MZXW6YTBOI']);
  });

  it('decode, ignoring case, spaces and padding', () => {
    expect(Buffer.from(base32Decode(RFC_SECRET)).toString('ascii')).toBe('12345678901234567890');
    expect(Buffer.from(base32Decode('mzxw6 ytb oi======')).toString('ascii')).toBe('foobar');
  });

  it('refuses characters outside the alphabet', () => {
    expect(() => base32Decode('ABC1')).toThrow('The secret is not base32');
  });
});

describe('hotp', () => {
  it('matches the RFC 4226 Appendix D values', () => {
    const key = new TextEncoder().encode('12345678901234567890');
    expect([0, 1, 2, 9].map((counter) => hotp(key, counter, 6))).toEqual([
      '755224',
      '287082',
      '359152',
      '520489',
    ]);
  });
});

describe('totpCode', () => {
  it.each([
    [59, '94287082'],
    [1_111_111_109, '07081804'],
    [1_111_111_111, '14050471'],
    [1_234_567_890, '89005924'],
    [2_000_000_000, '69279037'],
    [20_000_000_000, '65353130'],
  ])('matches the RFC 6238 SHA-1 vector at %i s', (seconds, code) => {
    expect(totpCode(RFC_SECRET, new Date(seconds * 1000), 8)).toBe(code);
  });

  it('gives 6 digits by default (C15)', () => {
    expect(totpCode(RFC_SECRET, new Date(59_000))).toBe('287082');
  });
});

describe('totpStep and msUntilNextStep', () => {
  it('name the 30 second step of a time, as the API stores the last one used', () => {
    expect(totpStep(new Date(59_000))).toBe(1);
    expect(totpStep(new Date(60_000))).toBe(2);
  });

  it('measure the wait until the next step starts', () => {
    expect(msUntilNextStep(new Date(59_000))).toBe(1_000);
    expect(msUntilNextStep(new Date(60_000))).toBe(30_000);
  });
});
