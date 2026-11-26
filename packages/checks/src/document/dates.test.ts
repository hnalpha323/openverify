/**
 * C60.5: printed dates of supporting documents, with both readings of a numeric date whose day
 * and month could swap when the document's convention allows both orders.
 */
import { describe, expect, it } from 'vitest';
import {
  addCalendarMonths,
  documentDateOrders,
  readDocumentDate,
  readDocumentDateRange,
  sameDocumentDate,
} from './dates.js';

const BOTH = ['DMY', 'MDY'] as const;

describe('documentDateOrders', () => {
  it.each([
    ['en', 'US', ['MDY']],
    ['en', 'PH', ['MDY']],
    ['en', 'CA', ['DMY', 'MDY']],
    ['en', null, ['DMY', 'MDY']],
    ['en', 'GB', ['DMY']],
    ['es', 'US', ['DMY', 'MDY']],
    ['es', 'ES', ['DMY']],
    ['es', null, ['DMY']],
    ['fr', 'CA', ['DMY']],
    ['de', 'US', ['DMY']],
    [null, null, ['DMY', 'MDY']],
  ] as const)('%s with %s reads %j', (language, country, orders) => {
    expect(documentDateOrders(language, country)).toEqual(orders);
  });
});

describe('readDocumentDate', () => {
  it.each([
    ['30 September 2026', '2026-09-30'],
    ['Sep 30, 2026', '2026-09-30'],
    ['30.09.2026', '2026-09-30'],
    ['2026-09-30', '2026-09-30'],
    ['1 de marzo de 2026', '2026-03-01'],
    ['le 5 octobre 2026', '2026-10-05'],
    ['5. Oktober 2026', '2026-10-05'],
    ['on 30 Sep 2026 at the office', '2026-09-30'],
    ['30.09.2026 Account 123', '2026-09-30'],
    ['12/12/2026', '2026-12-12'],
    ['30/09/26', '2026-09-30'],
  ])('reads %s as one date', (text, iso) => {
    expect(readDocumentDate(text, BOTH)).toEqual({ readings: [iso] });
  });

  it('keeps both readings of a day and month that could swap, day first', () => {
    expect(readDocumentDate('03/04/2026', BOTH)).toEqual({
      readings: ['2026-04-03', '2026-03-04'],
    });
    expect(readDocumentDate('03/04/2026', ['DMY'])).toEqual({ readings: ['2026-04-03'] });
    expect(readDocumentDate('03/04/2026', ['MDY'])).toEqual({ readings: ['2026-03-04'] });
  });

  it.each(['no date here', 'Amount due: 48.20', 'Account number: 4471-2208-19', '18.4 m3', ''])(
    'reads no date in %j',
    (text) => {
      expect(readDocumentDate(text, BOTH)).toBeNull();
    },
  );
});

describe('readDocumentDateRange', () => {
  it.each([
    ['01 Jul 2026 - 30 Sep 2026', ['to'], '2026-07-01', '2026-09-30'],
    ['1 March 2026 to 28 February 2027', ['to'], '2026-03-01', '2027-02-28'],
    ['01/07/2026 al 30/09/2026', ['al', 'hasta', 'a'], '2026-07-01', '2026-09-30'],
    ['du 01/07/2026 au 30/09/2026', ['au'], '2026-07-01', '2026-09-30'],
    ['01.07.2026 bis 30.09.2026', ['bis'], '2026-07-01', '2026-09-30'],
    ['01/07/2026-30/09/2026', ['to'], '2026-07-01', '2026-09-30'],
  ] as const)('reads %s as a range', (text, words, start, end) => {
    expect(readDocumentDateRange(text, ['DMY'], words)).toEqual({
      start: { readings: [start] },
      end: { readings: [end] },
    });
  });

  it('needs a date on both sides', () => {
    expect(readDocumentDateRange('30 September 2026', ['DMY'], ['to'])).toBeNull();
    expect(
      readDocumentDateRange('un año a partir del 1 de marzo de 2026', ['DMY'], ['al', 'a']),
    ).toBeNull();
    expect(readDocumentDateRange('2026-07-01', ['DMY'], ['to'])).toBeNull();
  });
});

describe('sameDocumentDate', () => {
  it('compares readings', () => {
    expect(sameDocumentDate({ readings: ['2026-09-30'] }, { readings: ['2026-09-30'] })).toBe(true);
    expect(sameDocumentDate({ readings: ['2026-09-30'] }, { readings: ['2026-09-29'] })).toBe(
      false,
    );
    expect(
      sameDocumentDate({ readings: ['2026-04-03', '2026-03-04'] }, { readings: ['2026-04-03'] }),
    ).toBe(false);
  });
});

describe('addCalendarMonths', () => {
  it.each([
    [{ year: 2026, month: 1, day: 31 }, 1, { year: 2026, month: 2, day: 28 }],
    [{ year: 2026, month: 3, day: 1 }, 12, { year: 2027, month: 3, day: 1 }],
    [{ year: 2028, month: 1, day: 31 }, 1, { year: 2028, month: 2, day: 29 }],
    [{ year: 2026, month: 10, day: 23 }, -18, { year: 2025, month: 4, day: 23 }],
    [{ year: 2026, month: 12, day: 15 }, 2, { year: 2027, month: 2, day: 15 }],
  ])('%j plus %d months is %j', (date, months, expected) => {
    expect(addCalendarMonths(date, months)).toEqual(expected);
  });
});
