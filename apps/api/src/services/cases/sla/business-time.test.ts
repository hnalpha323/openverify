/**
 * C133.3: business time, with the tz fixtures of the plan. Each zone's block asserts the runtime's
 * offsets around its 2026 (and, where a calendar check reads them, 2027) transitions first, so a tz
 * database that moved a rule fails loudly there rather than in an arithmetic test below it. The
 * runtime at the time of writing: Node 22.22.1, ICU 78.2, tz 2025c.
 */
import { Temporal } from 'temporal-polyfill';
import { describe, expect, it } from 'vitest';
import {
  BusinessTimeError,
  addBusinessTime,
  businessTimeBetween,
  calendarProblems,
  resolveLocalTime,
  type BusinessCalendar,
} from './business-time.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const at = (iso: string): Date => new Date(iso);

type Day = readonly { start: string; end: string }[];
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const;
const WEEKEND = ['saturday', 'sunday'] as const;

const weekdays = (day: Day): BusinessCalendar['week'] =>
  ({
    ...Object.fromEntries(WEEKDAYS.map((name) => [name, day])),
    ...Object.fromEntries(WEEKEND.map((name) => [name, []])),
  }) as BusinessCalendar['week'];
const everyDay = (day: Day): BusinessCalendar['week'] =>
  Object.fromEntries(
    [...WEEKDAYS, ...WEEKEND].map((name) => [name, day]),
  ) as BusinessCalendar['week'];

const calendar = (
  timeZone: string,
  week: BusinessCalendar['week'],
  extra: Partial<Pick<BusinessCalendar, 'holidays' | 'closures'>> = {},
): BusinessCalendar => ({ timeZone, week, holidays: [], closures: [], ...extra });

const NINE_TO_FIVE = [{ start: '09:00', end: '17:00' }];
const WHOLE_DAY = [{ start: '00:00', end: '24:00' }];

const offsetAt = (timeZone: string, iso: string): string =>
  Temporal.Instant.from(iso).toZonedDateTimeISO(timeZone).offset;

/** The runtime's offsets, asserted before any arithmetic reads them. */
function expectOffsets(timeZone: string, offsets: readonly (readonly [string, string])[]): void {
  expect(offsets.map(([iso]) => [iso, offsetAt(timeZone, iso)])).toEqual(offsets);
}

describe('the 24x7 calendar (C133.1)', () => {
  it('counts every millisecond', () => {
    expect(addBusinessTime(at('2026-11-07T12:00:00Z'), 90 * MINUTE, null)).toEqual(
      at('2026-11-07T13:30:00Z'),
    );
    expect(businessTimeBetween(at('2026-11-07T12:00:00Z'), at('2026-11-08T12:00:00Z'), null)).toBe(
      DAY,
    );
  });

  it('answers 0 for an end that is not after the start', () => {
    expect(businessTimeBetween(at('2026-11-07T12:00:00Z'), at('2026-11-07T11:00:00Z'), null)).toBe(
      0,
    );
    expect(
      businessTimeBetween(
        at('2026-11-07T12:00:00Z'),
        at('2026-11-07T11:00:00Z'),
        calendar('America/New_York', weekdays(NINE_TO_FIVE)),
      ),
    ).toBe(0);
  });

  it('spans ten years and more without a scan', () => {
    expect(businessTimeBetween(at('2026-01-01T00:00:00Z'), at('2046-01-01T00:00:00Z'), null)).toBe(
      Date.UTC(2046, 0, 1) - Date.UTC(2026, 0, 1),
    );
  });
});

