/**
 * C200.2, C221.12 (review V13): the organisation's display name starts with a stable NFC boundary
 * (canonical combining class 0 and NFC_Quick_Check=Yes), so a consent text a device fills with it
 * and does not normalise has the digest the server takes over its NFC form. Every character is
 * built from its code point.
 */
import { describe, expect, it } from 'vitest';
import { displayNameProblem, isStableNfcBoundary } from './nfc-boundary.js';

const cp = (...codes: readonly number[]): string => String.fromCodePoint(...codes);

describe('isStableNfcBoundary (UAX #15)', () => {
  it.each([
    ['a Latin letter', 0x0043],
    ['a digit', 0x0037],
    ['a space', 0x0020],
    ['a precomposed Latin letter', 0x00e9],
    ['a precomposed Hangul syllable', 0xd55c],
    ['a Hangul leading consonant', 0x1100],
    ['an Arabic letter', 0x0627],
    ['a CJK ideograph', 0x4e2d],
    ['an emoji', 0x1f600],
    ['a Tamil letter', 0x0b95],
  ])('accepts %s', (_name, codePoint) => {
    expect(isStableNfcBoundary(codePoint)).toBe(true);
  });

  it.each([
    ['a combining acute accent (class 230)', 0x0301],
    ['a combining overlay (class 1)', 0x0334],
    ['the combining Greek ypogegrammeni (class 240)', 0x0345],
    ['a combining cedilla (class 202)', 0x0327],
    ['an Arabic fatha (class 30)', 0x064e],
    ['a Hangul vowel, the first of U+1161-U+1175', 0x1161],
    ['a Hangul vowel, the last of U+1161-U+1175', 0x1175],
    ['a Hangul final consonant, the first of U+11A8-U+11C2', 0x11a8],
    ['a Hangul final consonant, the last of U+11A8-U+11C2', 0x11c2],
    ['a Tamil vowel sign that composes with what precedes it (class 0)', 0x0bbe],
    ['a Malayalam length mark that composes (class 0)', 0x0d57],
    ['the angstrom sign, which NFC replaces', 0x212b],
    ['a CJK compatibility ideograph, which NFC replaces', 0xf900],
  ])('refuses %s', (_name, codePoint) => {
    expect(isStableNfcBoundary(codePoint)).toBe(false);
  });

  it('agrees with NFC at the junction for every code point it accepts below U+3400', () => {
    // A stable boundary never changes the NFC of what precedes it: NFC(p + c) = NFC(p) + NFC(c).
    const before = ['e', 'a', cp(0x1100), cp(0xac00), cp(0x0b92), cp(0x0d46), 'o'];
    const disagreements: string[] = [];
    for (let codePoint = 0; codePoint < 0x3400; codePoint += 1) {
      if ((codePoint >= 0xd800 && codePoint <= 0xdfff) || !isStableNfcBoundary(codePoint)) {
        continue;
      }
      const character = cp(codePoint);
      for (const lead of before) {
        if (`${lead}${character}`.normalize('NFC') !== `${lead}${character.normalize('NFC')}`) {
          disagreements.push(codePoint.toString(16));
        }
      }
    }
    expect(disagreements).toEqual([]);
  });
});

describe('displayNameProblem (C221.12)', () => {
  it('accepts a name that starts with a stable boundary, decomposed further on or not', () => {
    expect(displayNameProblem('Example Verification Ltd')).toBeNull();
    expect(displayNameProblem(`Cafe${cp(0x0301)} Example`)).toBeNull();
    expect(displayNameProblem(cp(0xd55c, 0xad6d, 0x0020, 0xc778, 0xc99d))).toBeNull();
    expect(displayNameProblem(cp(0x0634, 0x0631, 0x0643, 0x0629))).toBeNull();
  });

  it('refuses a name whose first character joins the text before it, saying why', () => {
    for (const name of [
      `${cp(0x0301)}Example`,
      `${cp(0x1161)}Example`,
      `${cp(0x11a8)}Example`,
      `${cp(0x0bbe)}Example`,
      `${cp(0x212b)}ngstrom`,
    ]) {
      expect(displayNameProblem(name), name.codePointAt(0)?.toString(16)).toMatch(
        /must start with a character that does not join the text before it/,
      );
    }
  });

  it('refuses a name longer than 100 characters once NFC-normalised', () => {
    // U+FB2C (Hebrew shin with dagesh and shin dot) is three characters in NFC.
    const name = `A${cp(0xfb2c).repeat(40)}`;
    expect(name.length).toBeLessThanOrEqual(100);
    expect(displayNameProblem(name)).toMatch(/at most 100 characters once NFC-normalised/);
  });
});
