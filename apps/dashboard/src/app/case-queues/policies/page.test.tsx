import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../components/toasts';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { CASE_IDS, assignmentPolicy } from '../../../testing/cases-fixtures';
import { fakeRequest } from '../../../testing/fake-request';
import {
  CASE_ASSIGNMENT_POLICIES_PATH,
  CASE_DEVELOPER,
  CASE_REVIEWER,
  serveAssignmentPolicies,
  serveAssignmentPolicy,
} from '../../../testing/routes/cases';
import AssignmentPolicyPage from './[id]/page';
import AssignmentPoliciesPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
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
  api.me({ permissions: CASE_REVIEWER });
});

afterEach(() => {
  api.restore();
});

const list = async () =>
  render(
    <ToastProvider>
      {await AssignmentPoliciesPage({ searchParams: Promise.resolve({}) })}
    </ToastProvider>,
  );
const one = async (id: string = CASE_IDS.policy) =>
  render(
    <ToastProvider>
      {await AssignmentPolicyPage({ params: Promise.resolve({ id }) })}
    </ToastProvider>,
  );

describe('the assignment policies (C132.2, C142.1)', () => {
  it('lists each policy with its distribution, order, agents and capacity in words', async () => {
    expect(metadata.title).toBe('Assignment policies');
    serveAssignmentPolicies(api, [
      assignmentPolicy(),
      assignmentPolicy({
        id: 'cap_01JE0000000000000000000002',
        name: 'Synthetic fewest open',
        distribution: 'fewest-open',
        agents: [CASE_IDS.member],
        maxCapacity: null,
      }),
    ]);

    await list();

    const table = screen.getByRole('table', { name: 'Assignment policies' });
    const round = within(
      within(table)
        .getByRole('rowheader', { name: 'Synthetic round robin' })
        .closest('tr') as HTMLElement,
    );
    expect(round.getByRole('link', { name: 'Synthetic round robin' })).toHaveAttribute(
      'href',
      `/case-queues/policies/${CASE_IDS.policy}`,
    );
    expect(round.getByText('Round robin: each eligible agent in turn')).toBeVisible();
    expect(round.getByText('Nearest SLA deadline first')).toBeVisible();
    expect(round.getByText('The members of the queue a case is in')).toBeVisible();
    expect(round.getByText('At most 20 open cases each')).toBeVisible();
    const fewest = within(
      within(table)
        .getByRole('rowheader', { name: 'Synthetic fewest open' })
        .closest('tr') as HTMLElement,
    );
    expect(fewest.getByText('1 named agent')).toBeVisible();
    expect(fewest.getByText('Each member’s own limit')).toBeVisible();
    expect(Object.fromEntries(api.find('GET', CASE_ASSIGNMENT_POLICIES_PATH)?.query ?? [])).toEqual(
      { 'page[size]': '25' },
    );
    expect(screen.queryByRole('form', { name: 'Create an assignment policy' })).toBeNull();
  });

  it('offers creation with case-queues:write', async () => {
    api.me({ permissions: CASE_DEVELOPER });
    serveAssignmentPolicies(api, []);

    await list();

    const create = screen.getByRole('form', { name: 'Create an assignment policy' });
    expect(within(create).getByRole('textbox', { name: /^Name/u })).toBeRequired();
    expect(within(create).getByRole('combobox', { name: 'Distribution' })).toHaveValue(
      'round-robin',
    );
    expect(within(create).getByRole('textbox', { name: /^Sources/u })).toBeRequired();
  });

  it('edits one policy with case-queues:write, its sources in priority order', async () => {
    api.me({ permissions: CASE_DEVELOPER });
    serveAssignmentPolicy(api, assignmentPolicy());

    await one();

    expect(screen.getByRole('heading', { level: 1, name: 'Synthetic round robin' })).toBeVisible();
    const form = screen.getByRole('form', { name: 'Edit the policy' });
    expect(within(form).getByRole('combobox', { name: 'Order of waiting cases' })).toHaveValue(
      'sla-expires-at',
    );
    expect(within(form).getByRole('textbox', { name: /^Agents/u })).toHaveValue('');
    expect(within(form).getByRole('spinbutton', { name: /^Open cases per agent/u })).toHaveValue(
      20,
    );
    expect(within(form).getByRole('textbox', { name: /^Sources/u })).toHaveValue(
      `${CASE_IDS.queue}\n${CASE_IDS.template}`,
    );
  });

  it('shows one policy read-only to a reviewer', async () => {
    serveAssignmentPolicy(api, assignmentPolicy());

    await one();

    expect(screen.queryByRole('form', { name: 'Edit the policy' })).toBeNull();
    expect(screen.getByText('Round robin: each eligible agent in turn')).toBeVisible();
    expect(screen.getByRole('list', { name: 'Sources, in priority order' })).toHaveTextContent(
      CASE_IDS.template,
    );
  });
});
