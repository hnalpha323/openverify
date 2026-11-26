import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/toasts';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { CASE_IDS, caseCalendar, slaPolicy } from '../../testing/cases-fixtures';
import { fakeRequest } from '../../testing/fake-request';
import {
  CASE_CALENDARS_PATH,
  CASE_DEVELOPER,
  CASE_SLA_POLICIES_PATH,
  CASE_VIEWER,
  serveCalendar,
  serveCalendars,
  serveSlaPolicies,
  serveSlaPolicy,
} from '../../testing/routes/cases';
import CalendarPage from './calendars/[id]/page';
import CaseSettingsPage, { metadata } from './page';
import SlaPolicyPage from './sla-policies/[id]/page';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: CASE_VIEWER });
  serveCalendars(api, [caseCalendar()]);
});

afterEach(() => {
  api.restore();
});

const settings = async (params: Record<string, string> = {}) =>
  render(
    <ToastProvider>
      {await CaseSettingsPage({ searchParams: Promise.resolve(params) })}
    </ToastProvider>,
  );

describe('SLA policies and calendars (C133, C142.1)', () => {
  it('lists the SLA policies and the calendars in words, each list with its own cursor', async () => {
    expect(metadata.title).toBe('SLA and calendars');
    serveSlaPolicies(
      api,
      [
        slaPolicy(),
        slaPolicy({
          id: 'cslap_01JE0000000000000000000002',
          name: 'Synthetic ninety minutes',
          calendarId: null,
          targetMinutes: 90,
        }),
      ],
      `/api/v1/case-sla-policies?page[after]=${CASE_IDS.slaPolicy}`,
    );

    await settings({ 'calendars-after': CASE_IDS.calendar });

    const policies = screen.getByRole('table', { name: 'SLA policies' });
    expect(within(policies).getByRole('link', { name: 'Synthetic four hours' })).toHaveAttribute(
      'href',
      `/case-settings/sla-policies/${CASE_IDS.slaPolicy}`,
    );
    expect(policies).toHaveTextContent('4 business hours (240 minutes)');
    expect(policies).toHaveTextContent('1 business hour 30 minutes (90 minutes)');
    expect(policies).toHaveTextContent('Synthetic London office');
    expect(policies).toHaveTextContent('Around the clock (24x7)');
    expect(policies).toHaveTextContent('Continue: the time already used counts');
    expect(policies).toHaveTextContent('Revision 2');
    const calendars = screen.getByRole('table', { name: 'Business calendars' });
    expect(
      within(calendars).getByRole('link', { name: 'Synthetic London office' }),
    ).toHaveAttribute('href', `/case-settings/calendars/${CASE_IDS.calendar}`);
    expect(calendars).toHaveTextContent('Europe/London');
    expect(calendars).toHaveTextContent('40 business hours a week');
    expect(calendars).toHaveTextContent('1 holiday');
    expect(screen.getByRole('navigation', { name: 'SLA policy pages' })).toBeVisible();
    expect(Object.fromEntries(api.find('GET', CASE_CALENDARS_PATH)?.query ?? [])).toEqual({
      'page[after]': CASE_IDS.calendar,
      'page[size]': '25',
    });
    expect(Object.fromEntries(api.find('GET', CASE_SLA_POLICIES_PATH)?.query ?? [])).toEqual({
      'page[size]': '25',
    });
    expect(screen.queryByRole('form', { name: 'Create an SLA policy' })).toBeNull();
    expect(screen.queryByRole('form', { name: 'Create a calendar' })).toBeNull();
  });

  it('offers to create both with case-queues:write, a calendar starting nine to five on weekdays', async () => {
    api.me({ permissions: CASE_DEVELOPER });
    serveSlaPolicies(api, []);

    await settings();

    const policy = screen.getByRole('form', { name: 'Create an SLA policy' });
    expect(
      within(policy).getByRole('spinbutton', { name: /^Target in business minutes/u }),
    ).toBeRequired();
    expect(within(policy).getByRole('combobox', { name: 'Calendar' })).toHaveValue('');
    const calendar = screen.getByRole('form', { name: 'Create a calendar' });
    expect(within(calendar).getByRole('textbox', { name: /^Time zone/u })).toBeRequired();
    expect(within(calendar).getByRole('textbox', { name: /^Monday/u })).toHaveValue('09:00-17:00');
    expect(within(calendar).getByRole('textbox', { name: /^Sunday/u })).toHaveValue('');
  });

  it('shows the forbidden panel without case-queues:read', async () => {
    api.me({ permissions: ['cases:read'] });

    await settings();

    expect(screen.getByRole('heading', { name: 'You do not have access' })).toBeVisible();
  });
});

describe('one SLA policy and one calendar (C133, C142.1)', () => {
  it('edits an SLA policy with case-queues:write, its calendar named', async () => {
    api.me({ permissions: CASE_DEVELOPER });
    serveSlaPolicy(api, slaPolicy());

    render(
      <ToastProvider>
        {await SlaPolicyPage({ params: Promise.resolve({ id: CASE_IDS.slaPolicy }) })}
      </ToastProvider>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Synthetic four hours' })).toBeVisible();
    expect(screen.getByText(/A case pins the revision its SLA started under/u)).toBeVisible();
    const form = screen.getByRole('form', { name: 'Edit the SLA policy' });
    expect(
      within(form).getByRole('spinbutton', { name: /^Target in business minutes/u }),
    ).toHaveValue(240);
    expect(within(form).getByRole('combobox', { name: 'Calendar' })).toHaveValue(CASE_IDS.calendar);
    expect(within(form).getByRole('combobox', { name: 'When a case reopens' })).toHaveValue(
      'continue',
    );
  });

  it('edits a calendar’s week and holidays, and imports holidays from a CSV', async () => {
    api.me({ permissions: CASE_DEVELOPER });
    serveCalendar(api, caseCalendar());

    render(
      <ToastProvider>
        {await CalendarPage({ params: Promise.resolve({ id: CASE_IDS.calendar }) })}
      </ToastProvider>,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Synthetic London office' }),
    ).toBeVisible();
    const form = screen.getByRole('form', { name: 'Edit the calendar' });
    expect(within(form).getByRole('textbox', { name: /^Friday/u })).toHaveValue('09:00-17:00');
    expect(within(form).getByRole('textbox', { name: /^Saturday/u })).toHaveValue('');
    expect(within(form).getByRole('textbox', { name: /^Holidays/u })).toHaveValue(
      '2026-12-25 Synthetic closing day',
    );
    const holidays = screen.getByRole('form', { name: 'Import holidays' });
    expect(within(holidays).getByLabelText(/^CSV file/u)).toHaveAttribute('type', 'file');
    expect(
      within(holidays).getByRole('checkbox', { name: /^Replace every holiday/u }),
    ).not.toBeChecked();
  });

  it('shows a calendar read-only to a reader', async () => {
    serveCalendar(api, caseCalendar());

    render(
      <ToastProvider>
        {await CalendarPage({ params: Promise.resolve({ id: CASE_IDS.calendar }) })}
      </ToastProvider>,
    );

    expect(screen.queryByRole('form', { name: 'Edit the calendar' })).toBeNull();
    const week = screen.getByRole('table', { name: 'Business hours' });
    expect(
      within(week).getByRole('rowheader', { name: 'Saturday' }).closest('tr'),
    ).toHaveTextContent('Closed');
    expect(screen.getByRole('table', { name: 'Holidays' })).toHaveTextContent('2026-12-25');
  });
});
