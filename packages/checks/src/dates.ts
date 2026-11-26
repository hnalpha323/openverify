/** A calendar date with no time zone, as printed on identity documents. */
export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

const MS_PER_DAY = 86_400_000;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Parses a strict `YYYY-MM-DD` calendar date (year 0001-9999); `null` if invalid. */
export function parseIsoDate(value: string): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return null;
  }
  return { year, month, day };
}

/** Days since 1970-01-01. Uses setUTCFullYear because Date.UTC maps years 0-99 to 1900-1999. */
function dayNumber({ year, month, day }: CalendarDate): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return Math.round(date.getTime() / MS_PER_DAY);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  return dayNumber(to) - dayNumber(from);
}

/** The UTC calendar date of an instant. */
export function utcToday(now: Date): CalendarDate {
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() };
}

/**
 * Age in completed years on `on`. A 29 February birthday counts as reached on
 * 1 March in non-leap years.
 */
export function ageOn(birth: CalendarDate, on: CalendarDate): number {
  const birthdayPassed =
    on.month > birth.month || (on.month === birth.month && on.day >= birth.day);
  return on.year - birth.year - (birthdayPassed ? 0 : 1);
}

/** Formats a `YYYY-MM-DD` date as an MRZ `YYMMDD` date; `null` if invalid. */
export function isoDateToMrz(value: string): string | null {
  const date = parseIsoDate(value);
  if (!date) {
    return null;
  }
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(date.year % 100)}${pad(date.month)}${pad(date.day)}`;
}
