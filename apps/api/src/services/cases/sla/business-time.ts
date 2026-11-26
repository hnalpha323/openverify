/**
 * Business time (plan C133.3; decision 56; F30): elapsed time inside a calendar's business hours, on
 * `temporal-polyfill`. It lives in the API, never in `packages/core`, so the polyfill never enters the
 * flow's or the console's module graph.
 *
 * Instants in, instants out: a deadline is stored as an instant, and a calendar's local wall-clock
 * intervals are turned into instants day by day in its zone. A local time is resolved the way
 * Temporal resolves it (`compatible` for deadlines: a skipped time moves forward by the gap, a
 * repeated one takes its first occurrence; `reject` to validate a calendar), but from the zone's
 * transitions, which Temporal lists once per computation: a conversion through Temporal costs about
 * 65 µs here, and a scan of ten years makes thousands. A differential test holds the two to the same
 * answers.
 *
 * Business time is elapsed time: a transition inside business hours counts the real time between
 * the two boundaries, so a 24-hour desk's spring day has 23 hours.
 */
import { CASE_LIMITS, CASE_WEEKDAYS, type CaseWeekday } from '@openverify/core';
import { Temporal } from 'temporal-polyfill';

/** A calendar as `api-queues-sla` reads it from its row (C133.2); labels play no part here. */
export interface BusinessCalendar {
  readonly timeZone: string;
  readonly week: Readonly<Record<CaseWeekday, readonly { start: string; end: string }[]>>;
  readonly holidays: readonly { readonly date: string }[];
  readonly closures: readonly { readonly start: string; readonly end: string }[];
}

/** `null` is the `24x7` calendar of C133.1: every millisecond is business time. */
export type BusinessCalendarOrAllHours = BusinessCalendar | null;

export const BUSINESS_TIME_ERROR_CODES = [
  'business_time_scan_exceeded',
  'business_time_zone_unknown',
  'business_time_invalid',
] as const;
export type BusinessTimeErrorCode = (typeof BUSINESS_TIME_ERROR_CODES)[number];

/** A computation that cannot answer. It quotes nothing of the calendar. */
export class BusinessTimeError extends Error {
  override readonly name = 'BusinessTimeError';