describe('America/New_York', () => {
  const ZONE = 'America/New_York';

  it("reads the runtime's 2026 and 2027 offsets first", () => {
    expectOffsets(ZONE, [
      ['2026-03-08T06:59:00Z', '-05:00'],
      ['2026-03-08T07:00:00Z', '-04:00'],
      ['2026-11-01T05:59:00Z', '-04:00'],
      ['2026-11-01T06:00:00Z', '-05:00'],
      ['2027-03-14T06:59:00Z', '-05:00'],
      ['2027-03-14T07:00:00Z', '-04:00'],
      ['2027-11-07T05:59:00Z', '-04:00'],
      ['2027-11-07T06:00:00Z', '-05:00'],
    ]);
  });

  it('carries a deadline over a weekend that holds the spring transition', () => {
    const office = calendar(ZONE, weekdays(NINE_TO_FIVE));
    // Friday 16:00 EST, plus two business hours: Monday 10:00 EDT.
    expect(addBusinessTime(at('2026-03-06T21:00:00Z'), 2 * HOUR, office)).toEqual(
      at('2026-03-09T14:00:00Z'),
    );
    expect(
      businessTimeBetween(at('2026-03-06T21:00:00Z'), at('2026-03-09T14:00:00Z'), office),
    ).toBe(2 * HOUR);
  });

  it('counts real elapsed time across a transition inside business hours', () => {
    const desk = calendar(ZONE, everyDay(WHOLE_DAY));
    expect(businessTimeBetween(at('2026-03-08T05:00:00Z'), at('2026-03-09T04:00:00Z'), desk)).toBe(
      23 * HOUR,
    );
    expect(businessTimeBetween(at('2026-11-01T04:00:00Z'), at('2026-11-02T05:00:00Z'), desk)).toBe(
      25 * HOUR,
    );
    const night = calendar(ZONE, everyDay([{ start: '01:00', end: '04:00' }]));
    expect(businessTimeBetween(at('2026-03-07T00:00:00Z'), at('2026-03-10T00:00:00Z'), night)).toBe(
      8 * HOUR,
    );
    // 01:00 occurs twice on 1 November; the interval starts at the first (compatible).
    expect(businessTimeBetween(at('2026-11-01T00:00:00Z'), at('2026-11-02T00:00:00Z'), night)).toBe(
      4 * HOUR,
    );
    expect(addBusinessTime(at('2026-03-08T07:30:00Z'), HOUR, night)).toEqual(
      at('2026-03-09T05:30:00Z'),
    );
  });

  it('closes on a holiday', () => {
    const office = calendar(ZONE, weekdays(NINE_TO_FIVE), {
      holidays: [{ date: '2026-11-02' }],
    });
    // Friday 16:00 EDT plus two hours, over the Monday holiday: Tuesday 10:00 EST.
    expect(addBusinessTime(at('2026-10-30T20:00:00Z'), 2 * HOUR, office)).toEqual(
      at('2026-11-03T15:00:00Z'),
    );
  });

  it('closes for a closure, within a day and across midnight', () => {
    const lunch = calendar(ZONE, weekdays(NINE_TO_FIVE), {
      closures: [{ start: '2026-11-03T12:00', end: '2026-11-03T14:00' }],
    });
    expect(businessTimeBetween(at('2026-11-03T14:00:00Z'), at('2026-11-03T22:00:00Z'), lunch)).toBe(
      6 * HOUR,
    );
    expect(addBusinessTime(at('2026-11-03T14:00:00Z'), 4 * HOUR, lunch)).toEqual(
      at('2026-11-03T20:00:00Z'),
    );
    const overnight = calendar(ZONE, weekdays(NINE_TO_FIVE), {
      closures: [{ start: '2026-11-03T16:00', end: '2026-11-04T10:00' }],
    });
    expect(
      businessTimeBetween(at('2026-11-03T05:00:00Z'), at('2026-11-05T05:00:00Z'), overnight),
    ).toBe(14 * HOUR);
  });

  it('answers the start for no time, wherever it falls', () => {
    const office = calendar(ZONE, weekdays(NINE_TO_FIVE));
    expect(addBusinessTime(at('2026-11-08T03:00:00Z'), 0, office)).toEqual(
      at('2026-11-08T03:00:00Z'),
    );
  });

  it('lands on the end of an interval when the time runs out there', () => {
    const office = calendar(ZONE, weekdays(NINE_TO_FIVE));
    expect(addBusinessTime(at('2026-11-02T14:00:00Z'), 8 * HOUR, office)).toEqual(
      at('2026-11-02T22:00:00Z'),
    );
  });
});

