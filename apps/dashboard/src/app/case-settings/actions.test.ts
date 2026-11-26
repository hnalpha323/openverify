// @vitest-environment node
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { ENVIRONMENTS } from '../../testing/api-mock';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { CASE_IDS, caseCalendar, slaPolicy } from '../../testing/cases-fixtures';
import { fakeRequest } from '../../testing/fake-request';
import { CASE_DEVELOPER } from '../../testing/routes/cases';
import {
  createCalendar,
  createSlaPolicy,
  importHolidays,
  updateCalendar,
  updateSlaPolicy,
} from './actions';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const POLICY = `/case-sla-policies/${CASE_IDS.slaPolicy}`;
const CALENDAR = `/case-calendars/${CASE_IDS.calendar}`;
let api: RouteApi;

beforeEach(() => {
  vi.mocked(revalidatePath).mockReset();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: CASE_DEVELOPER });
});

afterEach(() => {
  api.restore();
});

const form = (fields: Record<string, string | File>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.append(name, value);
  }
  return data;
};
const environment = { 'environment-id': ENVIRONMENTS.sandbox.id };
const weekdays = {
  monday: '09:00-12:00, 13:00-17:00',
  tuesday: '09:00-17:00',
  wednesday: '09:00-17:00',
  thursday: '09:00-17:00',
  friday: '09:00-24:00',
  saturday: '',
  sunday: ' ',
};
const nineToFive = [{ start: '09:00', end: '17:00' }];

describe('SLA policy actions (C133.1, C142.1)', () => {
  it('creates a policy around the clock when no calendar is chosen', async () => {
    api.on('POST', '/case-sla-policies', 201, { data: slaPolicy({ calendarId: null }) });

    expect(
      await createSlaPolicy(
        null,
        form({
          ...environment,
          name: 'Synthetic four hours',
          'target-minutes': '240',
          'case-calendar-id': '',
          'on-reopen': 'restart',
        }),
      ),
    ).toEqual({ ok: true, data: { id: CASE_IDS.slaPolicy } });
    expect(api.find('POST', '/case-sla-policies')?.body).toEqual({
      data: {
        type: 'case-sla-policy',
        attributes: {
          name: 'Synthetic four hours',
          'target-minutes': 240,
          'case-calendar-id': null,
          'on-reopen': 'restart',
        },
      },
    });
  });

  it('updates a policy, and refuses a target out of range at its field without asking', async () => {
    api.on('PATCH', POLICY, 200, { data: slaPolicy() });
    const fields = {
      'case-sla-policy-id': CASE_IDS.slaPolicy,
      name: 'Synthetic',
      'case-calendar-id': CASE_IDS.calendar,
      'on-reopen': 'continue',
    };

    expect((await updateSlaPolicy(null, form({ ...fields, 'target-minutes': '480' }))).ok).toBe(
      true,
    );
    expect(revalidatePath).toHaveBeenCalledWith(
      `/case-settings/sla-policies/${CASE_IDS.slaPolicy}`,
    );
    expect(await updateSlaPolicy(null, form({ ...fields, 'target-minutes': '0' }))).toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/data/attributes/target-minutes' }] },
    });
    expect(api.all('PATCH', POLICY)).toHaveLength(1);
  });
});

