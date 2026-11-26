import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/toasts';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { IDS, SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import {
  CASE_IDS,
  CASE_NOTE_VALUE,
  caseQueue,
  caseResource,
  caseTemplate,
} from '../../testing/cases-fixtures';
import { fakeRequest } from '../../testing/fake-request';
import {
  CASES_PATH,
  CASE_ADMIN,
  CASE_REVIEWER,
  CASE_VIEWER,
  serveCaseQueues,
  serveCaseTemplates,
  serveCases,
} from '../../testing/routes/cases';
import CasesPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

let api: RouteApi;

beforeEach(() => {
  window.localStorage.clear();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  serveCaseTemplates(api, [caseTemplate()]);
  serveCaseQueues(api, [caseQueue()]);
});

afterEach(() => {
  api.restore();
});

const page = async (params: Record<string, string> = {}) =>
  render(
    <ToastProvider>{await CasesPage({ searchParams: Promise.resolve(params) })}</ToastProvider>,
  );

describe('the case list (C129.5, C142.1)', () => {
  it('lists each case with its status, category, template, queue, assignee and SLA in words, never a field', async () => {
    expect(metadata.title).toBe('Cases');
    api.me({ permissions: CASE_REVIEWER });
    serveCases(
      api,
      [
        caseResource({ slaState: 'running', assigneeId: IDS.user }),
        caseResource({
          id: CASE_IDS.otherCase,
          name: 'KYC-7',
          status: 'approved',
          category: 'end',
          resolution: 'Approved',
          queueId: null,
          slaState: 'expired',
        }),
      ],
      `/api/v1/cases?page[after]=${CASE_IDS.otherCase}`,
    );

    await page();

    const table = screen.getByRole('table', { name: 'Cases' });
    const first = within(
      within(table).getByRole('rowheader', { name: /KYC-6/u }).closest('tr') as HTMLElement,
    );
    expect(first.getByRole('link', { name: 'KYC-6' })).toHaveAttribute(
      'href',
      `/cases/${CASE_IDS.case}`,
    );
    expect(first.getByText('open')).toBeVisible();
    expect(first.getByText('Initial')).toBeVisible();
    expect(first.getByText('Synthetic KYC review')).toBeVisible();
    expect(first.getByText('Synthetic first line')).toBeVisible();
    expect(first.getByText('You')).toBeVisible();
    expect(first.getByText(/^Running, due /u)).toBeVisible();
    const second = within(
      within(table).getByRole('rowheader', { name: /KYC-7/u }).closest('tr') as HTMLElement,
    );
    expect(second.getByText('End: Approved')).toBeVisible();
    expect(second.getByText('Unassigned')).toBeVisible();
    expect(second.getByText('No queue')).toBeVisible();
    expect(second.getByText(/^Expired, was due /u)).toBeVisible();
    expect(document.body).not.toHaveTextContent(CASE_NOTE_VALUE);
    expect(Object.fromEntries(api.find('GET', CASES_PATH)?.query ?? [])).toEqual({
      'page[size]': '25',
    });
    expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      `/cases?after=${CASE_IDS.otherCase}`,
    );
    expect(screen.getByRole('button', { name: 'Next case' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Notifications' })).toHaveAttribute(
      'href',
      '/cases/notifications',
    );
    expect(screen.getByRole('link', { name: 'Assigned to me' })).toHaveAttribute(
      'href',
      `/cases?assignee=${IDS.user}`,
    );
    expect(screen.getByRole('form', { name: 'Act on the selected cases' })).toBeVisible();
    // A reviewer cannot export (decision 68).
    expect(screen.queryByRole('link', { name: 'Exports' })).toBeNull();
  });

  it('sends the C129.5 filters, and offers the templates and queues as choices', async () => {
    api.me({ permissions: CASE_ADMIN });
    serveCases(api, []);

    await page({
      status: 'pending',
      template: CASE_IDS.template,
      queue: CASE_IDS.queue,
      assignee: CASE_IDS.member,
      category: 'intermediate',
      sla: 'paused',
      account: CASE_IDS.account,
      inquiry: CASE_IDS.inquiry,
      report: 'rep_01JE0000000000000000000001',
      reference: 'synthetic-ref-1',
    });

    expect(Object.fromEntries(api.find('GET', CASES_PATH)?.query ?? [])).toEqual({
      'filter[status]': 'pending',
      'filter[case-template-id]': CASE_IDS.template,
      'filter[case-queue-id]': CASE_IDS.queue,
      'filter[assignee-id]': CASE_IDS.member,
      'filter[status-category]': 'intermediate',
      'filter[sla-state]': 'paused',
      'filter[account-id]': CASE_IDS.account,
      'filter[inquiry-id]': CASE_IDS.inquiry,
      'filter[report-id]': 'rep_01JE0000000000000000000001',
      'filter[reference-id]': 'synthetic-ref-1',
      'page[size]': '25',
    });
    const filters = screen.getByRole('search', { name: 'Filter cases' });
    expect(within(filters).getByRole('combobox', { name: 'Template' })).toHaveValue(
      CASE_IDS.template,
    );
    expect(within(filters).getByRole('combobox', { name: 'Queue' })).toHaveValue(CASE_IDS.queue);
    expect(within(filters).getByRole('combobox', { name: 'SLA' })).toHaveValue('paused');
    expect(screen.getByText('No cases match these filters.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Exports' })).toHaveAttribute('href', '/cases/exports');
  });

  it('asks nothing of the API for a filter it cannot use, and says what to correct', async () => {
    api.me({ permissions: CASE_VIEWER });

    await page({ category: 'closed' });

    expect(screen.getByText('Check the filters')).toBeVisible();
    expect(api.find('GET', CASES_PATH)).toBeUndefined();
  });

  it('offers no next case and no bulk action to a viewer', async () => {
    api.me({ permissions: CASE_VIEWER });
    serveCases(api, [caseResource({ fields: { note: { type: 'string', value: null } } })]);

    await page();

    expect(screen.queryByRole('button', { name: 'Next case' })).toBeNull();
    expect(screen.queryByRole('form', { name: 'Act on the selected cases' })).toBeNull();
  });

  it('shows the forbidden panel without cases:read', async () => {
    api.me({ permissions: ['case-templates:read'] });

    await page();

    expect(screen.getByRole('heading', { name: 'You do not have access' })).toBeVisible();
  });
});