describe('Europe/London', () => {
  const ZONE = 'Europe/London';

  it("reads the runtime's 2026 offsets first", () => {
    expectOffsets(ZONE, [
      ['2026-03-29T00:59:00Z', '+00:00'],
      ['2026-03-29T01:00:00Z', '+01:00'],
      ['2026-10-25T00:59:00Z', '+01:00'],
      ['2026-10-25T01:00:00Z', '+00:00'],
    ]);
  });

  it('counts a night desk across both transitions', () => {
    const desk = calendar(ZONE, everyDay([{ start: '00:00', end: '03:00' }]));
    expect(businessTimeBetween(at('2026-03-28T23:00:00Z'), at('2026-03-29T12:00:00Z'), desk)).toBe(
      2 * HOUR,
    );
    expect(addBusinessTime(at('2026-03-29T00:00:00Z'), 2 * HOUR, desk)).toEqual(
      at('2026-03-29T02:00:00Z'),
    );
    expect(addBusinessTime(at('2026-03-29T00:00:00Z'), 2 * HOUR + MINUTE, desk)).toEqual(
      at('2026-03-29T23:01:00Z'),
    );
    expect(businessTimeBetween(at('2026-10-24T22:00:00Z'), at('2026-10-25T12:00:00Z'), desk)).toBe(
      4 * HOUR,
    );
  });
});

describe('Asia/Kolkata', () => {
  const ZONE = 'Asia/Kolkata';

  it("reads the runtime's offset first: +05:30 all year", () => {
    expectOffsets(ZONE, [
      ['2026-01-15T00:00:00Z', '+05:30'],
      ['2026-07-15T00:00:00Z', '+05:30'],
    ]);
  });

  it('works a half-hour offset', () => {
    const office = calendar(ZONE, weekdays(NINE_TO_FIVE));
    expect(addBusinessTime(at('2026-11-02T03:30:00Z'), 8 * HOUR, office)).toEqual(
      at('2026-11-02T11:30:00Z'),
    );
    expect(addBusinessTime(at('2026-11-02T03:30:00Z'), 9 * HOUR, office)).toEqual(
      at('2026-11-03T04:30:00Z'),
    );
    expect(
      businessTimeBetween(at('2026-10-30T11:00:00Z'), at('2026-11-02T04:00:00Z'), office),
    ).toBe(HOUR);
  });
});

describe('Australia/Lord_Howe', () => {
  const ZONE = 'Australia/Lord_Howe';

  it("reads the runtime's 2026 offsets first: a 30-minute shift", () => {
    expectOffsets(ZONE, [
      ['2026-04-04T14:59:00Z', '+11:00'],
      ['2026-04-04T15:00:00Z', '+10:30'],
      ['2026-10-03T15:29:00Z', '+10:30'],
      ['2026-10-03T15:30:00Z', '+11:00'],
    ]);
  });

  it('gives its transition days 23.5 and 24.5 hours', () => {
    const desk = calendar(ZONE, everyDay(WHOLE_DAY));
    expect(businessTimeBetween(at('2026-10-03T13:30:00Z'), at('2026-10-04T13:00:00Z'), desk)).toBe(
      23.5 * HOUR,
    );
    expect(businessTimeBetween(at('2026-04-04T13:00:00Z'), at('2026-04-05T13:30:00Z'), desk)).toBe(
      24.5 * HOUR,
    );
  });

  it('starts an interval whose start is skipped at the first valid time after the gap', () => {
    const desk = calendar(ZONE, everyDay([{ start: '02:00', end: '03:00' }]));
    expect(businessTimeBetween(at('2026-10-03T12:00:00Z'), at('2026-10-03T20:00:00Z'), desk)).toBe(
      30 * MINUTE,
    );
  });
});

describe('Pacific/Chatham', () => {
  const ZONE = 'Pacific/Chatham';

  it("reads the runtime's 2026 offsets first: +12:45 and +13:45", () => {
    expectOffsets(ZONE, [
      ['2026-04-04T13:59:00Z', '+13:45'],
      ['2026-04-04T14:00:00Z', '+12:45'],
      ['2026-09-26T13:59:00Z', '+12:45'],
      ['2026-09-26T14:00:00Z', '+13:45'],
    ]);
  });

  it('works a 45-minute offset and its transition days', () => {
    const office = calendar(ZONE, weekdays(NINE_TO_FIVE));
    expect(addBusinessTime(at('2026-11-01T19:15:00Z'), HOUR, office)).toEqual(
      at('2026-11-01T20:15:00Z'),
    );
    const desk = calendar(ZONE, everyDay(WHOLE_DAY));
    expect(businessTimeBetween(at('2026-09-26T11:15:00Z'), at('2026-09-27T10:15:00Z'), desk)).toBe(
      23 * HOUR,
    );
    expect(businessTimeBetween(at('2026-04-04T10:15:00Z'), at('2026-04-05T11:15:00Z'), desk)).toBe(
      25 * HOUR,
    );
  });
});

