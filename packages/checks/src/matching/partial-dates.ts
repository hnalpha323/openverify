/**
 * Partial dates of birth (C58.5; rules R1-R6 of `docs/research/phase5-libraries.md` §2.4, ours).
 * A date may lack its day or month (`1980`, `1980-05`, `1980-XX-XX`, `1980-00-00`), carry a
 * two-digit year (an MRZ `YYMMDD`, `<` for an unknown part), be approximate (`circa 1980`) or a
 * range (`1955 to 1957`). Only the Gregorian calendar is read. No date on either side, or one
 * that cannot be read, is `missing`: no evidence, never a mismatch.
 *
 * | Rule | When | Level, flag |
 * |---|---|---|
 * | R1 exact | year, month and day known on both and equal | `full` |
 * | R2 precision-limited | every part known on both is equal, the year on both, one side less precise | `partial`, `precision-limited` |
 * | R3 range or circa | the years overlap (circa ± 1 year by default) | `partial`, `approximate` |
 * | R4 transposition | same year, day and month swapped, both at most 12 and different | `partial`, `transposed` |
 * | R5 typo | one part differs by one digit or two swapped adjacent digits | `none`, `near-match` |
 * | R6 two-digit year | the century giving a date not after today and an age of at most 120, the later when both do | as R1 or R2, `century-inferred` |
 *
 * R5 is stricter than the public two-of-three rule (C50.9): a one-digit slip is a mismatch.
 */
import { ageOn, daysBetween, parseIsoDate, utcToday, type CalendarDate } from '../dates.js';
import { presentText } from '../result.js';
import { fieldMatch, type FieldMatch, type MatchMethod } from './levels.js';

/** A date of birth is short; anything longer is not one of the forms read here (C58.7). */
const MAX_DATE_LENGTH = 64;

/** A date as read: any part may be unknown; a two-digit year has no century yet. */
export interface PartialDate {
  /** The four-digit year, `null` when unknown or known only by its last two digits. */
  readonly year: number | null;
  /** The last two digits of a year whose century is not printed (R6), else `null`. */
  readonly twoDigitYear: number | null;
  readonly month: number | null;
  readonly day: number | null;
  /** `circa YYYY`: the year is approximate. */
  readonly circa: boolean;
  /** `YYYY to YYYY`: the year lies in this closed range. */
  readonly range: { readonly from: number; readonly to: number } | null;
}

export interface PartialDateMatchOptions {
  /** The day R6 reads ages against; today in UTC by default. */
  readonly today?: CalendarDate | undefined;
  /** How many years either side of a circa year R3 accepts; 1 by default. */
  readonly circaYears?: number | undefined;
}

// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const ISO_DATE = /^(\d{4}|x{4})(?:-(\d{2}|x{2})(?:-(\d{2}|x{2}))?)?$/i;
const COMPACT_DATE = /^(\d{4})(\d{2})(\d{2})$/;
const MRZ_DATE = /^(\d{2}|<<)(\d{2}|<<)(\d{2}|<<)$/;
const CIRCA_DATE = /^(?:circa|approx\.?|ca\.?|c\.?|~)\s*(\d{4})$/i;
const RANGE_DATE = /^(\d{4})\s*(?:[-–—]|to)\s*(\d{4})$/i;
const BETWEEN_DATE = /^between\s+(\d{4})\s+and\s+(\d{4})$/i;

/** A part as printed: digits, or `XX`, `00` and `<<` for unknown. */
function part(text: string | undefined): number | null {
  if (text === undefined || !/^\d+$/.test(text)) {
    return null;
  }
  const value = Number(text);
  return value === 0 ? null : value;
}

const UNKNOWN_PARTS = { twoDigitYear: null, circa: false, range: null } as const;

/** Month 1-12 and a day that month can have (in that year when the year is known). */
function plausible(year: number | null, month: number | null, day: number | null): boolean {
  if (month !== null && (month < 1 || month > 12)) {
    return false;
  }
  if (day === null) {
    return true;
  }
  if (day > 31) {
    return false;
  }
  if (month === null) {
    return true;
  }
  // A year that is unknown, or known only by two digits, may be a leap year.
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    parseIsoDate(`${String(year ?? 2000).padStart(4, '0')}-${pad(month)}-${pad(day)}`) !== null
  );
}

function dated(year: number | null, month: number | null, day: number | null): PartialDate | null {
  if (year !== null && (year < 1 || year > 9999)) {
    return null;
  }
  return plausible(year, month, day) ? { year, month, day, ...UNKNOWN_PARTS } : null;
}

