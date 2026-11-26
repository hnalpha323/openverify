import { writingSystemsOf } from '@openverify/checks';
import { describe, expect, it } from 'vitest';
import {
  SYNTHETIC_LEGAL_FORMS,
  fictionalCompanyName,
  fictionalFamilyName,
  fictionalGivenName,
  fictionalHanName,
  fictionalPersonName,
  fictionalPlace,
  fictionalVesselName,
  type NameToken,
} from './names.js';
import { seededRandom } from './random.js';

const scripts = (text: string): string[] => [...writingSystemsOf(text)].sort();

function expectToken(token: NameToken): void {
  expect(token.latin).toMatch(/^[A-Z][a-z]+$/);
  expect(token.syllables.join('')).toBe(token.latin.toLowerCase());
  expect(token.syllables.length).toBeGreaterThanOrEqual(2);
  expect(scripts(token.cyrillic)).toEqual(['cyrillic']);
  expect(scripts(token.arabic)).toEqual(['arabic']);
}

describe('fictional names', () => {
  it('builds given and family names in Latin, Cyrillic and Arabic', () => {
    const random = seededRandom('names');
    for (let index = 0; index < 300; index += 1) {
      expectToken(fictionalGivenName(random));
      expectToken(fictionalFamilyName(random));
    }
  });

  it('is reproducible from its seed and varied across draws', () => {
    const latin = (seed: string): string[] => {
      const random = seededRandom(seed);
      return Array.from({ length: 50 }, () => fictionalFamilyName(random).latin);
    };
    expect(latin('a')).toEqual(latin('a'));
    expect(latin('a')).not.toEqual(latin('b'));
    const random = seededRandom('variety');
    const given = new Set(Array.from({ length: 400 }, () => fictionalGivenName(random).latin));
    const family = new Set(Array.from({ length: 400 }, () => fictionalFamilyName(random).latin));
    expect(given.size).toBeGreaterThan(300);
    expect(family.size).toBeGreaterThan(300);
  });

  it('adds a middle name only when asked', () => {
    const random = seededRandom('people');
    const plain = fictionalPersonName(random);
    expect(plain.middle).toBeNull();
    expectToken(plain.given);
    expectToken(plain.family);
    const middle = fictionalPersonName(random, { middle: true });
    expect(middle.middle).not.toBeNull();
    if (middle.middle !== null) {
      expectToken(middle.middle);
    }
  });

  it('builds Han names with their toneless pinyin, family name first', () => {
    const random = seededRandom('han');
    for (let index = 0; index < 50; index += 1) {
      const name = fictionalHanName(random);
      expect(scripts(name.han)).toEqual(['han']);
      expect(name.han).toBe(`${name.familyHan}${name.givenHan}`);
      expect(Array.from(name.familyHan)).toHaveLength(1);
      expect([1, 2]).toContain(Array.from(name.givenHan).length);
      expect(name.latin).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    }
  });

  it('builds company names from distinctive words, a generic word and a legal form', () => {
    const random = seededRandom('companies');
    expect(SYNTHETIC_LEGAL_FORMS.length).toBeGreaterThanOrEqual(8);
    const forms = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      const company = fictionalCompanyName(random);
      expect(company.words.length).toBeGreaterThanOrEqual(1);
      expect(SYNTHETIC_LEGAL_FORMS).toContain(company.legalForm);
      forms.add(company.legalForm);
      const parts = [...company.words, ...(company.generic === null ? [] : [company.generic])];
      expect(company.full).toBe(`${parts.join(' ')} ${company.legalForm}`);
      expect(scripts(company.full)).toEqual(['latin']);
    }
    expect(forms.size).toBe(SYNTHETIC_LEGAL_FORMS.length);
  });

  it('builds vessel and place names in Latin', () => {
    const random = seededRandom('things');
    for (let index = 0; index < 50; index += 1) {
      expect(fictionalVesselName(random)).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
      // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
      expect(fictionalPlace(random)).toMatch(/^[A-Z][a-z]+(?: [A-Z][a-z]+)?$/);
    }
  });
});
