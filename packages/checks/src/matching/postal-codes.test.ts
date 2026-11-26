import { describe, expect, it } from 'vitest';
import { cpuMilliseconds } from '../document/testing.js';
import {
  canonicalPostalCode,
  comparePostalCodes,
  findPostalCode,
  isValidPostalCode,
} from './postal-codes.js';

describe('canonicalPostalCode', () => {
  it('keeps upper-case letters and digits only', () => {
    expect(canonicalPostalCode(' sw1a-1aa ')).toBe('SW1A1AA');
    expect(canonicalPostalCode('00123-4567')).toBe('001234567');
  });
});

describe('isValidPostalCode', () => {
  it("checks a code against its country's pattern, by alpha-2 or alpha-3", () => {
    expect(isValidPostalCode('00123', 'US')).toBe(true);
    expect(isValidPostalCode('00123-4567', 'USA')).toBe(true);
    expect(isValidPostalCode('0012', 'US')).toBe(false);
    expect(isValidPostalCode('SW1A 1AA', 'GB')).toBe(true);
    expect(isValidPostalCode('QQ1 1QQ', 'GB')).toBe(false);
    expect(isValidPostalCode('00042', 'DE')).toBe(true);
  });

  it('has no answer for a country without a pattern or an unknown code', () => {
    expect(isValidPostalCode('00123', 'AQ')).toBeNull();
    expect(isValidPostalCode('00123', 'ZZZ')).toBeNull();
  });

  it('refuses a code longer than 20 characters without reading it', () => {
    expect(isValidPostalCode('1'.repeat(10_000), 'US')).toBe(false);
  });
});

describe('comparePostalCodes', () => {
  it.each([
    ['00123', '00123', 'US', 'exact'],
    ['00123', '00123-4567', 'US', 'exact'],
    ['00123-4567', '00123-4568', 'US', 'fuzzy'],
    ['00123', '00124', 'US', 'mismatch'],
    ['SW1A 1AA', 'sw1a1aa', 'GB', 'exact'],
    ['K1A 0B1', 'K1A0B1', null, 'exact'],
    [null, '00123', 'US', 'one-sided'],
    [' ', null, 'US', 'absent'],
  ] as const)('%j and %j in %s: %s', (a, b, country, expected) => {
    expect(comparePostalCodes(a, b, country)).toBe(expected);
  });
});

describe('findPostalCode', () => {
  it("finds the country's code as a whole word", () => {
    expect(findPostalCode('Lanternfield, CA 00123', 'US')).toBe('00123');
    expect(findPostalCode('00042 Lanternfeld', 'DE')).toBe('00042');
    expect(findPostalCode('SW1A 1AA LONDON', 'GB')).toBe('SW1A 1AA');
    expect(findPostalCode('123 Quillon St', 'DE')).toBeNull();
    expect(findPostalCode('no code here', 'US')).toBeNull();
    expect(findPostalCode('00123', 'AQ')).toBeNull();
  });

  it('reads a 100 KB line in bounded time (C58.7)', () => {
    expect(
      cpuMilliseconds(() => {
        findPostalCode('SW1A 1A '.repeat(12_500), 'GB');
      }),
    ).toBeLessThan(100);
  });
});