/** Reads a date in one of the forms above; `null` when it is none of them. */
export function parsePartialDate(value: string): PartialDate | null {
  const text = value.trim();
  if (text === '' || text.length > MAX_DATE_LENGTH) {
    return null;
  }
  const iso = ISO_DATE.exec(text) ?? COMPACT_DATE.exec(text);
  if (iso !== null) {
    const year = part(iso[1]);
    return year === null && /^\d/.test(iso[1] ?? '')
      ? null
      : dated(year, part(iso[2]), part(iso[3]));
  }
  const mrz = MRZ_DATE.exec(text);
  if (mrz !== null) {
    const twoDigitYear = mrz[1] === '<<' ? null : Number(mrz[1]);
    const month = part(mrz[2]);
    const day = part(mrz[3]);
    return plausible(null, month, day)
      ? { year: null, month, day, ...UNKNOWN_PARTS, twoDigitYear }
      : null;
  }
  const circa = CIRCA_DATE.exec(text);
  if (circa !== null) {
    const year = part(circa[1]);
    return year === null ? null : { ...UNKNOWN_PARTS, year, month: null, day: null, circa: true };
  }
  const range = RANGE_DATE.exec(text) ?? BETWEEN_DATE.exec(text);
  if (range !== null) {
    const from = part(range[1]);
    const to = part(range[2]);
    return from === null || to === null || from > to
      ? null
      : { ...UNKNOWN_PARTS, year: null, month: null, day: null, range: { from, to } };
  }
  return null;
}

/** The earliest day a partial date can be, its unknown parts taken as the first. */
const earliest = (year: number, date: PartialDate): CalendarDate => ({
  year,
  month: date.month ?? 1,
  day: date.day ?? 1,
});

/**
 * R6: the four-digit year of a two-digit one, from this century or the last: a real date, not
 * after `today`, at most 120 years before it; the later when both qualify. `null` when neither.
 */
function resolveCentury(
  date: PartialDate,
  today: CalendarDate,
): { date: PartialDate; inferred: boolean } | null {
  if (date.twoDigitYear === null) {
    return { date, inferred: false };
  }
  const century = today.year - (today.year % 100);
  for (const year of [century + date.twoDigitYear, century - 100 + date.twoDigitYear]) {
    const birth = earliest(year, date);
    if (
      plausible(year, date.month, date.day) &&
      daysBetween(birth, today) >= 0 &&
      ageOn(birth, today) <= 120
    ) {
      return { date: { ...date, year, twoDigitYear: null }, inferred: true };
    }
  }
  return null;
}

/** R3: the years a date can be, or `null` when its year is unknown. */
function yearInterval(date: PartialDate, circaYears: number): readonly [number, number] | null {
  if (date.range !== null) {
    return [date.range.from, date.range.to];
  }
  if (date.year === null) {
    return null;
  }
  return date.circa ? [date.year - circaYears, date.year + circaYears] : [date.year, date.year];
}

/** R5: two zero-padded values one digit apart, or two adjacent digits swapped. */
function oneDigitSlip(a: number, b: number, width: number): boolean {
  const left = String(a).padStart(width, '0');
  const right = String(b).padStart(width, '0');
  const differing: number[] = [];
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      differing.push(index);
    }
  }
  if (differing.length === 1) {
    return true;
  }
  const [first, second] = differing;
  return (
    differing.length === 2 &&
    first !== undefined &&
    second === first + 1 &&
    left[first] === right[second] &&
    left[second] === right[first]
  );
}

/** Compares two dates of birth by rules R1-R6. */
export function matchPartialDates(
  a: string | null | undefined,
  b: string | null | undefined,
  options: PartialDateMatchOptions = {},
): FieldMatch {
  const left = presentText(a);
  const right = presentText(b);
  if (left === null || right === null) {
    return fieldMatch('missing');
  }
  const today = options.today ?? utcToday(new Date());
  const parsedLeft = parsePartialDate(left);
  const parsedRight = parsePartialDate(right);
  const resolvedLeft = parsedLeft === null ? null : resolveCentury(parsedLeft, today);
  const resolvedRight = parsedRight === null ? null : resolveCentury(parsedRight, today);
  if (resolvedLeft === null || resolvedRight === null) {
    return fieldMatch('missing', [], ['unreadable']);
  }
  const flags = resolvedLeft.inferred || resolvedRight.inferred ? ['century-inferred'] : [];
  const result = (level: FieldMatch['level'], methods: MatchMethod[] = [], flag?: string) =>
    fieldMatch(level, methods, flag === undefined ? flags : [...flags, flag]);
  const x = resolvedLeft.date;
  const y = resolvedRight.date;

  if (x.circa || x.range !== null || y.circa || y.range !== null) {
    const circaYears = options.circaYears ?? 1;
    const left = yearInterval(x, circaYears);
    const right = yearInterval(y, circaYears);
    if (left === null || right === null) {
      return result('missing');
    }
    return left[0] <= right[1] && right[0] <= left[1]
      ? result('partial', ['date_difference'], 'approximate')
      : result('none');
  }
  if (x.year === null || y.year === null) {
    return result('missing');
  }
  const parts = [
    [x.year, y.year, 4],
    [x.month, y.month, 2],
    [x.day, y.day, 2],
  ] as const;
  const known = parts.filter(
    (entry): entry is readonly [number, number, 4 | 2] => entry[0] !== null && entry[1] !== null,
  );
  const differing = known.filter(([left, right]) => left !== right);
  if (differing.length === 0) {
    return known.length === parts.length
      ? result('full')
      : result('partial', ['date_similarity'], 'precision-limited');
  }
  if (
    known.length === parts.length &&
    x.year === y.year &&
    x.month === y.day &&
    x.day === y.month &&
    x.month !== x.day
  ) {
    return result('partial', ['date_similarity'], 'transposed');
  }
  const [slip] = differing;
  return differing.length === 1 && slip !== undefined && oneDigitSlip(...slip)
    ? result('none', ['string_difference'], 'near-match')
    : result('none');
}
