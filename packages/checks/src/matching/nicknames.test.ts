import { describe, expect, it } from 'vitest';
import { areNicknames, nicknamePairs } from './nicknames.js';
import { foldText } from './text.js';

describe('areNicknames (C58.3)', () => {
  it.each([
    ['Bill', 'William'],
    ['william', 'BILL'],
    ['Bob', 'Robert'],
    ['Peggy', 'Margaret'],
    ['Pepe', 'José'],
    ['pepe', 'jose'],
    ['Käthe', 'Katharina'],
    ['Kaethe', 'Katharina'],
    ['Koldo', 'Koldobika'],
  ])('links %s and %s', (a, b) => {
    expect(areNicknames(a, b)).toBe(true);
  });

  it.each([
    ['Bill', 'Robert'],
    ['Bill', 'Bill'],
    // Two nicknames of Robert: never chained.
    ['Bob', 'Bobby'],
    ['', 'William'],
    ['Zyx', 'Qwv'],
  ])('does not link %j and %j', (a, b) => {
    expect(areNicknames(a, b)).toBe(false);
  });
});

describe('the committed nickname table (C58.3)', () => {
  const pairs = nicknamePairs();

  it('holds between 1,200 and 1,800 pairs, as the plan sizes it', () => {
    expect(pairs.length).toBeGreaterThanOrEqual(1200);
    expect(pairs.length).toBeLessThanOrEqual(1800);
  });

  it('records a source for every pair: authored, or a reviewed Wikidata statement', () => {
    for (const pair of pairs) {
      expect(pair.sources.length).toBeGreaterThan(0);
      for (const source of pair.sources) {
        expect(source).toMatch(/^(?:authored|wikidata:Q[1-9]\d*\/Q[1-9]\d*)$/);
      }
    }
    expect(pairs.filter((pair) => pair.sources.some((s) => s.startsWith('wikidata:')))).not.toEqual(
      [],
    );
  });

  it('never pairs a name with itself, and lists each folded pair once', () => {
    const keys = pairs.map((pair) => {
      const formal = foldText(pair.formal).simplified;
      const nickname = foldText(pair.nickname).simplified;
      expect(nickname).not.toBe(formal);
      return `${formal}|${nickname}`;
    });
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every pair its ISO 639-1 languages', () => {
    for (const pair of pairs) {
      expect(pair.languages.length).toBeGreaterThan(0);
      for (const language of pair.languages) {
        expect(language).toMatch(/^[a-z]{2}$/);
      }
    }
  });
});