  constructor(readonly code: BusinessTimeErrorCode) {
    super(code);
  }
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const DAY_MINUTES = 1440;
/** C133.3: no scan reads more days than this, so a calendar with no time left cannot loop. */
const SCAN_DAYS = CASE_LIMITS['business-time-scan-days'].value;
/** C133.3: a calendar is validated over the next two years. */
const VALIDATION_DAYS = CASE_LIMITS['calendar-validation-days'].value;
/** Before the first instant a computation reads, so every local time it resolves is covered. */
const ORIGIN_MARGIN_MS = 5 * DAY_MS;

const TIME = /^(\d{2}):(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

type Fold = 'gap' | 'repeat' | null;

/** A zone's offsets, read from Temporal's transitions as a computation moves forward. */
class ZoneOffsets {
  private readonly transitions: { readonly at: number; readonly offset: number }[] = [];
  private readonly baseOffset: number;
  private cursor: Temporal.ZonedDateTime | null;

  private constructor(
    readonly timeZone: string,
    private readonly origin: number,
    start: Temporal.ZonedDateTime,
  ) {
    this.baseOffset = start.offsetNanoseconds / 1_000_000;
    this.cursor = start;
  }

  /** @throws {BusinessTimeError} `business_time_zone_unknown` when the runtime does not know it. */
  static of(timeZone: string, origin: number): ZoneOffsets {
    let start: Temporal.ZonedDateTime;
    try {
      start = Temporal.Instant.fromEpochMilliseconds(origin).toZonedDateTimeISO(timeZone);
    } catch {
      throw new BusinessTimeError('business_time_zone_unknown');
    }
    return new ZoneOffsets(timeZone, origin, start);
  }

  /** The zone's UTC offset at an instant, in milliseconds. */
  offsetAt(instant: number): number {
    if (instant < this.origin) {
      // Before what this computation read: ask Temporal directly (closures can start long before).
      return (
        Temporal.Instant.fromEpochMilliseconds(instant).toZonedDateTimeISO(this.timeZone)
          .offsetNanoseconds / 1_000_000
      );
    }
    while (this.cursor !== null && this.cursor.epochMilliseconds <= instant) {
      const next = this.cursor.getTimeZoneTransition('next');
      if (next !== null) {
        this.transitions.push({
          at: next.epochMilliseconds,
          offset: next.offsetNanoseconds / 1_000_000,
        });
      }
      this.cursor = next;
    }
    let low = 0;
    let high = this.transitions.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((this.transitions[middle]?.at ?? Number.POSITIVE_INFINITY) <= instant) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return low === 0 ? this.baseOffset : (this.transitions[low - 1]?.offset ?? this.baseOffset);
  }

  /**
   * A local wall time (milliseconds as if it were UTC) resolved as Temporal resolves it: the instants
   * whose offset reads that wall time, from the offsets a day before and after (no zone changes twice
   * within a day). None is a gap, and `compatible` shifts by the gap; two is a repeat, and
   * `compatible` takes the earlier.
   */
  resolve(wall: number): { readonly instant: number; readonly fold: Fold } {
    const before = this.offsetAt(wall - DAY_MS);
    const after = this.offsetAt(wall + DAY_MS);
    const candidates = [...new Set([wall - before, wall - after])]
      .filter((instant) => wall - this.offsetAt(instant) === instant)
      .sort((a, b) => a - b);
    const [first] = candidates;
    if (first === undefined) {
      return { instant: wall - before, fold: 'gap' };
    }
    return { instant: first, fold: candidates.length > 1 ? 'repeat' : null };
  }

  /** The local date, in days since 1970-01-01, of an instant. */
  dayOf(instant: number): number {
    return Math.floor((instant + this.offsetAt(instant)) / DAY_MS);
  }
}

/** ISO weekday index, Monday first: 1970-01-01 was a Thursday. */
const weekdayOf = (day: number): CaseWeekday =>
  CASE_WEEKDAYS[(((day + 3) % 7) + 7) % 7] ?? 'monday';

const dateText = (day: number): string => new Date(day * DAY_MS).toISOString().slice(0, 10);

function minutesOf(time: string, allowDayEnd: boolean): number {
  const match = TIME.exec(time);
  const hours = Number(match?.[1]);
  const minutes = Number(match?.[2]);
  const total = hours * 60 + minutes;
  if (
    match === null ||
    minutes > 59 ||
    total > DAY_MINUTES ||
    (total === DAY_MINUTES && !allowDayEnd)
  ) {
    throw new BusinessTimeError('business_time_invalid');
  }
  return total;
}

/** A local `YYYY-MM-DDTHH:MM` as wall milliseconds. */
function wallOf(local: string): number {
  const match = DATE_TIME.exec(local);
  if (match === null) {
    throw new BusinessTimeError('business_time_invalid');
  }
  const [year, month, day, hours, minutes] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const wall = Date.UTC(year, month - 1, day, hours, minutes);
  const check = new Date(wall);
  if (
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    hours > 23 ||
    minutes > 59
  ) {
    throw new BusinessTimeError('business_time_invalid');
  }
  return wall;
}

/** A calendar read once per computation: minutes per weekday, holiday dates, closures as wall time. */
interface Prepared {
  readonly zone: ZoneOffsets;
  readonly week: Readonly<Record<CaseWeekday, readonly (readonly [number, number])[]>>;
  readonly holidays: ReadonlySet<string>;
  readonly closures: readonly (readonly [number, number])[];
}

function prepare(calendar: BusinessCalendar, origin: number): Prepared {
  const week = Object.fromEntries(
    CASE_WEEKDAYS.map((day) => [
      day,
      calendar.week[day].map(
        ({ start, end }) => [minutesOf(start, false), minutesOf(end, true)] as const,
      ),
    ]),
  ) as Record<CaseWeekday, (readonly [number, number])[]>;
  return {
    zone: ZoneOffsets.of(calendar.timeZone, origin - ORIGIN_MARGIN_MS),
    week,
    holidays: new Set(calendar.holidays.map(({ date }) => date)),
    closures: calendar.closures.map(({ start, end }) => [wallOf(start), wallOf(end)] as const),
  };
}

/** `[start, end)` instants, sorted, merged where they touch or overlap. */
function merged(intervals: (readonly [number, number])[]): (readonly [number, number])[] {
  const sorted = intervals.filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0]);
  const result: [number, number][] = [];
  for (const [start, end] of sorted) {
    const last = result.at(-1);
    if (last !== undefined && start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      result.push([start, end]);
    }
  }
  return result;
}

