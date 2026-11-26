import { describe, expect, it } from 'vitest';
import { cpuMilliseconds } from '../document/testing.js';
import { matchNameStrings, matchPersonNames, type PersonName } from './names.js';

const name = (first: string | null, last: string | null, middle?: string): PersonName => ({
  first,
  last,
  ...(middle === undefined ? {} : { middle }),
});
const level = (a: PersonName, b: PersonName) => matchPersonNames(a, b).level;

describe('matchPersonNames (C58.2)', () => {
  it('is full only on equal folded tokens, case aside', () => {
    expect(matchPersonNames(name('Ada', 'Vellacott'), name('ADA', 'vellacott'))).toEqual({
      level: 'full',
      methods: [],
      flags: [],
    });
  });

  it.each([
    [name('José', 'Núñez'), name('Jose', 'Nunez'), ['fold_characters']],
    [name('Ada', 'Müller'), name('Ada', 'Mueller'), ['fold_characters']],
    [name('Ada', "O'Rourke"), name('Ada', 'ORourke'), ['remove_special_characters']],
    [name('Ada', 'Garcia-Lopez'), name('Ada', 'Garcia Lopez'), ['remove_special_characters']],
    [name('Dr Ada', 'Vellacott'), name('Ada', 'Vellacott'), ['remove_prefixes']],
    [name('Ada', 'Vellacott Jr'), name('Ada', 'Vellacott'), ['remove_suffixes']],
    [name('Ada', 'Vellacott III'), name('Ada', 'Vellacott'), ['remove_suffixes']],
    [name('Ada', 'Vellacott', 'Rose'), name('Ada', 'Vellacott'), []],
  ])('normalises %j and %j to full', (a, b, methods) => {
    expect(matchPersonNames(a, b)).toEqual({ level: 'full', methods, flags: [] });
  });

  it.each([
    [
      'particles joined on one side',
      name('Ada', 'De Luca'),
      name('Ada', 'DeLuca'),
      ['tokenization'],
    ],
    [
      'a second family name on one side',
      name('Ada', 'Garcia Lopez'),
      name('Ada', 'Garcia'),
      ['tokenization'],
    ],
    [
      'an initial for the given name',
      name('J', 'Vellacott'),
      name('Jonah', 'Vellacott'),
      ['substring'],
    ],
    ['a nickname', name('Bill', 'Vellacott'), name('William', 'Vellacott'), ['nickname']],
    ['a one-letter typo', name('Ada', 'Velacott'), name('Ada', 'Vellacott'), ['string_similarity']],
    [
      'an initial for the middle name',
      name('Ada', 'Vellacott', 'R'),
      name('Ada', 'Vellacott', 'Rose'),
      ['substring'],
    ],
  ])('%s is partial', (_case, a, b, methods) => {
    expect(matchPersonNames(a, b)).toEqual({ level: 'partial', methods, flags: [] });
  });

  it('reads a middle name written inside the first name as the same name', () => {
    expect(
      matchPersonNames(name('Ada Rose', 'Vellacott'), name('Ada', 'Vellacott', 'Rose')),
    ).toEqual({
      level: 'full',
      methods: [],
      flags: [],
    });
  });

  it('reports the normalisation of either side', () => {
    expect(matchPersonNames(name('Ada', 'Nunez'), name('Ada', 'Núñez')).methods).toEqual([
      'fold_characters',
    ]);
  });

  it('given and family names swapped is partial, flagged swapped', () => {
    expect(matchPersonNames(name('Vellacott', 'Ada'), name('Ada', 'Vellacott'))).toEqual({
      level: 'partial',
      methods: ['tokenization'],
      flags: ['swapped'],
    });
  });

  it('different middle names, or different generational suffixes, are at most partial', () => {
    expect(
      matchPersonNames(name('Ada', 'Vellacott', 'Rose'), name('Ada', 'Vellacott', 'June')),
    ).toMatchObject({ level: 'partial', flags: ['middle-name-mismatch'] });
    expect(
      matchPersonNames(name('Ada', 'Vellacott Jr'), name('Ada', 'Vellacott Sr')),
    ).toMatchObject({ level: 'partial', flags: ['suffix-mismatch'] });
  });

  it('keeps a title that is also a given name', () => {
    const match = matchPersonNames(name('Don Carlo', 'Vellacott'), name('Carlo', 'Vellacott'));

    expect(match.level).toBe('partial');
    expect(match.methods).not.toContain('remove_prefixes');
  });

  it('a different family or given name is none, with no method', () => {
    expect(matchPersonNames(name('Ada', 'Vellacott'), name('Ada', 'Ostrander'))).toEqual({
      level: 'none',
      methods: [],
      flags: [],
    });
    expect(level(name('Ada', 'Vellacott'), name('Mira', 'Vellacott'))).toBe('none');
  });

  it('never chains two nicknames of one name', () => {
    expect(level(name('Bob', 'Vellacott'), name('Bobby', 'Vellacott'))).toBe('none');
  });

  it('a name without its family or given part, or a family initial, is missing', () => {
    expect(matchPersonNames(name('Ada', null), name('Ada', 'Vellacott'))).toEqual({
      level: 'missing',
      methods: [],
      flags: ['family-name-missing'],
    });
    expect(matchPersonNames(name(null, 'Vellacott'), name('Ada', 'Vellacott')).flags).toEqual([
      'given-name-missing',
    ]);
    expect(matchPersonNames(name('Ada', 'V'), name('Ada', 'Vellacott')).flags).toEqual([
      'family-name-initial',
    ]);
    expect(level({}, name('Ada', 'Vellacott'))).toBe('missing');
  });

  it('a contradiction wins over a missing part', () => {
    expect(level(name(null, 'Ostrander'), name('Ada', 'Vellacott'))).toBe('none');
  });

  it('names in two writing systems are missing, never a mismatch', () => {
    expect(matchPersonNames(name('Иван', 'Петров'), name('Ivan', 'Petrov'))).toEqual({
      level: 'missing',
      methods: [],
      flags: ['script-mismatch'],
    });
    expect(level(name('Иван', 'Петров'), name('ИВАН', 'петров'))).toBe('full');
  });

  it('is symmetric', () => {
    const pairs: [PersonName, PersonName][] = [
      [name('Bill', 'Vellacott'), name('William', 'Vellacott')],
      [name('Vellacott', 'Ada'), name('Ada', 'Vellacott')],
      [name('Ada', 'Vellacott Jr'), name('Ada', 'Vellacott')],
      [name('Ada', null), name('Ada', 'Vellacott')],
    ];
    for (const [a, b] of pairs) {
      expect(matchPersonNames(a, b)).toEqual(matchPersonNames(b, a));
    }
  });

  it('compares 100 KB of near-matching input in bounded time (C58.7)', () => {
    const long = 'ada '.repeat(25_000);
    expect(
      cpuMilliseconds(() => {
        matchPersonNames(name(long, long), name('Ada', 'Ada'));
      }),
    ).toBeLessThan(200);
  });
});

