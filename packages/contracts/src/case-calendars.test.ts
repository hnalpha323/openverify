import { describe, expect, it } from 'vitest';
import {
  buildCaseCalendarResource,
  caseCalendarClosureSchema,
  caseCalendarDateSchema,
  caseCalendarDocumentSchema,
  caseCalendarImportDocumentSchema,
  caseCalendarListDocumentSchema,
  caseCalendarTimeZoneSchema,
  caseCalendarWeekSchema,
  createCaseCalendarBodySchema,
  importCaseCalendarHolidaysBodySchema,
  listCaseCalendarsQuerySchema,
  updateCaseCalendarBodySchema,
} from './case-calendars.js';
import { readFixture } from './test-support.js';

const CALENDAR = 'ccal_01M5CN00000000000000000018';
const AT = new Date('2026-10-20T12:00:00.000Z');
const LATER = new Date('2026-10-20T12:05:00.000Z');

const golden = caseCalendarDocumentSchema.parse(readFixture('api/case-calendar.json'));
const closed = { monday: [], tuesday: [], wednesday: [], thursday: [], friday: [] };
const weekend = { saturday: [], sunday: [] };

describe('business calendars (C133.2)', () => {
  it('builds the golden calendar', () => {
    const { attributes } = golden.data;
    expect(
      buildCaseCalendarResource({
        id: CALENDAR,
        name: 'Utopia office hours',
        timeZone: 'America/New_York',
        week: attributes.week,
        holidays: attributes.holidays,
        closures: attributes.closures,
        createdAt: AT,
        updatedAt: LATER,
      }),
    ).toEqual(golden.data);
  });

  it('takes [start, end) intervals in order, ending at 24:00 at the latest', () => {
    const week = (monday: unknown) =>
      caseCalendarWeekSchema.safeParse({ ...closed, ...weekend, monday });
    expect(week([{ start: '00:00', end: '24:00' }]).success).toBe(true);
    expect(
      week([
        { start: '09:00', end: '12:00' },
        { start: '12:00', end: '17:00' },
      ]).success,
    ).toBe(true);
    expect(
      week([
        { start: '09:00', end: '13:00' },
        { start: '12:00', end: '17:00' },
      ]).success,
    ).toBe(false);
    expect(
      week([
        { start: '13:00', end: '17:00' },
        { start: '09:00', end: '12:00' },
      ]).success,
    ).toBe(false);
    expect(week([{ start: '17:00', end: '09:00' }]).success).toBe(false);
    expect(week([{ start: '24:00', end: '24:00' }]).success).toBe(false);
    expect(week([{ start: '9:00', end: '17:00' }]).success).toBe(false);
    expect(week([{ start: '09:00', end: '24:30' }]).success).toBe(false);
  });

  it('needs every weekday and at least one business hour a week', () => {
    expect(
      caseCalendarWeekSchema.safeParse({
        ...closed,
        ...weekend,
        sunday: [{ start: '10:00', end: '11:00' }],
      }).success,
    ).toBe(true);
    expect(
      caseCalendarWeekSchema.safeParse({
        ...closed,
        ...weekend,
        sunday: [{ start: '10:00', end: '10:59' }],
      }).success,
    ).toBe(false);
    expect(
      caseCalendarWeekSchema.safeParse({ ...closed, monday: [{ start: '09:00', end: '17:00' }] })
        .success,
    ).toBe(false);
  });

  it('reads real dates only, and each holiday once', () => {
    expect(caseCalendarDateSchema.safeParse('2028-02-29').success).toBe(true);
    expect(caseCalendarDateSchema.safeParse('2027-02-29').success).toBe(false);
    expect(caseCalendarDateSchema.safeParse('2026-04-31').success).toBe(false);
    expect(caseCalendarDateSchema.safeParse('2026-13-01').success).toBe(false);
    const holidays = (list: unknown) =>
      createCaseCalendarBodySchema.safeParse({
        data: {
          attributes: {
            name: 'Office',
            'time-zone': 'Europe/London',
            week: golden.data.attributes.week,
            holidays: list,
          },
        },
      }).success;
    expect(holidays([{ date: '2026-12-25', label: 'Closed' }])).toBe(true);
    expect(
      holidays([
        { date: '2026-12-25', label: 'Closed' },
        { date: '2026-12-25', label: 'Again' },
      ]),
    ).toBe(false);
  });

  it('takes a closure of local date-times that ends after it starts', () => {
    expect(
      caseCalendarClosureSchema.safeParse({
        start: '2026-11-26T12:00',
        end: '2026-11-27T09:00',
        label: 'Training',
      }).success,
    ).toBe(true);
    expect(
      caseCalendarClosureSchema.safeParse({
        start: '2026-11-26T12:00',
        end: '2026-11-26T12:00',
        label: 'Training',
      }).success,
    ).toBe(false);
    expect(
      caseCalendarClosureSchema.safeParse({
        start: '2026-11-26T12:00Z',
        end: '2026-11-27T09:00',
        label: 'Training',
      }).success,
    ).toBe(false);
  });

  it('takes an IANA zone by its shape and leaves whether it is known to the service', () => {
    for (const zone of ['America/New_York', 'Australia/Lord_Howe', 'UTC', 'Etc/GMT+12']) {
      expect(caseCalendarTimeZoneSchema.safeParse(zone).success, zone).toBe(true);
    }
    for (const zone of ['', '+05:30', 'America/../etc', 'America/New York']) {
      expect(caseCalendarTimeZoneSchema.safeParse(zone).success, zone).toBe(false);
    }
  });

  it('imports a date,label CSV and answers the rows it refused by number (C133.2)', () => {
    expect(
      importCaseCalendarHolidaysBodySchema.safeParse({
        data: { attributes: { csv: 'date,label\r\n2027-01-01,Office closed\r\n' } },
      }).success,
    ).toBe(true);
    expect(
      importCaseCalendarHolidaysBodySchema.safeParse({ data: { attributes: { csv: '' } } }).success,
    ).toBe(false);
    const answer = caseCalendarImportDocumentSchema.parse(
      readFixture('api/case-calendar-import.json'),
    );
    expect(answer.meta.refused).toEqual([{ row: 3, code: 'date_invalid' }]);
    expect(
      caseCalendarImportDocumentSchema.safeParse({
        ...answer,
        meta: { ...answer.meta, refused: [{ row: 3, code: 'date_invalid', value: '2027-02-30' }] },
      }).success,
    ).toBe(false);
  });

  it('updates what it sends and lists newest first', () => {
    expect(
      updateCaseCalendarBodySchema.safeParse({ data: { attributes: { holidays: [] } } }).success,
    ).toBe(true);
    expect(updateCaseCalendarBodySchema.safeParse({ data: { attributes: {} } }).success).toBe(
      false,
    );
    expect(listCaseCalendarsQuerySchema.safeParse({ 'page[after]': CALENDAR }).success).toBe(true);
    expect(
      caseCalendarListDocumentSchema.safeParse({ data: [], links: { next: null } }).success,
    ).toBe(true);
  });
});