describe('America/Havana: a zone that changes at midnight', () => {
  const ZONE = 'America/Havana';

  it("reads the runtime's 2026 and 2027 offsets first", () => {
    expectOffsets(ZONE, [
      ['2026-03-08T04:59:00Z', '-05:00'],
      ['2026-03-08T05:00:00Z', '-04:00'],
      ['2026-11-01T04:59:00Z', '-04:00'],
      ['2026-11-01T05:00:00Z', '-05:00'],
      ['2027-03-14T04:59:00Z', '-05:00'],
      ['2027-03-14T05:00:00Z', '-04:00'],
      ['2027-11-07T04:59:00Z', '-04:00'],
      ['2027-11-07T05:00:00Z', '-05:00'],
    ]);
    expect(Temporal.Instant.from('2026-03-08T05:00:00Z').toZonedDateTimeISO(ZONE).hour).toBe(1);
  });

  it('starts a day whose midnight is skipped at 01:00, and counts its repeated hour', () => {
    const desk = calendar(ZONE, everyDay(WHOLE_DAY));
    expect(businessTimeBetween(at('2026-03-07T05:00:00Z'), at('2026-03-08T05:00:00Z'), desk)).toBe(
      24 * HOUR,
    );
    expect(businessTimeBetween(at('2026-03-08T05:00:00Z'), at('2026-03-09T04:00:00Z'), desk)).toBe(
      23 * HOUR,
    );
    expect(businessTimeBetween(at('2026-11-01T04:00:00Z'), at('2026-11-02T05:00:00Z'), desk)).toBe(
      25 * HOUR,
    );
  });

  it('refuses a calendar with a boundary at midnight, naming the dates', () => {
    expect(
      calendarProblems(calendar(ZONE, everyDay(WHOLE_DAY)), at('2026-01-15T12:00:00Z')),
    ).toEqual([
      { reason: 'boundary-in-gap', dates: ['2026-03-08', '2027-03-14'] },
      { reason: 'boundary-repeated', dates: ['2026-11-01', '2027-11-07'] },
    ]);
  });

  it('passes a calendar whose boundaries avoid midnight', () => {
    expect(
      calendarProblems(calendar(ZONE, weekdays(NINE_TO_FIVE)), at('2026-01-15T12:00:00Z')),
    ).toEqual([]);
  });
});

describe('calendar validation (C133.3: reject, over the next two years)', () => {
  const ZONE = 'America/New_York';
  const NOW = at('2026-01-15T12:00:00Z');

  it('passes office hours', () => {
    expect(calendarProblems(calendar(ZONE, weekdays(NINE_TO_FIVE)), NOW)).toEqual([]);
  });

  it('refuses a boundary in a gap and one in a repeat, each with its dates', () => {
    expect(
      calendarProblems(calendar(ZONE, everyDay([{ start: '02:30', end: '05:00' }])), NOW),
    ).toEqual([{ reason: 'boundary-in-gap', dates: ['2026-03-08', '2027-03-14'] }]);
    expect(
      calendarProblems(calendar(ZONE, everyDay([{ start: '01:30', end: '05:00' }])), NOW),
    ).toEqual([{ reason: 'boundary-repeated', dates: ['2026-11-01', '2027-11-07'] }]);
  });

  it('reads a closed day as having no boundary', () => {
    expect(
      calendarProblems(
        calendar(ZONE, everyDay([{ start: '02:30', end: '05:00' }]), {
          holidays: [{ date: '2026-03-08' }],
        }),
        NOW,
      ),
    ).toEqual([{ reason: 'boundary-in-gap', dates: ['2027-03-14'] }]);
    expect(
      calendarProblems(calendar(ZONE, weekdays([{ start: '02:30', end: '05:00' }])), NOW),
    ).toEqual([]);
  });

  it('reads the two years from the local date of now', () => {
    expect(
      calendarProblems(
        calendar(ZONE, everyDay([{ start: '02:30', end: '05:00' }])),
        at('2026-03-20T12:00:00Z'),
      ),
    ).toEqual([{ reason: 'boundary-in-gap', dates: ['2027-03-14', '2028-03-12'] }]);
  });

  it('refuses a closure boundary in a gap inside the two years, and ignores one after them', () => {
    expect(
      calendarProblems(
        calendar(ZONE, weekdays(NINE_TO_FIVE), {
          closures: [{ start: '2026-03-08T02:30', end: '2026-03-08T04:00' }],
        }),
        NOW,
      ),
    ).toEqual([{ reason: 'boundary-in-gap', dates: ['2026-03-08'] }]);
    expect(
      calendarProblems(
        calendar(ZONE, weekdays(NINE_TO_FIVE), {
          closures: [{ start: '2030-03-10T02:30', end: '2030-03-10T04:00' }],
        }),
        NOW,
      ),
    ).toEqual([]);
  });

  it('refuses a zone the runtime does not know, and names no date', () => {
    expect(calendarProblems(calendar('Mars/Olympus_Mons', weekdays(NINE_TO_FIVE)), NOW)).toEqual([
      { reason: 'time-zone-unknown', dates: [] },
    ]);
  });
});