/** `intervals` with `[start, end)` cut out of each. */
function without(
  intervals: readonly (readonly [number, number])[],
  [start, end]: readonly [number, number],
): (readonly [number, number])[] {
  return intervals.flatMap(([from, to]): (readonly [number, number])[] => {
    if (end <= from || start >= to) {
      return [[from, to]];
    }
    return [
      ...(start > from ? [[from, start] as const] : []),
      ...(end < to ? [[end, to] as const] : []),
    ];
  });
}

/** The business intervals of one local day, as instants: none on a holiday, closures cut out. */
function intervalsOn(calendar: Prepared, day: number): readonly (readonly [number, number])[] {
  if (calendar.holidays.has(dateText(day))) {
    return [];
  }
  const midnight = day * DAY_MS;
  let intervals = merged(
    calendar.week[weekdayOf(day)].map(
      ([start, end]) =>
        [
          calendar.zone.resolve(midnight + start * MINUTE_MS).instant,
          calendar.zone.resolve(midnight + end * MINUTE_MS).instant,
        ] as const,
    ),
  );
  for (const [start, end] of calendar.closures) {
    // Only a closure that can touch this day, read with a day's margin either side.
    if (start < midnight + 2 * DAY_MS && end > midnight - DAY_MS) {
      const from = Math.max(start, midnight - DAY_MS);
      const to = Math.min(end, midnight + 2 * DAY_MS);
      intervals = without(intervals, [
        calendar.zone.resolve(from).instant,
        calendar.zone.resolve(to).instant,
      ]);
    }
  }
  return intervals;
}

function instantOf(date: Date): number {
  const value = date.getTime();
  if (!Number.isFinite(value)) {
    throw new BusinessTimeError('business_time_invalid');
  }
  return value;
}

/**
 * The instant at which `ms` of business time has passed since `start` (C133.3): the first instant at
 * which the business time since `start` reaches `ms`, so it may be the end of an interval. No time
 * at all answers `start`, wherever it falls.
 * @throws {BusinessTimeError} `business_time_invalid` for a negative or unending `ms` or an invalid
 * date; `business_time_zone_unknown`; `business_time_scan_exceeded` when 3,660 days hold too little.
 */
export function addBusinessTime(
  start: Date,
  ms: number,
  calendar: BusinessCalendarOrAllHours,
): Date {
  const from = instantOf(start);
  if (!Number.isFinite(ms) || ms < 0) {
    throw new BusinessTimeError('business_time_invalid');
  }
  if (calendar === null || ms === 0) {
    return new Date(from + ms);
  }
  const prepared = prepare(calendar, from);
  let cursor = from;
  let remaining = ms;
  const first = prepared.zone.dayOf(from) - 1;
  for (let day = first; day <= first + SCAN_DAYS; day += 1) {
    for (const [intervalStart, intervalEnd] of intervalsOn(prepared, day)) {
      if (intervalEnd <= cursor) {
        continue;
      }
      const begin = Math.max(intervalStart, cursor);
      if (remaining <= intervalEnd - begin) {
        return new Date(begin + remaining);
      }
      remaining -= intervalEnd - begin;
      cursor = intervalEnd;
    }
  }
  throw new BusinessTimeError('business_time_scan_exceeded');
}

/**
 * The business time, in milliseconds, between `a` and `b` (C133.3); `0` when `b` is not after `a`.
 * @throws {BusinessTimeError} as `addBusinessTime`, and `business_time_scan_exceeded` when the two
 * are more than 3,660 local days apart on a calendar.
 */
