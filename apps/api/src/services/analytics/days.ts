/**
 * C163.2, C163.4 (Workflow 9B, `api-analytics`): local days in an environment's reporting zone.
 * A local day is a date `YYYY-MM-DD`; the database computes the day of a timestamp with
 * `(ts at time zone zone)::date` (the date of `date_trunc('day', ts, zone)`), so a 23- or 25-hour
 * day is right. Here, the day of an instant the API already holds (the clock's now, the watermark),
 * through `Intl`, which reads the same tz database names (`analyticsTimeZoneSchema`).
 */

const DAY_MS = 86_400_000;
const LOCAL_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterOf(zone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(zone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatters.set(zone, formatter);
  }
  return formatter;
}

/** The local day of `instant` in `zone`. */
export function localDayOf(instant: Date, zone: string): string {
  const parts = formatterOf(zone).formatToParts(instant);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function dayNumber(day: string): number {
  if (!LOCAL_DATE.test(day)) {
    throw new RangeError('a local day is YYYY-MM-DD');
  }
  return Date.parse(`${day}T00:00:00Z`) / DAY_MS;
}

const dateOf = (number: number) => new Date(number * DAY_MS).toISOString().slice(0, 10);

/** `day` moved by `count` days (negative: earlier). */
export function addDays(day: string, count: number): string {
  return dateOf(dayNumber(day) + count);
}

/** The days from `from` to `to`, both included, in order (none when `to` is before `from`). */
export function daysFrom(from: string, to: string): string[] {
  const days: string[] = [];
  for (let number = dayNumber(from); number <= dayNumber(to); number += 1) {
    days.push(dateOf(number));
  }
  return days;
}

/** The later of two local days. */
export const laterDay = (left: string, right: string): string => (left > right ? left : right);

/**
 * The first day kept by a retention of `months` months before `day` (the same day of the month,
 * or the month's last day when it has fewer days).
 */
export function monthsBefore(day: string, months: number): string {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number);
  const total = year * 12 + (month - 1) - months;
  const targetYear = Math.floor(total / 12);
  const targetMonth = total - targetYear * 12;
  const lastDate = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return dateOf(Date.UTC(targetYear, targetMonth, Math.min(date, lastDate)) / DAY_MS);
}
