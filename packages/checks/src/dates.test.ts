import { describe, expect, it } from 'vitest';
import { ageOn, daysBetween, isoDateToMrz, parseIsoDate, utcToday } from './dates.js';

describe('parseIsoDate', () => {
  it.each([
    ['1974-08-12', { year: 1974, month: 8, day: 12 }],
    ['2000-02-29', { year: 2000, month: 2, day: 29 }],
    ['2024-02-29', { year: 2024, month: 2, day: 29 }],
    ['0099-12-31', { year: 99, month: 12, day: 31 }],
    [' 2030-01-01 ', { year: 2030, month: 1, day: 1 }],
  ])('parses %j', (input, expected) => {
    expect(parseIsoDate(input)).toEqual(expected);
  });

  it.each([
    '1900-02-29', // 1900 is not a leap year
    '2023-02-29',
    '2023-04-31',
    '2023-13-01',
    '2023-00-10',
    '2023-01-00',
    '0000-01-01',
    '2023-1-01',
    '12-08-1974',
    '1974/08/12',
    '1974-08-12T00:00:00Z',
    '',
    'not a date',
  ])('rejects %j', (input) => {
    expect(parseIsoDate(input)).toBeNull();
  });
});

describe('date arithmetic', () => {
  it('counts whole days between calendar dates, across leap days', () => {
    const from = { year: 2024, month: 2, day: 28 };
    expect(daysBetween(from, { year: 2024, month: 3, day: 1 })).toBe(2);
    expect(daysBetween({ year: 2024, month: 3, day: 1 }, from)).toBe(-2);
    expect(daysBetween(from, from)).toBe(0);
  });

  it('handles years below 100 without the two-digit-year quirk of Date.UTC', () => {
    expect(daysBetween({ year: 99, month: 12, day: 31 }, { year: 100, month: 1, day: 1 })).toBe(1);
  });

  it('takes today from the UTC calendar date of an instant', () => {
    expect(utcToday(new Date('2026-10-20T23:59:59.999Z'))).toEqual({
      year: 2026,
      month: 10,
      day: 20,
    });
    expect(utcToday(new Date('2026-10-20T23:30:00-05:00'))).toEqual({
      year: 2026,
      month: 10,
      day: 21,
    });
  });

  it.each([
    [{ year: 2000, month: 5, day: 15 }, { year: 2026, month: 5, day: 14 }, 25],
    [{ year: 2000, month: 5, day: 15 }, { year: 2026, month: 5, day: 15 }, 26],
    [{ year: 2000, month: 5, day: 15 }, { year: 2000, month: 5, day: 15 }, 0],
    // A 29 February birthday is reached on 1 March in non-leap years.
    [{ year: 2008, month: 2, day: 29 }, { year: 2026, month: 2, day: 28 }, 17],
    [{ year: 2008, month: 2, day: 29 }, { year: 2026, month: 3, day: 1 }, 18],
    [{ year: 2030, month: 1, day: 1 }, { year: 2026, month: 1, day: 1 }, -4],
  ])('computes the age of someone born %j on %j', (birth, on, age) => {
    expect(ageOn(birth, on)).toBe(age);
  });
});

describe('isoDateToMrz', () => {
  it('formats a calendar date as YYMMDD', () => {
    expect(isoDateToMrz('1974-08-12')).toBe('740812');
    expect(isoDateToMrz('2012-04-15')).toBe('120415');
  });

  it('returns null for an invalid date', () => {
    expect(isoDateToMrz('2023-02-30')).toBeNull();
  });
});