export function businessTimeBetween(
  a: Date,
  b: Date,
  calendar: BusinessCalendarOrAllHours,
): number {
  const from = instantOf(a);
  const to = instantOf(b);
  if (to <= from) {
    return 0;
  }
  if (calendar === null) {
    return to - from;
  }
  const prepared = prepare(calendar, from);
  const first = prepared.zone.dayOf(from) - 1;
  const last = prepared.zone.dayOf(to);
  if (last - first > SCAN_DAYS) {
    throw new BusinessTimeError('business_time_scan_exceeded');
  }
  let total = 0;
  let cursor = from;
  for (let day = first; day <= last; day += 1) {
    for (const [intervalStart, intervalEnd] of intervalsOn(prepared, day)) {
      const begin = Math.max(intervalStart, cursor);
      const end = Math.min(intervalEnd, to);
      if (end > begin) {
        total += end - begin;
        cursor = end;
      }
    }
  }
  return total;
}

/** Why a calendar cannot be saved (C133.2, C133.3): `calendar_invalid` names these dates. */
export interface CalendarProblem {
  readonly reason: 'time-zone-unknown' | 'boundary-in-gap' | 'boundary-repeated';
  /** Local dates, `YYYY-MM-DD`, sorted; empty for an unknown zone. */
  readonly dates: readonly string[];
}

/**
 * C133.3: the zone must be known to the runtime, and no boundary of the next two years (from `now`'s
 * local date) may fall in a gap or a repeat, read with `disambiguation: 'reject'`. An interval that
 * ends at `24:00` has its boundary at the next day's `00:00`, which is the case that exposes a zone
 * changing at midnight. A holiday has no boundary; a closure is read when it reaches into the two
 * years, and named by the date of the boundary at fault.
 * @throws {BusinessTimeError} `business_time_invalid` for a time or date that is not one.
 */
export function calendarProblems(calendar: BusinessCalendar, now: Date): CalendarProblem[] {
  const from = instantOf(now);
  let prepared: Prepared;
  try {
    prepared = prepare(calendar, from);
  } catch (error) {
    if (error instanceof BusinessTimeError && error.code === 'business_time_zone_unknown') {
      return [{ reason: 'time-zone-unknown', dates: [] }];
    }
    throw error;
  }
  const gaps = new Set<string>();
  const repeats = new Set<string>();
  const check = (wall: number): void => {
    const { fold } = prepared.zone.resolve(wall);
    if (fold !== null) {
      (fold === 'gap' ? gaps : repeats).add(dateText(Math.floor(wall / DAY_MS)));
    }
  };
  const first = prepared.zone.dayOf(from);
  const last = first + VALIDATION_DAYS - 1;
  for (let day = first; day <= last; day += 1) {
    if (!prepared.holidays.has(dateText(day))) {
      for (const [start, end] of prepared.week[weekdayOf(day)]) {
        check(day * DAY_MS + start * MINUTE_MS);
        check(day * DAY_MS + end * MINUTE_MS);
      }
    }
  }
  for (const [start, end] of prepared.closures) {
    if (end >= first * DAY_MS && start < (last + 1) * DAY_MS) {
      check(start);
      check(end);
    }
  }
  const problems: CalendarProblem[] = [];
  if (gaps.size > 0) {
    problems.push({ reason: 'boundary-in-gap', dates: [...gaps].sort() });
  }
  if (repeats.size > 0) {
    problems.push({ reason: 'boundary-repeated', dates: [...repeats].sort() });
  }
  return problems;
}

/**
 * A calendar's local date and time, `YYYY-MM-DDTHH:MM`, as the instant the calendar reads it
 * (`compatible`), and whether the zone skips or repeats it there (`reject` refuses both). Exported for
 * the differential test that holds it to Temporal's own answer.
 */
export function resolveLocalTime(
  timeZone: string,
  local: string,
): { readonly instant: Date; readonly fold: Fold } {
  const wall = wallOf(local);
  const { instant, fold } = ZoneOffsets.of(timeZone, wall - ORIGIN_MARGIN_MS).resolve(wall);
  return { instant: new Date(instant), fold };
}
