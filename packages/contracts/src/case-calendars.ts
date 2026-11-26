/**
 * Business calendars (plan C133.2, ours, `ccal_`): a time zone, a week of local `[start, end)`
 * intervals, holidays and optional closures. No holiday data ships (decision 57): an operator enters
 * dates, or imports a `date,label` CSV through `readCsv` (C118.5).
 *
 * This schema holds the shape: `HH:MM` times, intervals in order without overlap, at least one
 * business hour a week, real dates, distinct holidays. What needs the time zone's rules (the zone
 * being known to the runtime, and no boundary in a gap or a repeat over the next two years) is the
 * service's, which answers `calendar_invalid` naming the dates (C133.3).
 *
 * A calendar holds configuration, never a subject's data, so nothing here is PII; a holiday label is
 * an operator's word.
 *
 * Routes (frozen by `foundation-8b`, built by `api-queues-sla`): `GET`, `POST /case-calendars`, `GET`,
 * `PATCH /case-calendars/:id` and `POST /case-calendars/:id/holidays/import`, under
 * `case-queues:read` and `case-queues:write` (C129.5). An edit recomputes the running deadlines of
 * the cases on the calendar, each with a history row (decision 59).
 */
import { CASE_WEEKDAYS, type CaseWeekday } from '@openverify/core';
import { z } from 'zod';
import { caseConfigNameSchema } from './case-queues.js';
import { caseLimit } from './case-templates.js';
import {
  listDocumentSchema,
  requestDocumentSchema,
  resourceSchema,
  singleDocumentSchema,
  timestampSchema,
  toTimestamp,
} from './json-api.js';
import { listQuerySchema } from './list-filters.js';

const TIME = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;
/** An interval may end at the day's end, written `24:00`. */
const END_TIME = /^(?:(?:[01][0-9]|2[0-3]):[0-5][0-9]|24:00)$/;
const DATE = /^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])$/;
const LOCAL_DATE_TIME =
  /^([0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01]))T((?:[01][0-9]|2[0-3]):[0-5][0-9])$/;

const minutesOf = (time: string): number => {
  const [hours = '0', minutes = '0'] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
};

/** A date that exists in the proleptic Gregorian calendar (no 31 April, no 29 February 2027). */
const isRealDate = (date: string): boolean => {
  const [year = 0, month = 0, day = 0] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCMonth() === month - 1 && value.getUTCDate() === day;
};

/** C133.2: a local wall-clock date, `YYYY-MM-DD`. */
export const caseCalendarDateSchema = z
  .string()
  .regex(DATE, 'must be a date, YYYY-MM-DD')
  .refine(isRealDate, 'is not a day of the calendar');

/** C133.2: a local wall-clock instant without a zone, `YYYY-MM-DDTHH:MM`. */
export const caseCalendarLocalDateTimeSchema = z
  .string()
  .regex(LOCAL_DATE_TIME, 'must be a local date and time, YYYY-MM-DDTHH:MM')
  .refine((value) => isRealDate(value.slice(0, 10)), 'is not a day of the calendar');

/** C133.2: one `[start, end)` interval of local time; `end` may be `24:00`. */
export const caseCalendarIntervalSchema = z
  .strictObject({
    start: z.string().regex(TIME, 'must be a time, HH:MM'),
    end: z.string().regex(END_TIME, 'must be a time, HH:MM, or 24:00'),
  })
  .refine(({ start, end }) => minutesOf(start) < minutesOf(end), {
    message: 'must end after it starts',
    path: ['end'],
  });
export type CaseCalendarInterval = z.infer<typeof caseCalendarIntervalSchema>;

/** One day's intervals: in order, none overlapping; an empty day is closed. */
const daySchema = z
  .array(caseCalendarIntervalSchema)
  .max(caseLimit('calendar-intervals-per-day'))
  .refine(
    (intervals) =>
      intervals.every(
        (interval, index) =>
          index === 0 ||
          minutesOf(intervals[index - 1]?.end ?? '00:00') <= minutesOf(interval.start),
      ),
    'must be in order, without overlap',
  );

const businessMinutes = (week: Readonly<Record<CaseWeekday, readonly CaseCalendarInterval[]>>) =>
  CASE_WEEKDAYS.reduce(
    (sum, day) =>
      sum +
      week[day].reduce(
        (daySum, { start, end }) => daySum + Math.max(0, minutesOf(end) - minutesOf(start)),
        0,
      ),
    0,
  );

/** C133.2: every weekday, in ISO order, with at least one business hour a week. */
export const caseCalendarWeekSchema = z
  .strictObject(
    Object.fromEntries(CASE_WEEKDAYS.map((day) => [day, daySchema])) as Record<
      CaseWeekday,
      typeof daySchema
    >,
  )
  .refine((week) => businessMinutes(week) >= caseLimit('calendar-week-minutes-minimum'), {
    message: 'needs at least one business hour a week',
  });
export type CaseCalendarWeek = z.infer<typeof caseCalendarWeekSchema>;

const labelSchema = z.string().min(1).max(caseLimit('calendar-label-characters'));

/** C133.2: a holiday is closed all day. */
export const caseCalendarHolidaySchema = z.strictObject({
  date: caseCalendarDateSchema,
  label: labelSchema,
});
export type CaseCalendarHoliday = z.infer<typeof caseCalendarHolidaySchema>;

const holidaysSchema = z
  .array(caseCalendarHolidaySchema)
  .max(caseLimit('calendar-holidays'))
  .refine(
    (holidays) => new Set(holidays.map(({ date }) => date)).size === holidays.length,
    'must not name a date twice',
  );

