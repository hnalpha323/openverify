/**
 * Printed dates on a supporting document (C60.5, C60.6). A date is read as `parseVizDate` reads
 * an identity document's (numeric, or with an English, Spanish, French or German month name). A
 * numeric date whose day and month could swap keeps both readings when the document's convention
 * allows both orders, so recency can refuse to guess: two readings that disagree on the outcome
 * answer `input_missing` (C60.5).
 *
 * | Language | Country of the reference address | Orders read |
 * |---|---|---|
 * | English | US or PH | month first |
 * | English | CA, or none known | both |
 * | English | any other | day first |
 * | Spanish | US | both |
 * | Spanish | any other | day first |
 * | French, German | any | day first |
 *
 * The orders are ours (each language's written convention), provisional.
 */
import type { CalendarDate } from '../dates.js';
import { parseVizDate, type DateOrder } from '../viz.js';
import type { DocumentLanguage } from './lexicons/types.js';
import { trimTrailingCharacters } from './text.js';

/** A printed date: one ISO `YYYY-MM-DD` reading, or two when day and month could swap. */
export interface DocumentDate {
  readonly readings: readonly string[];
}

const BOTH: readonly DateOrder[] = Object.freeze(['DMY', 'MDY']);
const DAY_FIRST: readonly DateOrder[] = Object.freeze(['DMY']);
const MONTH_FIRST: readonly DateOrder[] = Object.freeze(['MDY']);
/** English-language countries that write the month first (ours, from their convention). */
const MONTH_FIRST_COUNTRIES: ReadonlySet<string> = new Set(['US', 'PH']);
/** Countries that write English dates both ways. */
const MIXED_COUNTRIES: ReadonlySet<string> = new Set(['CA']);

/** The orders a numeric date of this document is read in. */
export function documentDateOrders(
  language: DocumentLanguage | null,
  country: string | null,
): readonly DateOrder[] {
  switch (language) {
    case 'en':
      if (country === null || MIXED_COUNTRIES.has(country)) {
        return BOTH;
      }
      return MONTH_FIRST_COUNTRIES.has(country) ? MONTH_FIRST : DAY_FIRST;
    case 'es':
      return country === 'US' ? BOTH : DAY_FIRST;
    case 'fr':
    case 'de':
      return DAY_FIRST;
    case null:
      return BOTH;
  }
}

/** Words a printed date may carry between its parts ("1 de marzo de 2026", "le 5 octobre"). */
const FILLERS: ReadonlySet<string> = new Set([
  'de',
  'del',
  'of',
  'the',
  'on',
  'du',
  'le',
  'el',
  'en',
  'a',
  'am',
  'den',
  'der',
  'vom',
]);
/** The longest run of words a date is read from. */
const WINDOW = 3;
/** The first words of a text a date may start at. */
const STARTS = 8;
const TWO_DIGIT_YEAR = /^(\d{1,2})([./-])(\d{1,2})\2(\d{2})$/;
const DASHES = new Set(['-', '–', '—']);

/** The words of a text, without trailing punctuation or fillers. */
function wordsOf(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((word) => trimTrailingCharacters(word, '.:').replace(/^[(:]+/, ''))
    .filter((word) => word !== '' && !FILLERS.has(word.toLowerCase()));
}

/** `30/09/26` as `30/09/2026`: two-digit years of supporting documents are this century's. */
function fullYear(window: string): string {
  const match = TWO_DIGIT_YEAR.exec(window);
  return match === null
    ? window
    : `${match[1] ?? ''}${match[2] ?? ''}${match[3] ?? ''}${match[2] ?? ''}20${match[4] ?? ''}`;
}

function readingsOf(window: string, orders: readonly DateOrder[]): string[] {
  const text = fullYear(window);
  return [
    ...new Set(
      orders.flatMap((order) => {
        const iso = parseVizDate(text, order);
        return iso === null ? [] : [iso];
      }),
    ),
  ];
}

/** The first date printed in `text`, in each of `orders`; `null` when none is. */
export function readDocumentDate(text: string, orders: readonly DateOrder[]): DocumentDate | null {
  const words = wordsOf(text);
  for (let start = 0; start < Math.min(words.length, STARTS); start += 1) {
    for (let length = Math.min(WINDOW, words.length - start); length >= 1; length -= 1) {
      const readings = readingsOf(words.slice(start, start + length).join(' '), orders);
      if (readings.length > 0) {
        return { readings };
      }
    }
  }
  return null;
}

/** A range in one word: `01/07/2026-30/09/2026`. */
function rangeInWord(
  word: string,
  orders: readonly DateOrder[],
): { readonly start: DocumentDate; readonly end: DocumentDate } | null {
  for (let at = 1; at < word.length - 1; at += 1) {
    if (DASHES.has(word.charAt(at))) {
      const start = readDocumentDate(word.slice(0, at), orders);
      const end = readDocumentDate(word.slice(at + 1), orders);
      if (start !== null && end !== null) {
        return { start, end };
      }
    }
  }
  return null;
}

/**
 * A range of two dates (`01 Jul 2026 - 30 Sep 2026`, `1 March 2026 to 28 February 2027`), split on
 * a dash between spaces or one of `rangeWords`; `null` unless both sides hold a date.
 */
export function readDocumentDateRange(
  text: string,
  orders: readonly DateOrder[],
  rangeWords: readonly string[],
): { readonly start: DocumentDate; readonly end: DocumentDate } | null {
  const words = text.split(/\s+/).filter(Boolean);
  const separators = new Set([...DASHES, ...rangeWords.map((word) => word.toLowerCase())]);
  for (let at = 1; at < words.length - 1; at += 1) {
    if (separators.has((words[at] ?? '').toLowerCase())) {
      const start = readDocumentDate(words.slice(0, at).join(' '), orders);
      const end = readDocumentDate(words.slice(at + 1).join(' '), orders);
      if (start !== null && end !== null) {
        return { start, end };
      }
    }
  }
  for (const word of words) {
    const range = rangeInWord(word, orders);
    if (range !== null) {
      return range;
    }
  }
  return null;
}

/** Whether two printed dates have the same readings. */
export function sameDocumentDate(a: DocumentDate, b: DocumentDate): boolean {
  return (
    a.readings.length === b.readings.length &&
    a.readings.every((reading, index) => reading === b.readings[index])
  );
}

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** A calendar date `months` later (earlier when negative), the day clamped to the month's end. */
export function addCalendarMonths(date: CalendarDate, months: number): CalendarDate {
  const index = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  return { year, month, day: Math.min(date.day, daysIn(year, month)) };
}
