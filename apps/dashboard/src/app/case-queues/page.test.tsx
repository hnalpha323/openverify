import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/toasts';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { CASE_IDS, assignmentPolicy, caseQueue } from '../../testing/cases-fixtures';
import { fakeRequest } from '../../testing/fake-request';
import {
  CASE_DEVELOPER,
  CASE_QUEUES_PATH,
  CASE_VIEWER,
  serveAssignmentPolicies,
  serveCaseQueues,
} from '../../testing/routes/cases';
import CaseQueuesPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
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
  serveAssignmentPolicies(api, [assignmentPolicy()]);
});

afterEach(() => {
  api.restore();
});

const page = async (params: Record<string, string> = {}) =>
  render(
    <ToastProvider>
      {await CaseQueuesPage({ searchParams: Promise.resolve(params) })}
    </ToastProvider>,
  );

describe('the case queues (C132.1, C142.1)', () => {
  it('lists each queue with its members, how many are paused, and the policy that assigns its cases', async () => {
    expect(metadata.title).toBe('Case queues');
    serveCaseQueues(api, [
      caseQueue(),
      caseQueue({
        id: CASE_IDS.otherQueue,
        name: 'Synthetic escalations',
        status: 'archived',
        members: [],
        policyId: null,
      }),
    ]);

    await page();

    const table = screen.getByRole('table', { name: 'Case queues' });
    const first = within(
      within(table)
        .getByRole('rowheader', { name: 'Synthetic first line' })
        .closest('tr') as HTMLElement,
    );
    expect(first.getByRole('link', { name: 'Synthetic first line' })).toHaveAttribute(
      'href',
      `/case-queues/${CASE_IDS.queue}`,
    );
    expect(first.getByText('2 members, 1 paused')).toBeVisible();
    expect(first.getByText('Synthetic round robin')).toBeVisible();
    const archived = within(
      within(table)
        .getByRole('rowheader', { name: 'Synthetic escalations' })
        .closest('tr') as HTMLElement,
    );
    expect(archived.getByText('Archived')).toBeVisible();
    expect(archived.getByText('No members')).toBeVisible();
    expect(archived.getByText('None: pulled or assigned by hand')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Assignment policies' })).toHaveAttribute(
      'href',
      '/case-queues/policies',
    );
    expect(Object.fromEntries(api.find('GET', CASE_QUEUES_PATH)?.query ?? [])).toEqual({
      'page[size]': '25',
    });
    expect(screen.queryByRole('form', { name: 'Create a queue' })).toBeNull();
  });

  it('offers creation with case-queues:write', async () => {
    api.me({ permissions: CASE_DEVELOPER });
    serveCaseQueues(api, []);

    await page();

    expect(screen.getByRole('heading', { name: 'No queues yet' })).toBeVisible();
    const create = screen.getByRole('form', { name: 'Create a queue' });
    expect(within(create).getByRole('textbox', { name: /^Name/u })).toBeRequired();
  });

  it('shows the forbidden panel without case-queues:read', async () => {
    api.me({ permissions: ['cases:read'] });

    await page();

    expect(screen.getByRole('heading', { name: 'You do not have access' })).toBeVisible();
  });
});