describe('matchNameStrings (C58.2)', () => {
  it.each([
    ['Ada Vellacott', 'ada vellacott', 'full', [], []],
    ['Mrs Ada Vellacott', 'Ada Vellacott', 'full', ['remove_prefixes'], []],
    ['Ada Vellacott Jr', 'Ada Vellacott', 'full', ['remove_suffixes'], []],
    ['Vellacott Ada', 'Ada Vellacott', 'partial', ['tokenization'], ['swapped']],
    ['A Vellacott', 'Ada Vellacott', 'partial', ['substring'], []],
    ['Bill Vellacott', 'William Vellacott', 'partial', ['nickname'], []],
    ['Ada R Vellacott', 'Ada Vellacott', 'partial', ['tokenization'], []],
    ['Vellacott', 'Ada Vellacott', 'missing', [], ['name-incomplete']],
    ['Ada V', 'Ada Vellacott', 'missing', [], ['family-name-initial']],
    ['Ada Vellacott', 'Ada Ostrander', 'none', [], []],
    ['Иван Петров', 'Ivan Petrov', 'missing', [], ['script-mismatch']],
  ])('%j and %j: %s', (a, b, expected, methods, flags) => {
    expect(matchNameStrings(a, b)).toEqual({ level: expected, methods, flags });
  });

  it('is missing without a name on either side', () => {
    expect(matchNameStrings(null, 'Ada Vellacott').level).toBe('missing');
    expect(matchNameStrings('Mr', 'Ada Vellacott').level).toBe('missing');
  });
});
