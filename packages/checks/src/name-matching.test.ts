import { describe, expect, it } from 'vitest';
import {
  compareNames,
  jaroSimilarity,
  jaroWinkler,
  nameTokens,
  normalizeName,
  tokenSetSimilarity,
} from './name-matching.js';

describe('normalizeName', () => {
  it.each([
    ['José', 'jose'],
    ['MÜLLER', 'muller'],
    ['Zoë Saldaña', 'zoe saldana'],
    ['Łukasz', 'lukasz'],
    ['Straße', 'strasse'],
    ['Ærøskøbing', 'aeroskobing'],
    ['Œuvre', 'oeuvre'],
    ['Þórunn', 'thorunn'],
    ['Đorđe', 'dorde'],
    ['Iıİ', 'iii'],
    ['ＪＯＨＮ', 'john'], // full-width compatibility forms
    ["O'Brien", 'obrien'],
    ['D’Angelo', 'dangelo'],
    ['Jean-Pierre', 'jean pierre'],
    ['Smith, John', 'smith john'],
    ['Dr. Who', 'dr who'],
    ['  Anna \t  MARIA\n', 'anna maria'],
    ['Иван Петров', 'иван петров'],
    ['李小龍', '李小龍'],
    ['', ''],
    ['  - ', ''],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeName(input)).toBe(expected);
  });

  it('splits a normalized name into tokens', () => {
    expect(nameTokens('Eriksson,  Anna-Maria')).toEqual(['eriksson', 'anna', 'maria']);
    expect(nameTokens('   ')).toEqual([]);
  });
});

describe('jaroSimilarity and jaroWinkler', () => {
  // Reference values from the jellyfish Python library (MIT).
  it.each([
    ['MARTHA', 'MARHTA', 0.944444, 0.961111],
    ['DWAYNE', 'DUANE', 0.822222, 0.84],
    ['DIXON', 'DICKSONX', 0.766667, 0.813333],
    ['ERIKSSON', 'ERIKSON', 0.958333, 0.975],
    ['ANNA', 'ANNE', 0.833333, 0.883333],
    ['JONES', 'JOHNSON', 0.790476, 0.832381],
    ['CRATE', 'TRACE', 0.733333, 0.733333],
    // Jaro at or below 0.7: no prefix bonus despite the shared "jo".
    ['john smith', 'jones peter', 0.659596, 0.659596],
    ['A', 'A', 1, 1],
    ['ABC', 'XYZ', 0, 0],
  ])('scores %s vs %s', (a, b, jaro, winkler) => {
    expect(jaroSimilarity(a, b)).toBeCloseTo(jaro, 5);
    expect(jaroWinkler(a, b)).toBeCloseTo(winkler, 5);
  });

  it('is symmetric', () => {
    for (const [a, b] of [
      ['MARTHA', 'MARHTA'],
      ['DIXON', 'DICKSONX'],
      ['anna', 'hannah'],
    ] as const) {
      expect(jaroWinkler(a, b)).toBeCloseTo(jaroWinkler(b, a), 10);
    }
  });

  it('treats two empty strings as identical and one empty string as no match', () => {
    expect(jaroWinkler('', '')).toBe(1);
    expect(jaroWinkler('', 'anna')).toBe(0);
    expect(jaroWinkler('anna', '')).toBe(0);
  });

  it('compares by code point, so astral characters count once', () => {
    expect(jaroWinkler('𝒜nna', '𝒜nna')).toBe(1);
    expect(jaroSimilarity('𝒜b', '𝒜c')).toBeCloseTo((0.5 + 0.5 + 1) / 3, 10);
  });

  it('caps the Winkler prefix bonus at four characters', () => {
    // Seven shared leading characters, Jaro ~0.917 (above the boost threshold).
    const jaro = jaroSimilarity('ABCDEFGX', 'ABCDEFGY');
    expect(jaro).toBeGreaterThan(0.7);
    expect(jaroWinkler('ABCDEFGX', 'ABCDEFGY')).toBeCloseTo(jaro + 4 * 0.1 * (1 - jaro), 10);
  });

  it('accepts a custom prefix scale within the valid range', () => {
    const jaro = jaroSimilarity('MARTHA', 'MARHTA');
    expect(jaroWinkler('MARTHA', 'MARHTA', { prefixScale: 0 })).toBeCloseTo(jaro, 10);
    expect(() => jaroWinkler('a', 'b', { prefixScale: 0.3 })).toThrow(RangeError);
    expect(() => jaroWinkler('a', 'b', { prefixScale: -0.1 })).toThrow(RangeError);
  });

  it('applies the prefix bonus below 0.7 when the boost threshold is lowered', () => {
    const jaro = jaroSimilarity('john smith', 'jones peter');
    expect(jaroWinkler('john smith', 'jones peter', { boostThreshold: 0 })).toBeCloseTo(
      jaro + 2 * 0.1 * (1 - jaro),
      10,
    );
  });
});

describe('tokenSetSimilarity', () => {
  it('ignores token order, case, accents and punctuation', () => {
    expect(tokenSetSimilarity('Anna María Eriksson', 'ERIKSSON, Anna Maria')).toBe(1);
  });

  it('scores a token subset as a full match (middle name missing)', () => {
    expect(tokenSetSimilarity('Anna Eriksson', 'Anna Maria Eriksson')).toBe(1);
  });

  it('stays high for a small typo', () => {
    expect(tokenSetSimilarity('Jon Smith', 'John Smith')).toBeGreaterThan(0.9);
  });

  it('stays low for different people', () => {
    expect(tokenSetSimilarity('John Smith', 'Peter Jones')).toBeLessThan(0.7);
  });

  it('handles empty names', () => {
    expect(tokenSetSimilarity('', '')).toBe(1);
    expect(tokenSetSimilarity('Anna', ' ')).toBe(0);
  });
});

describe('compareNames', () => {
  it('reports an exact match after normalization', () => {
    expect(compareNames('José Müller', 'JOSE MULLER')).toEqual({
      normalizedA: 'jose muller',
      normalizedB: 'jose muller',
      exact: true,
      jaroWinkler: 1,
      tokenSortJaroWinkler: 1,
      tokenSet: 1,
      score: 1,
    });
  });

  it('scores reordered names as a full match through token sorting', () => {
    const comparison = compareNames('Anna Maria Eriksson', 'Eriksson Anna Maria');
    expect(comparison.exact).toBe(false);
    expect(comparison.jaroWinkler).toBeLessThan(0.7);
    expect(comparison.tokenSortJaroWinkler).toBe(1);
    expect(comparison.score).toBe(1);
  });

  it('keeps the subset match separate from the overall score', () => {
    const comparison = compareNames('Anna Eriksson', 'Anna Maria Eriksson');
    expect(comparison.tokenSet).toBe(1);
    expect(comparison.score).toBeLessThan(1);
    expect(comparison.score).toBeGreaterThan(0.8);
  });

  it('scores different people low', () => {
    expect(compareNames('Anna Eriksson', 'Peter Stevenson').score).toBeLessThan(0.7);
  });

  it('keeps every score within [0, 1]', () => {
    const pairs = [
      ['', ''],
      ['a', ''],
      ['Anna', 'Anna'],
      ['Li Wei', 'Wei Li'],
      ['Иван', 'Ivan'],
    ] as const;
    for (const [a, b] of pairs) {
      const comparison = compareNames(a, b);
      for (const score of [
        comparison.jaroWinkler,
        comparison.tokenSortJaroWinkler,
        comparison.tokenSet,
        comparison.score,
      ]) {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    }
  });
});
