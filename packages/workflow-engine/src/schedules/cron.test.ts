/**
 * C118.4 (decisions 8, 9): our DST rules, golden-tested whatever the library does. A fixed local time
 * that does not exist fires at the first valid minute after the gap, one that occurs twice fires once,
 * at the first occurrence, and intervals follow elapsed time.
 */
import { describe, expect, it } from 'vitest';
import {
  advanceSchedule,
  nextFireTime,
  nextFireTimes,
  scheduledRunTime,
  validateSchedule,
  type ScheduleConfig,
} from './cron.js';

const daily = (cron: string, timeZone: string): ScheduleConfig => ({ cron, timeZone });

describe('fixed local times across a gap (C118.4)', () => {
  it.each<[string, string, string, string, string]>([
    // Zone, cron, after, fires, and why.
    [
      'America/New_York',
      '30 2 * * *',
      '2026-03-08T00:00:00.000Z',
      '2026-03-08T07:00:00.000Z',
      '02:30 is gone: 03:00 EDT',
    ],
    [
      'Europe/London',
      '30 1 * * *',
      '2026-03-29T00:00:00.000Z',
      '2026-03-29T01:00:00.000Z',
      '01:30 is gone: 02:00 BST',
    ],
    [
      'Australia/Lord_Howe',
      '15 2 * * *',
      '2026-10-03T14:00:00.000Z',
      '2026-10-03T15:30:00.000Z',
      '02:15 is gone: 02:30 +11:00',
    ],
    [
      'Pacific/Chatham',
      '0 3 * * *',
      '2026-09-26T12:00:00.000Z',
      '2026-09-26T14:00:00.000Z',
      '03:00 is gone: 03:45 +13:45',
    ],
  ])('%s %s after %s fires at %s (%s)', (zone, cron, after, fires) => {
    expect(nextFireTime(daily(cron, zone), after)).toBe(fires);
  });

  it('fires once when two local times fall in one gap', () => {
    const schedule = daily('0,30 2 * * *', 'America/New_York');
    expect(nextFireTime(schedule, '2026-03-08T00:00:00.000Z')).toBe('2026-03-08T07:00:00.000Z');
    expect(nextFireTime(schedule, '2026-03-08T07:00:00.000Z')).toBe('2026-03-09T06:00:00.000Z');
  });

  it('does not skip the day after the gap', () => {
    const schedule = daily('30 2 * * *', 'America/New_York');
    expect(nextFireTime(schedule, '2026-03-08T07:00:00.000Z')).toBe('2026-03-09T06:30:00.000Z');
  });

  it('keeps the time before the gap as it is', () => {
    const schedule = daily('30 1 * * *', 'America/New_York');
    expect(nextFireTime(schedule, '2026-03-08T00:00:00.000Z')).toBe('2026-03-08T06:30:00.000Z');
  });
});

describe('fixed local times across an overlap (C118.4)', () => {
  it.each<[string, string, string, string, string]>([
    [
      'America/New_York',
      '30 1 * * *',
      '2026-11-01T00:00:00.000Z',
      '2026-11-01T05:30:00.000Z',
      '01:30 EDT, the first',
    ],
    [
      'Europe/London',
      '30 1 * * *',
      '2026-10-24T23:00:00.000Z',
      '2026-10-25T00:30:00.000Z',
      '01:30 BST, the first',
    ],
    [
      'Australia/Lord_Howe',
      '45 1 * * *',
      '2026-04-04T10:00:00.000Z',
      '2026-04-04T14:45:00.000Z',
      '01:45 +11:00, the first',
    ],
    [
      'Pacific/Chatham',
      '0 3 * * *',
      '2026-04-04T10:00:00.000Z',
      '2026-04-04T13:15:00.000Z',
      '03:00 +13:45, the first',
    ],
  ])('%s %s after %s fires at %s (%s)', (zone, cron, after, fires) => {
    expect(nextFireTime(daily(cron, zone), after)).toBe(fires);
  });

  it('never fires at the second occurrence', () => {
    const schedule = daily('30 1 * * *', 'America/New_York');
    expect(nextFireTime(schedule, '2026-11-01T05:30:00.000Z')).toBe('2026-11-02T06:30:00.000Z');
  });
});

describe('a zone with no DST', () => {
  it('fires every day at the same instant', () => {
    const schedule = daily('30 2 * * *', 'Asia/Kolkata');
    expect(nextFireTime(schedule, '2026-03-08T00:00:00.000Z')).toBe('2026-03-08T21:00:00.000Z');
    expect(nextFireTime(schedule, '2026-03-08T21:00:00.000Z')).toBe('2026-03-09T21:00:00.000Z');
    expect(nextFireTime(schedule, '2026-11-01T00:00:00.000Z')).toBe('2026-11-01T21:00:00.000Z');
  });
});

