import { describe, expect, it } from 'vitest';
import {
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_PATTERN,
  newRecoveryCode,
  newRecoveryCodes,
  normalizeRecoveryCode,
  recoveryCodeInputSchema,
  recoveryCodesSchema,
} from './recovery-codes.js';

/** Returns each byte array in turn, for deterministic codes. */
function sequence(...draws: number[][]) {
  let index = 0;
  return (length: number) => {
    const draw = draws[index % draws.length] ?? [];
    index += 1;
    expect(length).toBe(8);
    return Uint8Array.from(draw);
  };
}

describe('recovery codes (C9)', () => {
  it('are 10 per user', () => {
    expect(RECOVERY_CODE_COUNT).toBe(10);
  });

  it('look like xxxx-xxxx-xxxx in uppercase Crockford base32', () => {
    const code = newRecoveryCode();
    expect(code).toMatch(RECOVERY_CODE_PATTERN);
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  });

  it('encode 60 random bits, most significant first', () => {
    expect(newRecoveryCode(sequence([0, 0, 0, 0, 0, 0, 0, 0]))).toBe('0000-0000-0000');
    expect(newRecoveryCode(sequence([255, 255, 255, 255, 255, 255, 255, 255]))).toBe(
      'ZZZZ-ZZZZ-ZZZZ',
    );
    // 0x0842108421084210 is twelve 5-bit groups of 00001 followed by 0000.
    expect(newRecoveryCode(sequence([0x08, 0x42, 0x10, 0x84, 0x21, 0x08, 0x42, 0x10]))).toBe(
      '1111-1111-1111',
    );
  });

  it('come as a set of 10 distinct codes', () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    expect(recoveryCodesSchema.parse(codes)).toEqual(codes);
  });

  it('skip a repeated draw', () => {
    const draws = Array.from({ length: 10 }, (_, index) => [index, 0, 0, 0, 0, 0, 0, 0]);
    const codes = newRecoveryCodes(sequence(draws[0] ?? [], ...draws));
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
  });

  it('refuse a randomness source that keeps repeating itself', () => {
    expect(() => newRecoveryCodes(sequence([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(Error);
  });

  it('reject a randomness source that returns the wrong number of bytes', () => {
    expect(() => newRecoveryCode(() => new Uint8Array(7))).toThrow(TypeError);
  });
});

describe('normalizeRecoveryCode', () => {
  it.each([
    ['ABCD-EFGH-JKMN', 'ABCD-EFGH-JKMN'],
    ['abcd-efgh-jkmn', 'ABCD-EFGH-JKMN'],
    ['abcdefghjkmn', 'ABCD-EFGH-JKMN'],
    [' abcd efgh jkmn ', 'ABCD-EFGH-JKMN'],
    ['OIL0-0000-0000', '0110-0000-0000'],
  ])('reads %j as %s', (input, expected) => {
    expect(normalizeRecoveryCode(input)).toBe(expected);
  });

  it.each([
    '',
    'ABCD-EFGH-JKM',
    'ABCD-EFGH-JKMNP',
    'ABCD-EFGH-JKMU',
    'ABCD_EFGH_JKMN',
    'ÄBCD-EFGH-JKMN',
  ])('rejects %j', (input) => {
    expect(normalizeRecoveryCode(input)).toBeNull();
  });
});

describe('recovery code schemas', () => {
  it('accept what a person types and reject the rest', () => {
    expect(recoveryCodeInputSchema.safeParse('abcd efgh jkmn').success).toBe(true);
    expect(recoveryCodeInputSchema.safeParse('not-a-code').success).toBe(false);
    expect(recoveryCodeInputSchema.safeParse('A'.repeat(40)).success).toBe(false);
  });

  it('return exactly 10 distinct canonical codes', () => {
    const codes = newRecoveryCodes();
    expect(recoveryCodesSchema.safeParse(codes.slice(1)).success).toBe(false);
    expect(
      recoveryCodesSchema.safeParse([...codes.slice(1), codes[0]?.toLowerCase()]).success,
    ).toBe(false);
    expect(recoveryCodesSchema.safeParse([...codes.slice(1), codes[1]]).success).toBe(false);
  });
});