describe('what cannot be computed', () => {
  const office = calendar('America/New_York', weekdays(NINE_TO_FIVE));

  it('refuses a zone the runtime does not know', () => {
    const unknown = calendar('Mars/Olympus_Mons', weekdays(NINE_TO_FIVE));
    expect(() => addBusinessTime(at('2026-11-02T14:00:00Z'), HOUR, unknown)).toThrow(
      new BusinessTimeError('business_time_zone_unknown'),
    );
  });

  it.each([
    ['a negative time', at('2026-11-02T14:00:00Z'), -1],
    ['a time that is not a number', at('2026-11-02T14:00:00Z'), Number.NaN],
    ['an unending time', at('2026-11-02T14:00:00Z'), Number.POSITIVE_INFINITY],
    ['a start that is no instant', new Date(Number.NaN), HOUR],
  ])('refuses %s', (_name, start, ms) => {
    expect(() => addBusinessTime(start, ms, office)).toThrow(
      new BusinessTimeError('business_time_invalid'),
    );
    expect(() => addBusinessTime(start, ms, null)).toThrow(
      new BusinessTimeError('business_time_invalid'),
    );
  });

  it('refuses an instant that is not one, and a calendar time that is no time', () => {
    expect(() =>
      businessTimeBetween(new Date(Number.NaN), at('2026-11-02T14:00:00Z'), office),
    ).toThrow(new BusinessTimeError('business_time_invalid'));
    const broken = calendar('America/New_York', weekdays([{ start: '9am', end: '17:00' }]));
    expect(() => addBusinessTime(at('2026-11-02T14:00:00Z'), HOUR, broken)).toThrow(
      new BusinessTimeError('business_time_invalid'),
    );
  });

  it('stops after 3,660 days with no business time', () => {
    const shut = calendar('America/New_York', weekdays(NINE_TO_FIVE), {
      closures: [{ start: '2026-01-01T00:00', end: '2040-01-01T00:00' }],
    });
    expect(() => addBusinessTime(at('2026-02-02T14:00:00Z'), MINUTE, shut)).toThrow(
      new BusinessTimeError('business_time_scan_exceeded'),
    );
    expect(() =>
      businessTimeBetween(at('2026-01-01T00:00:00Z'), at('2037-01-01T00:00:00Z'), office),
    ).toThrow(new BusinessTimeError('business_time_scan_exceeded'));
  });

  it('quotes nothing of the calendar in its error', () => {
    const error = new BusinessTimeError('business_time_invalid');
    expect(error.message).toBe('business_time_invalid');
    expect(error.name).toBe('BusinessTimeError');
  });
});