describe('intervals follow elapsed time (C118.4)', () => {
  it('walks through a gap with no pause', () => {
    const schedule = daily('*/15 * * * *', 'America/New_York');
    expect(nextFireTime(schedule, '2026-03-08T06:45:00.000Z')).toBe('2026-03-08T07:00:00.000Z');
  });

  it('fires at both occurrences of a repeated hour', () => {
    const schedule = daily('*/15 * * * *', 'America/New_York');
    expect(nextFireTime(schedule, '2026-11-01T05:45:00.000Z')).toBe('2026-11-01T06:00:00.000Z');
    expect(nextFireTime(schedule, '2026-11-01T06:00:00.000Z')).toBe('2026-11-01T06:15:00.000Z');
  });

  it('holds on a thirty-minute shift', () => {
    const schedule = daily('0 * * * *', 'Australia/Lord_Howe');
    // 02:00 does not exist, so the next hour mark is 03:00 at +11:00.
    expect(nextFireTime(schedule, '2026-10-03T15:00:00.000Z')).toBe('2026-10-03T16:00:00.000Z');
  });

  it('takes a day of its own', () => {
    expect(nextFireTime(daily('* * 15 * *', 'UTC'), '2026-03-20T00:00:00.000Z')).toBe(
      '2026-04-15T00:00:00.000Z',
    );
  });

  it('every-minutes is plain arithmetic, in any zone', () => {
    const schedule: ScheduleConfig = { everyMinutes: 90, timeZone: 'America/New_York' };
    expect(nextFireTime(schedule, '2026-03-08T06:30:00.000Z')).toBe('2026-03-08T08:00:00.000Z');
  });
});

describe('cron fields', () => {
  it.each<[string, string, string]>([
    ['the next match of a weekday', '0 9 * * 1', '2026-10-26T09:00:00.000Z'],
    ['a named weekday', '0 9 * * MON', '2026-10-26T09:00:00.000Z'],
    ['Sunday as seven', '0 9 * * 7', '2026-10-25T09:00:00.000Z'],
    ['a day of the month', '0 9 1 * *', '2026-11-01T09:00:00.000Z'],
    ['a named month', '0 9 1 JAN *', '2027-01-01T09:00:00.000Z'],
    ['a list and a range', '0,30 8-9 * * *', '2026-10-21T08:00:00.000Z'],
    ['a leap day', '0 0 29 2 *', '2028-02-29T00:00:00.000Z'],
  ])('%s', (_label, cron, fires) => {
    expect(nextFireTime(daily(cron, 'UTC'), '2026-10-20T12:00:00.000Z')).toBe(fires);
  });

  it('is strictly after', () => {
    const schedule = daily('0 9 * * *', 'UTC');
    expect(nextFireTime(schedule, '2026-10-21T09:00:00.000Z')).toBe('2026-10-22T09:00:00.000Z');
    expect(nextFireTime(schedule, '2026-10-21T08:59:59.999Z')).toBe('2026-10-21T09:00:00.000Z');
  });
});

