import { describe, expect, it } from 'vitest';
import { normalizeDigits } from './digits.js';

/** U+0660 + n and U+06F0 + n, built from code points so no digit is typed by hand. */
const shifted = (digits: string, zero: number): string =>
  Array.from(digits, (digit) => String.fromCodePoint(zero + Number(digit))).join('');
const arabicIndic = (digits: string): string => shifted(digits, 0x0660);
const extendedArabicIndic = (digits: string): string => shifted(digits, 0x06f0);

describe('normalizeDigits (C161.4)', () => {
  it('maps every Arabic-Indic digit to its ASCII digit', () => {
    expect(normalizeDigits(arabicIndic('0123456789'))).toBe('0123456789');
  });

  it('maps every Extended Arabic-Indic digit to its ASCII digit', () => {
    expect(normalizeDigits(extendedArabicIndic('0123456789'))).toBe('0123456789');
  });

  it('keeps everything else as it is, in place', () => {
    // U+066B, the Arabic decimal separator, is not a digit.
    const separator = String.fromCodePoint(0x066b);
    const mixed = `code ${arabicIndic('12')}-${extendedArabicIndic('34')} 56 ${separator} x`;
    expect(normalizeDigits(mixed)).toBe(`code 12-34 56 ${separator} x`);
    expect(normalizeDigits('')).toBe('');
    expect(normalizeDigits('no digits')).toBe('no digits');
  });

  it('leaves other scripts’ digits alone (only the two Arabic ranges are in C161.4)', () => {
    // Devanagari six and fullwidth seven.
    const other = `${String.fromCodePoint(0x096c)}${String.fromCodePoint(0xff17)}`;
    expect(normalizeDigits(other)).toBe(other);
  });
});
