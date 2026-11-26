import { describe, expect, it } from 'vitest';
import { cpuMilliseconds } from '../document/testing.js';
import { matchPartialDates, parsePartialDate } from './partial-dates.js';

/** A fixed day for R6, so the tests never depend on the clock. */
const TODAY = { year: 2026, month: 10, day: 23 };
const match = (a: string | null | undefined, b: string | null | undefined) =>
  matchPartialDates(a, b, { today: TODAY });

describe('parsePartialDate', () => {
  it.each([
    ['1987-04-12', { year: 1987, month: 4, day: 12 }],
    ['1987-04', { year: 1987, month: 4, day: null }],
    ['1987', { year: 1987, month: null, day: null }],
    ['1987-XX-XX', { year: 1987, month: null, day: null }],
    ['1987-00-00', { year: 1987, month: null, day: null }],
    ['1987-04-xx', { year: 1987, month: 4, day: null }],
    ['19870412', { year: 1987, month: 4, day: 12 }],
    [' 1987-04-12 ', { year: 1987, month: 4, day: 12 }],
  ])('reads %j', (value, parts) => {
    expect(parsePartialDate(value)).toEqual({
      ...parts,
      twoDigitYear: null,
      circa: false,
      range: null,
    });
  });

  it('reads an MRZ date, with < for an unknown part, as a two-digit year', () => {
    expect(parsePartialDate('870412')).toMatchObject({
      year: null,
      twoDigitYear: 87,
      month: 4,
      day: 12,
    });
    expect(parsePartialDate('87<<<<')).toMatchObject({ twoDigitYear: 87, month: null, day: null });
  });

  it.each(['circa 1950', 'c. 1950', 'ca. 1950', 'ca 1950', '~1950', 'approx. 1950'])(
    'reads %j as circa',
    (value) => {
      expect(parsePartialDate(value)).toMatchObject({ year: 1950, circa: true, range: null });
    },
  );

  it.each(['1955 to 1957', '1955-1957', '1955 – 1957', 'between 1955 and 1957'])(
    'reads %j as a range',
    (value) => {
      expect(parsePartialDate(value)).toMatchObject({
        year: null,
        range: { from: 1955, to: 1957 },
      });
    },
  );

  it.each([
    '',
    'yesterday',
    '1987-13-01',
    '1987-02-30',
    '1987-04-31',
    '1987-4-1',
    '0000-01-01',
    '1957 to 1955',
    `1987-04-12${'0'.repeat(100)}`,
  ])('refuses %j', (value) => {
    expect(parsePartialDate(value)).toBeNull();
  });

  it('accepts 29 February only in a leap year, and on any day-of-month when the year is unknown', () => {
    expect(parsePartialDate('2000-02-29')).not.toBeNull();
    expect(parsePartialDate('1900-02-29')).toBeNull();
    expect(parsePartialDate('000229')).toMatchObject({ month: 2, day: 29 });
  });
});