describe('validateSchedule (C118.4, C116.4)', () => {
  it.each<[string, ScheduleConfig]>([
    ['a cron', { cron: '0 9 * * 1-5', timeZone: 'Europe/London' }],
    ['an interval', { everyMinutes: 1, timeZone: 'UTC' }],
  ])('takes %s', (_label, schedule) => {
    expect(validateSchedule(schedule)).toBeNull();
  });

  it.each<[string, string]>([
    ['six fields', '0 0 9 * * *'],
    ['four fields', '0 9 * *'],
    ['an empty string', ''],
    ['H', 'H 9 * * *'],
    ['L', '0 9 L * *'],
    ['L on a weekday', '0 9 * * 5L'],
    ['W', '0 9 15W * *'],
    ['the hash', '0 9 * * 1#2'],
    ['a question mark', '0 9 ? * *'],
    ['a minute out of range', '60 9 * * *'],
    ['an hour out of range', '0 24 * * *'],
    ['a day of the month and a day of the week, ambiguous in strict mode', '0 9 1 * 1'],
    ['a name where none belongs', '0 MON * * *'],
    ['words', 'every day'],
    ['a date the parser knows is impossible', '0 0 30 2 *'],
  ])('refuses %s', (_label, cron) => {
    expect(validateSchedule({ cron, timeZone: 'UTC' })).toBe('schedule_invalid');
  });

  it('refuses both forms and neither', () => {
    expect(validateSchedule({ timeZone: 'UTC' })).toBe('schedule_invalid');
    expect(validateSchedule({ cron: '0 9 * * *', everyMinutes: 5, timeZone: 'UTC' })).toBe(
      'schedule_invalid',
    );
  });

  it.each([0, -1, 1.5])('refuses every-minutes of %d', (everyMinutes) => {
    expect(validateSchedule({ everyMinutes, timeZone: 'UTC' })).toBe('schedule_invalid');
  });

  it.each(['Mars/Base', '+01:00', '', 'Europe/', 'EST5EDT4,M3'])(
    'refuses the zone %j',
    (timeZone) => {
      expect(validateSchedule({ cron: '0 9 * * *', timeZone })).toBe('schedule_zone_invalid');
    },
  );

  it('refuses a schedule that never fires', () => {
    expect(validateSchedule({ cron: '0 0 31 2,4 *', timeZone: 'UTC' })).toBe(
      'schedule_never_fires',
    );
    expect(validateSchedule({ cron: '* * 31 2,4 *', timeZone: 'UTC' })).toBe(
      'schedule_never_fires',
    );
  });
});

describe('nextFireTimes: what the console shows (C118.4)', () => {
  it('gives the next five, each in UTC and in the zone', () => {
    const fires = nextFireTimes(
      daily('30 2 * * *', 'America/New_York'),
      '2026-03-06T12:00:00.000Z',
    );
    expect(fires.map(({ instant }) => instant)).toEqual([
      '2026-03-07T07:30:00.000Z',
      '2026-03-08T07:00:00.000Z',
      '2026-03-09T06:30:00.000Z',
      '2026-03-10T06:30:00.000Z',
      '2026-03-11T06:30:00.000Z',
    ]);
    expect(fires.map(({ local }) => local)).toEqual([
      '2026-03-07T02:30:00-05:00',
      '2026-03-08T03:00:00-04:00',
      '2026-03-09T02:30:00-04:00',
      '2026-03-10T02:30:00-04:00',
      '2026-03-11T02:30:00-04:00',
    ]);
  });

  it('gives as many as it is asked for', () => {
    expect(
      nextFireTimes({ everyMinutes: 5, timeZone: 'UTC' }, '2026-03-06T12:00:00.000Z', 2),
    ).toEqual([
      { instant: '2026-03-06T12:05:00.000Z', local: '2026-03-06T12:05:00+00:00' },
      { instant: '2026-03-06T12:10:00.000Z', local: '2026-03-06T12:10:00+00:00' },
    ]);
  });
});

describe('advanceSchedule: one catch-up tick (C118.4, C74.3)', () => {
  const schedule = daily('0 * * * *', 'UTC');

  it('does nothing before the fire time', () => {
    expect(
      advanceSchedule(schedule, '2026-10-20T12:00:00.000Z', '2026-10-20T11:59:59.000Z'),
    ).toBeNull();
  });

  it('fires at the fire time', () => {
    expect(
      advanceSchedule(schedule, '2026-10-20T12:00:00.000Z', '2026-10-20T12:00:00.000Z'),
    ).toEqual({
      fireTime: '2026-10-20T12:00:00.000Z',
      nextFireAt: '2026-10-20T13:00:00.000Z',
    });
  });

  it('an outage of several periods gives one tick, not a burst', () => {
    expect(
      advanceSchedule(schedule, '2026-10-20T12:00:00.000Z', '2026-10-20T17:30:00.000Z'),
    ).toEqual({
      fireTime: '2026-10-20T12:00:00.000Z',
      nextFireAt: '2026-10-20T18:00:00.000Z',
    });
  });
});

describe('scheduledRunTime (C118.3)', () => {
  it.each<[number, 'minutes' | 'hours' | 'days', 'before' | 'after', string]>([
    [30, 'minutes', 'after', '2026-10-20T12:30:00.000Z'],
    [2, 'hours', 'before', '2026-10-20T10:00:00.000Z'],
    [3, 'days', 'after', '2026-10-23T12:00:00.000Z'],
    [0, 'days', 'before', '2026-10-20T12:00:00.000Z'],
  ])('%d %s %s', (offset, units, direction, expected) => {
    expect(scheduledRunTime('2026-10-20T12:00:00.000Z', offset, units, direction)).toBe(expected);
  });
});
