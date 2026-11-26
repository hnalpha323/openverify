/**
 * Schedules (plan C118.3, C118.4; decisions 8, 9). `cron-parser` parses a five-field cron in strict
 * mode with a `0` seconds field prefixed, and refuses what it refuses; the fire times are ours, on
 * `temporal-polyfill` with explicit disambiguation, because cron libraries disagree on DST and their
 * own rules have changed between versions:
 * - a fixed local time that does not exist fires at the first valid minute after the gap;
 * - a fixed local time that occurs twice fires once, at the first occurrence;
 * - an interval follows elapsed time, so it runs through a gap and through both occurrences of a
 *   repeated hour. A cron is an interval when it names every hour.
 *
 * Instants are UTC ISO 8601 text. A schedule is stored as an instant and recomputed after each fire,
 * so a tz database update reaches it at its next computation.
 */
import { CronExpressionParser } from 'cron-parser';
import { Temporal } from 'temporal-polyfill';

export interface ScheduleConfig {
  /** Five fields, or leave it out for `everyMinutes`. */
  readonly cron?: string;
  readonly everyMinutes?: number;
  /** An IANA zone. */
  readonly timeZone: string;
}

export const SCHEDULE_PROBLEM_CODES = [
  'schedule_invalid',
  'schedule_zone_invalid',
  'schedule_never_fires',
] as const;
export type ScheduleProblemCode = (typeof SCHEDULE_PROBLEM_CODES)[number];

/** A schedule that cannot be computed. It quotes nothing of the schedule. */
export class ScheduleError extends Error {
  override readonly name = 'ScheduleError';

  constructor(readonly code: ScheduleProblemCode) {
    super(code);
  }
}

export interface FireTime {
  /** In UTC. */
  readonly instant: string;
  /** In the schedule's zone, with its offset. */
  readonly local: string;
}

const MINUTE_MS = 60_000;
const HOURS_IN_DAY = 24;
const DAYS_IN_WEEK = 7;
/** Eight years span the longest gap between leap days. */
const HORIZON_DAYS = 8 * 366 + 2;

const FIELD = /^[\dA-Z*,/-]+$/i;
const LETTERS = /[A-Z]/i;
const MONTH_NAMES = /^(?:[\d*,/-]|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)+$/i;
const DAY_NAMES = /^(?:[\d*,/-]|SUN|MON|TUE|WED|THU|FRI|SAT)+$/i;
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const ZONE = /^[A-Z_]+(?:\/[\w+-]+)*$/i;
const WHITESPACE = /\s+/;

const MONTH_FIELD = 3;
const DAY_FIELD = 4;

interface CronFields {
  readonly minutes: readonly number[];
  readonly hours: readonly number[];
  readonly days: ReadonlySet<number>;
  readonly months: ReadonlySet<number>;
  readonly weekdays: ReadonlySet<number>;
}

interface Parsed {
  readonly timeZone: string;
  readonly fields: CronFields | null;
  readonly everyMinutes: number | null;
}

/** C118.4: no `H`, `L`, `W`, `#` or `?`: `cron-parser` takes some of them, and decision 9 does not. */
function fieldFits(field: string, index: number): boolean {
  if (!FIELD.test(field)) {
    return false;
  }
  if (index === MONTH_FIELD) {
    return MONTH_NAMES.test(field);
  }
  return index === DAY_FIELD ? DAY_NAMES.test(field) : !LETTERS.test(field);
}

function parseCron(cron: string): CronFields {
  const fields = cron.trim().split(WHITESPACE);
  if (fields.length !== 5 || !fields.every(fieldFits)) {
    throw new ScheduleError('schedule_invalid');
  }
  try {
    const parsed = CronExpressionParser.parse(`0 ${cron.trim()}`, { strict: true }).fields;
    return {
      minutes: [...parsed.minute.values],
      hours: [...parsed.hour.values],
      days: new Set<number>(parsed.dayOfMonth.values as readonly number[]),
      months: new Set<number>(parsed.month.values),
      weekdays: new Set(
        (parsed.dayOfWeek.values as readonly number[]).map((day) => day % DAYS_IN_WEEK),
      ),
    };
  } catch {
    throw new ScheduleError('schedule_invalid');
  }
}

function checkZone(timeZone: string): void {
  try {
    if (!ZONE.test(timeZone)) {
      throw new ScheduleError('schedule_zone_invalid');
    }
    Temporal.Now.zonedDateTimeISO(timeZone);
  } catch {
    throw new ScheduleError('schedule_zone_invalid');
  }
}

function parseSchedule({ cron, everyMinutes, timeZone }: ScheduleConfig): Parsed {
  if ((cron === undefined) === (everyMinutes === undefined)) {
    throw new ScheduleError('schedule_invalid');
  }
  if (everyMinutes !== undefined && (!Number.isInteger(everyMinutes) || everyMinutes < 1)) {
    throw new ScheduleError('schedule_invalid');
  }
  const fields = cron === undefined ? null : parseCron(cron);
  checkZone(timeZone);
  return { timeZone, fields, everyMinutes: everyMinutes ?? null };
}

const dayMatches = (fields: CronFields, date: Temporal.PlainDate): boolean =>
  fields.months.has(date.month) &&
  fields.days.has(date.day) &&
  fields.weekdays.has(date.dayOfWeek % DAYS_IN_WEEK);

const isInterval = ({ hours }: CronFields): boolean => hours.length === HOURS_IN_DAY;

const instantText = (epochMilliseconds: number): string =>
  new Date(epochMilliseconds).toISOString();