describe('calendar actions (C133.2, C142.1)', () => {
  it('creates a calendar from each day’s intervals as typed, an empty day closed', async () => {
    api.on('POST', '/case-calendars', 201, { data: caseCalendar() });

    expect(
      await createCalendar(
        null,
        form({
          ...environment,
          name: 'Synthetic office',
          'time-zone': 'Europe/London',
          ...weekdays,
        }),
      ),
    ).toEqual({ ok: true, data: { id: CASE_IDS.calendar } });
    expect(api.find('POST', '/case-calendars')?.body).toEqual({
      data: {
        type: 'case-calendar',
        attributes: {
          name: 'Synthetic office',
          'time-zone': 'Europe/London',
          week: {
            monday: [
              { start: '09:00', end: '12:00' },
              { start: '13:00', end: '17:00' },
            ],
            tuesday: nineToFive,
            wednesday: nineToFive,
            thursday: nineToFive,
            friday: [{ start: '09:00', end: '24:00' }],
            saturday: [],
            sunday: [],
          },
        },
      },
    });
  });

  it('saves the week and the holidays by line, and refuses an interval typed wrong at its day', async () => {
    api.on('PATCH', CALENDAR, 200, { data: caseCalendar() });
    const fields = {
      'case-calendar-id': CASE_IDS.calendar,
      name: 'Synthetic office',
      'time-zone': 'Europe/London',
      ...weekdays,
      holidays: '2026-12-25 Synthetic closing day\n\n2027-01-01  Synthetic new year\n',
    };

    expect((await updateCalendar(null, form(fields))).ok).toBe(true);
    expect(api.find('PATCH', CALENDAR)?.body).toMatchObject({
      data: {
        attributes: {
          holidays: [
            { date: '2026-12-25', label: 'Synthetic closing day' },
            { date: '2027-01-01', label: 'Synthetic new year' },
          ],
        },
      },
    });

    expect(await updateCalendar(null, form({ ...fields, tuesday: 'nine to five' }))).toMatchObject({
      ok: false,
      problem: {
        errors: [
          {
            pointer: '/data/attributes/week/tuesday',
            detail: 'Write each interval as HH:MM-HH:MM, separated by commas.',
          },
        ],
      },
    });
    expect(api.all('PATCH', CALENDAR)).toHaveLength(1);
  });

  it('names the dates of the two-year check when the week falls in a daylight-saving change', async () => {
    api.onProblem('PATCH', CALENDAR, 422, undefined, {
      code: 'calendar_invalid',
      detail: 'A boundary falls in a gap or a repeat.',
      dates: ['2027-03-28', '2027-10-31'],
    });

    const result = await updateCalendar(
      null,
      form({
        'case-calendar-id': CASE_IDS.calendar,
        name: 'Synthetic office',
        'time-zone': 'Europe/London',
        ...weekdays,
        holidays: '',
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      problem: {
        title: 'The calendar cannot be saved.',
        detail:
          'Over the next two years, a boundary of the business hours falls in a daylight-saving gap or repeat of the time zone on these dates: 2027-03-28, 2027-10-31. Move the boundary off the change, or choose another zone.',
      },
    });
  });

  it('imports holidays from a CSV file and answers what was taken and each refused row by number and code', async () => {
    api.on('POST', `${CALENDAR}/holidays/import`, 200, {
      data: caseCalendar(),
      meta: {
        'imported-count': 2,
        refused: [
          { row: 3, code: 'invalid_value' },
          { row: 5, code: 'date_repeated' },
        ],
      },
    });
    const csv = 'date,label\n2027-01-01,Synthetic\n2027-13-01,Synthetic\n';

    const result = await importHolidays(
      null,
      form({
        'case-calendar-id': CASE_IDS.calendar,
        file: new File([csv], 'holidays.csv', { type: 'text/csv' }),
        replace: 'on',
      }),
    );

    expect(result).toEqual({
      ok: true,
      data: {
        imported: 2,
        refused: [
          { row: 3, code: 'invalid_value' },
          { row: 5, code: 'date_repeated' },
        ],
      },
    });
    expect(api.find('POST', `${CALENDAR}/holidays/import`)?.body).toEqual({
      data: { type: 'case-calendar', attributes: { csv, replace: true } },
    });
  });

  it('refuses an empty file without asking, and says a refused file’s codes in words', async () => {
    expect(
      await importHolidays(
        null,
        form({ 'case-calendar-id': CASE_IDS.calendar, file: new File([], 'empty.csv') }),
      ),
    ).toMatchObject({ ok: false, problem: { errors: [{ pointer: '/data/attributes/csv' }] } });

    api.onProblem('POST', `${CALENDAR}/holidays/import`, 422, undefined, {
      errors: [{ pointer: '/data/attributes/csv', detail: 'missing_column' }],
    });
    expect(
      await importHolidays(
        null,
        form({ 'case-calendar-id': CASE_IDS.calendar, file: new File(['when,what\n'], 'x.csv') }),
      ),
    ).toMatchObject({
      ok: false,
      problem: {
        errors: [
          {
            pointer: '/data/attributes/csv',
            detail: 'The header needs a date column and a label column: date,label.',
          },
        ],
      },
    });
  });
});