/** C133.2: closed from `start` to `end`, local time. */
export const caseCalendarClosureSchema = z
  .strictObject({
    start: caseCalendarLocalDateTimeSchema,
    end: caseCalendarLocalDateTimeSchema,
    label: labelSchema,
  })
  .refine(({ start, end }) => start < end, { message: 'must end after it starts', path: ['end'] });
export type CaseCalendarClosure = z.infer<typeof caseCalendarClosureSchema>;

const closuresSchema = z.array(caseCalendarClosureSchema).max(caseLimit('calendar-closures'));

/**
 * C133.2: an IANA zone's name. Whether the runtime knows it is the service's question, answered with
 * `calendar_invalid`, because the runtime's tz database decides (C133.3).
 */
export const caseCalendarTimeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
  .regex(/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/, 'must be an IANA time zone');

const CALENDAR_ATTRIBUTES = {
  name: caseConfigNameSchema,
  'time-zone': caseCalendarTimeZoneSchema,
  week: caseCalendarWeekSchema,
  holidays: holidaysSchema,
  closures: closuresSchema,
};

export const caseCalendarResourceSchema = resourceSchema(
  'case-calendar',
  'ccal',
  z.strictObject({
    ...CALENDAR_ATTRIBUTES,
    'created-at': timestampSchema,
    'updated-at': timestampSchema,
  }),
);
export type CaseCalendarResource = z.infer<typeof caseCalendarResourceSchema>;
export const caseCalendarDocumentSchema = singleDocumentSchema(caseCalendarResourceSchema);
export type CaseCalendarDocument = z.infer<typeof caseCalendarDocumentSchema>;
export const caseCalendarListDocumentSchema = listDocumentSchema(caseCalendarResourceSchema);
export type CaseCalendarListDocument = z.infer<typeof caseCalendarListDocumentSchema>;

export const listCaseCalendarsQuerySchema = listQuerySchema('ccal', {});

/** `POST /api/v1/case-calendars`: holidays and closures default to none. */
export const createCaseCalendarBodySchema = requestDocumentSchema(
  'case-calendar',
  z.strictObject({
    name: CALENDAR_ATTRIBUTES.name,
    'time-zone': CALENDAR_ATTRIBUTES['time-zone'],
    week: CALENDAR_ATTRIBUTES.week,
    holidays: CALENDAR_ATTRIBUTES.holidays.optional(),
    closures: CALENDAR_ATTRIBUTES.closures.optional(),
  }),
);
export type CreateCaseCalendarBody = z.infer<typeof createCaseCalendarBodySchema>;

/** `PATCH /api/v1/case-calendars/:id`: a member sent replaces the stored one whole. */
export const updateCaseCalendarBodySchema = requestDocumentSchema(
  'case-calendar',
  z
    .strictObject({
      name: CALENDAR_ATTRIBUTES.name.optional(),
      'time-zone': CALENDAR_ATTRIBUTES['time-zone'].optional(),
      week: CALENDAR_ATTRIBUTES.week.optional(),
      holidays: CALENDAR_ATTRIBUTES.holidays.optional(),
      closures: CALENDAR_ATTRIBUTES.closures.optional(),
    })
    .refine((attributes) => Object.keys(attributes).length > 0, 'nothing to update'),
);
export type UpdateCaseCalendarBody = z.infer<typeof updateCaseCalendarBodySchema>;

/**
 * `POST /api/v1/case-calendars/:id/holidays/import`: a `date,label` CSV read by `readCsv` with the
 * importers' parser rules (C133.2). The rows join the stored holidays, a date already there taking
 * the row's label, unless `replace` is true. A stored log masks the CSV whole (C143.5, P21).
 */
export const importCaseCalendarHolidaysBodySchema = requestDocumentSchema(
  'case-calendar',
  z.strictObject({
    csv: z.string().min(1).max(caseLimit('holiday-csv-characters')).meta({ pii: true }),
    replace: z.boolean().optional(),
  }),
);
export type ImportCaseCalendarHolidaysBody = z.infer<typeof importCaseCalendarHolidaysBodySchema>;

/** A row the import refused, by number and code; a problem never echoes a value (P21). */
export const caseCalendarImportRefusalSchema = z.strictObject({
  row: z.int().min(1),
  code: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'must be a snake_case code'),
});

/** The calendar after the import, with what was taken and what was refused. */
export const caseCalendarImportDocumentSchema = z.strictObject({
  data: caseCalendarResourceSchema,
  meta: z.strictObject({
    'imported-count': z.int().min(0),
    refused: z.array(caseCalendarImportRefusalSchema),
  }),
});
export type CaseCalendarImportDocument = z.infer<typeof caseCalendarImportDocumentSchema>;

export interface CaseCalendarRecord {
  id: string;
  name: string;
  timeZone: string;
  week: CaseCalendarWeek;
  holidays: readonly CaseCalendarHoliday[];
  closures: readonly CaseCalendarClosure[];
  createdAt: Date;
  updatedAt: Date;
}

/** @throws {z.ZodError} when the record does not satisfy the contract. */
export function buildCaseCalendarResource(record: CaseCalendarRecord): CaseCalendarResource {
  return caseCalendarResourceSchema.parse({
    type: 'case-calendar',
    id: record.id,
    attributes: {
      name: record.name,
      'time-zone': record.timeZone,
      week: record.week,
      holidays: record.holidays,
      closures: record.closures,
      'created-at': toTimestamp(record.createdAt),
      'updated-at': toTimestamp(record.updatedAt),
    },
  });
}