const zoned = (epochMilliseconds: number, timeZone: string): Temporal.ZonedDateTime =>
  Temporal.Instant.fromEpochMilliseconds(epochMilliseconds).toZonedDateTimeISO(timeZone);

/** Elapsed time: walk real minutes, jumping over a day that cannot match. */
function nextOfInterval(fields: CronFields, timeZone: string, after: number): number {
  const minutes = new Set(fields.minutes);
  const limit = after + HORIZON_DAYS * 24 * 60 * MINUTE_MS;
  let moment = (Math.floor(after / MINUTE_MS) + 1) * MINUTE_MS;
  while (moment <= limit) {
    const local = zoned(moment, timeZone);
    if (!dayMatches(fields, local.toPlainDate())) {
      moment = local.toPlainDate().add({ days: 1 }).toZonedDateTime(timeZone).epochMilliseconds;
    } else if (minutes.has(local.minute)) {
      return moment;
    } else {
      moment += MINUTE_MS;
    }
  }
  throw new ScheduleError('schedule_never_fires');
}

/** The instant a fixed local time fires at, by decision 8. */
function fireOfLocalTime(local: Temporal.PlainDateTime, timeZone: string): number {
  const earlier = local.toZonedDateTime(timeZone, { disambiguation: 'earlier' });
  if (earlier.toPlainDateTime().equals(local)) {
    return earlier.epochMilliseconds;
  }
  // `earlier` lands before a gap, so the transition after it is the first valid minute.
  const transition = earlier.getTimeZoneTransition('next');
  return (transition ?? earlier).epochMilliseconds;
}

function firesOfDay(fields: CronFields, timeZone: string, date: Temporal.PlainDate): number[] {
  const fires = fields.hours.flatMap((hour) =>
    fields.minutes.map((minute) =>
      fireOfLocalTime(date.toPlainDateTime({ hour, minute }), timeZone),
    ),
  );
  return [...new Set(fires)].sort((left, right) => left - right);
}

function nextOfFixed(fields: CronFields, timeZone: string, after: number): number {
  // A day before, because a fire moved across midnight by a gap belongs to the day before it.
  let date = zoned(after, timeZone).toPlainDate().subtract({ days: 1 });
  for (let day = 0; day <= HORIZON_DAYS; day += 1) {
    if (dayMatches(fields, date)) {
      const fire = firesOfDay(fields, timeZone, date).find((moment) => moment > after);
      if (fire !== undefined) {
        return fire;
      }
    }
    date = date.add({ days: 1 });
  }
  throw new ScheduleError('schedule_never_fires');
}

function nextOfParsed(schedule: Parsed, after: number): number {
  const { fields, everyMinutes, timeZone } = schedule;
  if (fields === null) {
    return after + (everyMinutes ?? 0) * MINUTE_MS;
  }
  return isInterval(fields)
    ? nextOfInterval(fields, timeZone, after)
    : nextOfFixed(fields, timeZone, after);
}

/** C116.4: why a schedule is refused, or `null`. */
export function validateSchedule(config: ScheduleConfig): ScheduleProblemCode | null {
  try {
    nextOfParsed(parseSchedule(config), Date.UTC(2026, 0, 1));
    return null;
  } catch (error) {
    if (error instanceof ScheduleError) {
      return error.code;
    }
    throw error;
  }
}

/**
 * C118.4: the first fire strictly after `after`.
 * @throws {ScheduleError} for a schedule {@link validateSchedule} refuses.
 */
export function nextFireTime(config: ScheduleConfig, after: string): string {
  return instantText(nextOfParsed(parseSchedule(config), Date.parse(after)));
}

const localText = (moment: number, timeZone: string): string =>
  zoned(moment, timeZone).toString({ timeZoneName: 'never', fractionalSecondDigits: 0 });

/** C118.4: what the console shows, each fire in UTC and in the zone. */
export function nextFireTimes(
  config: ScheduleConfig,
  after: string,
  count = 5,
): readonly FireTime[] {
  const schedule = parseSchedule(config);
  const fires: FireTime[] = [];
  let moment = Date.parse(after);
  for (let index = 0; index < count; index += 1) {
    moment = nextOfParsed(schedule, moment);
    fires.push({ instant: instantText(moment), local: localText(moment, config.timeZone) });
  }
  return fires;
}

export interface ScheduleTick {
  /** The fire time the unique `(schedule_id, fire_time)` holds. */
  readonly fireTime: string;
  readonly nextFireAt: string;
}

/**
 * C118.4, C74.3 (b): the tick due at `now`, or `null`. An outage of several periods gives one
 * catch-up tick, because the next fire is the first after `now`, not the one after the last.
 */
export function advanceSchedule(
  config: ScheduleConfig,
  nextFireAt: string,
  now: string,
): ScheduleTick | null {
  if (Date.parse(now) < Date.parse(nextFireAt)) {
    return null;
  }
  return { fireTime: nextFireAt, nextFireAt: nextFireTime(config, now) };
}

export const SCHEDULE_UNITS_SECONDS = { minutes: 60, hours: 3_600, days: 86_400 } as const;
export type ScheduleOffsetUnit = keyof typeof SCHEDULE_UNITS_SECONDS;

/** C118.3: when a scheduled run is due, by elapsed time from its base. */
export function scheduledRunTime(
  base: string,
  offset: number,
  units: ScheduleOffsetUnit,
  direction: 'before' | 'after',
): string {
  const delta = offset * SCHEDULE_UNITS_SECONDS[units] * 1_000;
  return instantText(Date.parse(base) + (direction === 'after' ? delta : -delta));
}