describe('matchPartialDates (C58.5)', () => {
  it('R1: equal full dates are full', () => {
    expect(match('1987-04-12', '1987-04-12')).toEqual({ level: 'full', methods: [], flags: [] });
  });

  it('no date, or an unreadable one, on either side is missing, never a mismatch', () => {
    expect(match('1987-04-12', null).level).toBe('missing');
    expect(match(undefined, '1987').level).toBe('missing');
    expect(match('1987-04-12', 'sometime')).toEqual({
      level: 'missing',
      methods: [],
      flags: ['unreadable'],
    });
  });

  it('R2: a record that knows only the year and month, or the year, is partial', () => {
    expect(match('1987-04-12', '1987-04')).toEqual({
      level: 'partial',
      methods: ['date_similarity'],
      flags: ['precision-limited'],
    });
    expect(match('1987', '1987-04-12').flags).toEqual(['precision-limited']);
    expect(match('1987-XX-12', '1987-04-12').level).toBe('partial');
  });

  it('R2 needs the year on both sides and every part both know to agree', () => {
    expect(match('XXXX-04-12', '1987-04-12').level).toBe('missing');
    expect(match('1987-05', '1987-04-12').level).toBe('none');
    expect(match('1990', '1987-04-12').level).toBe('none');
  });

  it('R3: a year inside a range, or within a year of a circa year, is partial', () => {
    expect(match('1956-07-01', '1955 to 1957')).toEqual({
      level: 'partial',
      methods: ['date_difference'],
      flags: ['approximate'],
    });
    expect(match('circa 1950', '1951-01-01').level).toBe('partial');
    expect(match('circa 1950', '1952-01-01').level).toBe('none');
    expect(match('1958-01-01', '1955 to 1957').level).toBe('none');
    expect(matchPartialDates('circa 1950', '1952', { today: TODAY, circaYears: 2 }).level).toBe(
      'partial',
    );
  });

  it('R4: day and month swapped is partial and flagged transposed', () => {
    expect(match('1987-04-12', '1987-12-04')).toEqual({
      level: 'partial',
      methods: ['date_similarity'],
      flags: ['transposed'],
    });
  });

  it('R4 needs both parts at most 12, different, and the same year', () => {
    expect(match('1987-04-13', '1987-13-04').level).toBe('missing'); // 13 is no month
    expect(match('1987-04-04', '1987-04-04').level).toBe('full');
    expect(match('1987-04-12', '1988-12-04').level).toBe('none');
  });

  it('R5: one part one digit off, or two adjacent digits swapped, is none and flagged near-match', () => {
    const nearMatch = { level: 'none', methods: ['string_difference'], flags: ['near-match'] };

    expect(match('1987-04-12', '1988-04-12')).toEqual(nearMatch);
    expect(match('1987-04-12', '1978-04-12')).toEqual(nearMatch);
    expect(match('1987-04-12', '1987-04-21')).toEqual(nearMatch);
    expect(match('1987-04-12', '1987-04-13')).toEqual(nearMatch);
    expect(match('1987-03-12', '1987-08-12')).toEqual(nearMatch);
    expect(match('1987-04-12', '1987-05')).toEqual(nearMatch);
  });

  it('two parts off, or one part off by more, is a plain none', () => {
    expect(match('1987-04-12', '1987-05-13')).toEqual({ level: 'none', methods: [], flags: [] });
    expect(match('1987-04-12', '1987-04-28')).toEqual({ level: 'none', methods: [], flags: [] });
    expect(match('1987-04-12', '1991-04-12')).toEqual({ level: 'none', methods: [], flags: [] });
  });

  it('R6: a two-digit year takes the century that gives an age of at most 120, the later when both do', () => {
    expect(match('870412', '1987-04-12')).toEqual({
      level: 'full',
      methods: [],
      flags: ['century-inferred'],
    });
    // 10 could be 1910 (age 116) or 2010 (age 16): the later wins, so 1910 does not match.
    expect(match('100101', '2010-01-01').level).toBe('full');
    expect(match('100101', '1910-01-01').level).toBe('none');
    // 30 cannot be 2030 (after today), so it is 1930.
    expect(match('300101', '1930-01-01').level).toBe('full');
    expect(match('87<<<<', '1987-04-12')).toEqual({
      level: 'partial',
      methods: ['date_similarity'],
      flags: ['century-inferred', 'precision-limited'],
    });
  });

  it('R6: the century must give a real date, so 00-02-29 is 2000 (1900 had no 29 February)', () => {
    expect(match('000229', '2000-02-29')).toEqual({
      level: 'full',
      methods: [],
      flags: ['century-inferred'],
    });
    // 26-12-31 would be after today in 2026, so it is 1926 (aged 99).
    expect(match('261231', '1926-12-31').level).toBe('full');
  });

  it('is symmetric', () => {
    const pairs: [string, string][] = [
      ['1987-04-12', '1987-12-04'],
      ['1987-04-12', '1987-04'],
      ['1956-07-01', '1955 to 1957'],
      ['1987-04-12', '1978-04-12'],
    ];
    for (const [a, b] of pairs) {
      expect(match(a, b)).toEqual(match(b, a));
    }
  });

  it('reads 100 KB of near-matching input in bounded time (C58.7)', () => {
    const long = `1987-04-12 ${'1987-04-12 '.repeat(9_000)}`;
    expect(
      cpuMilliseconds(() => {
        expect(match(long, '1987-04-12').level).toBe('missing');
      }),
    ).toBeLessThan(100);
  });
});