describe('local times resolved against Temporal itself (a differential test)', () => {
  const ZONES = [
    'America/New_York',
    'Europe/London',
    'Asia/Kolkata',
    'Australia/Lord_Howe',
    'Pacific/Chatham',
    'America/Havana',
    'America/Santiago',
  ];
  /** Every quarter hour of the days around each 2026 transition, and of two ordinary days. */
  const DATES = [
    '2026-01-15',
    '2026-03-07',
    '2026-03-08',
    '2026-03-29',
    '2026-04-04',
    '2026-04-05',
    '2026-07-15',
    '2026-09-06',
    '2026-09-27',
    '2026-10-04',
    '2026-10-25',
    '2026-11-01',
  ];

  it.each(ZONES)('%s', (zone) => {
    const mismatches: string[] = [];
    for (const date of DATES) {
      for (let minute = 0; minute < 24 * 60; minute += 15) {
        const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
        const local = `${date}T${time}`;
        const plain = Temporal.PlainDateTime.from(local);
        const compatible = plain.toZonedDateTime(zone, { disambiguation: 'compatible' });
        const earlier = plain.toZonedDateTime(zone, { disambiguation: 'earlier' });
        const later = plain.toZonedDateTime(zone, { disambiguation: 'later' });
        const fold =
          earlier.epochMilliseconds === later.epochMilliseconds
            ? null
            : earlier.toPlainDateTime().equals(plain)
              ? 'repeat'
              : 'gap';
        const resolved = resolveLocalTime(zone, local);
        if (resolved.instant.getTime() !== compatible.epochMilliseconds || resolved.fold !== fold) {
          mismatches.push(local);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });
});

/** mulberry32: a seeded generator, so a failing case can be replayed from its seed. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

describe('properties (C133.3), over seeded random starts in 2026 and 2027', () => {
  const CALENDARS: readonly (readonly [string, BusinessCalendar | null])[] = [
    ['24x7', null],
    [
      'New York, split day',
      calendar(
        'America/New_York',
        weekdays([
          { start: '09:00', end: '12:00' },
          { start: '13:00', end: '17:30' },
        ]),
        {
          holidays: [{ date: '2026-07-03' }, { date: '2026-12-25' }],
          closures: [{ start: '2026-11-25T13:00', end: '2026-11-27T12:00' }],
        },
      ),
    ],
    ['Havana, whole days', calendar('America/Havana', everyDay(WHOLE_DAY))],
    [
      'Lord Howe, nights',
      calendar(
        'Australia/Lord_Howe',
        everyDay([
          { start: '01:00', end: '03:00' },
          { start: '22:00', end: '24:00' },
        ]),
      ),
    ],
    [
      'Chatham, weekdays',
      calendar('Pacific/Chatham', weekdays([{ start: '08:00', end: '18:00' }])),
    ],
    [
      'London, early hours',
      calendar('Europe/London', everyDay([{ start: '00:00', end: '03:00' }])),
    ],
    ['Kolkata, office', calendar('Asia/Kolkata', weekdays(NINE_TO_FIVE))],
  ];
  const FROM = Date.UTC(2026, 0, 1);
  const SPAN = Date.UTC(2027, 11, 31) - FROM;
  const SAMPLES = 150;

  it.each(CALENDARS)('%s', (_name, business) => {
    const random = generator(0x0c133);
    const failures: string[] = [];
    for (let sample = 0; sample < SAMPLES; sample += 1) {
      const start = new Date(FROM + Math.floor(random() * SPAN));
      const ms = Math.floor(random() * 30 * HOUR);
      const more = Math.floor(random() * 10 * HOUR);
      const end = addBusinessTime(start, ms, business);
      const later = addBusinessTime(start, ms + more, business);
      const label = `${start.toISOString()} +${String(ms)} +${String(more)}`;
      // Adding then measuring returns the input.
      if (businessTimeBetween(start, end, business) !== ms) {
        failures.push(`round trip ${label}`);
      }
      // The answer is the first such instant.
      if (ms > 0 && businessTimeBetween(start, new Date(end.getTime() - 1), business) !== ms - 1) {
        failures.push(`first instant ${label}`);
      }
      // Adding is monotonic, never before the start, and composes.
      if (end < start || later < end) {
        failures.push(`monotonic ${label}`);
      }
      if (addBusinessTime(end, more, business).getTime() !== later.getTime()) {
        failures.push(`composes ${label}`);
      }
      // Measuring is monotonic and additive.
      const middle = new Date(start.getTime() + Math.floor(random() * 4 * DAY));
      const last = new Date(middle.getTime() + Math.floor(random() * 4 * DAY));
      const first = businessTimeBetween(start, middle, business);
      const second = businessTimeBetween(middle, last, business);
      const whole = businessTimeBetween(start, last, business);
      if (first < 0 || second < 0 || whole !== first + second || whole < first) {
        failures.push(`additive ${label}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
