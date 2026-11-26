import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../components/toasts';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { CASE_IDS, assignmentPolicy, caseQueue } from '../../../testing/cases-fixtures';
import { fakeRequest } from '../../../testing/fake-request';
import {
  CASE_DEVELOPER,
  CASE_REVIEWER,
  serveAssignmentPolicies,
  serveCaseQueue,
} from '../../../testing/routes/cases';
import CaseQueuePage, { metadata } from './page';

/** The `index`th of `items`, or a failure naming it. */
function nth(items: readonly HTMLElement[], index: number): HTMLElement {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`No item ${String(index)}`);
  }
  return item;
}

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  serveAssignmentPolicies(api, [assignmentPolicy()]);
});

afterEach(() => {
  api.restore();
});

const page = async (id: string = CASE_IDS.queue) =>
  render(<ToastProvider>{await CaseQueuePage({ params: Promise.resolve({ id }) })}</ToastProvider>);

/** The operator directory, read with users:read to name members by email. */
const serveUsers = () =>
  api.on('GET', '/dashboard/users', 200, {
    data: [
      {
        type: 'user',
        id: CASE_IDS.member,
        attributes: {
          email: 'second-reviewer@example.test',
          name: 'Second Reviewer',
          status: 'active',
          'created-at': '2026-11-03T09:00:00.000Z',
          'updated-at': '2026-11-03T09:00:00.000Z',
        },
        relationships: { roles: { data: [] } },
      },
    ],
    links: { next: null },
  });

describe('one case queue (C132.1, C142.1)', () => {
  it('shows each member’s capacity and whether they are paused, read-only for a reviewer', async () => {
    expect(metadata.title).toBe('Case queue');
    api.me({ permissions: CASE_REVIEWER });
    serveCaseQueue(api, caseQueue());

    await page();

    expect(screen.getByRole('heading', { level: 1, name: 'Synthetic first line' })).toBeVisible();
    expect(screen.getByText('Synthetic round robin')).toBeVisible();
    const members = screen.getByRole('table', { name: 'Members' });
    const paused = within(
      within(members)
        .getByRole('rowheader', { name: CASE_IDS.member })
        .closest('tr') as HTMLElement,
    );
    expect(paused.getByText('10')).toBeVisible();
    expect(paused.getByText('Paused: takes no new case')).toBeVisible();
    const taking = within(
      within(members).getByRole('rowheader', { name: CASE_IDS.user }).closest('tr') as HTMLElement,
    );
    expect(taking.getByText('Taking cases')).toBeVisible();
    expect(screen.queryByRole('form', { name: 'Edit the members' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive queue' })).toBeNull();
  });

  it('edits the members, the name and the policy with case-queues:write, naming members by email with users:read', async () => {
    api.me({ permissions: [...CASE_DEVELOPER, 'users:read'] });
    serveCaseQueue(api, caseQueue());
    serveUsers();

    await page();

    const editor = screen.getByRole('form', { name: 'Edit the members' });
    const rows = within(editor).getAllByRole('group');
    expect(rows).toHaveLength(2);
    const second = within(nth(rows, 1));
    expect(second.getByRole('combobox', { name: /^Member 2/u })).toHaveValue(CASE_IDS.member);
    expect(
      second.getByRole('option', { name: 'second-reviewer@example.test (Second Reviewer)' }),
    ).toBeInTheDocument();
    expect(second.getByRole('spinbutton', { name: /^Open cases at most/u })).toHaveValue(10);
    expect(second.getByRole('checkbox', { name: /^Paused/u })).toBeChecked();
    expect(
      second.getByRole('button', { name: 'Remove second-reviewer@example.test' }),
    ).toBeVisible();
    const settings = screen.getByRole('form', { name: 'Queue settings' });
    expect(within(settings).getByRole('combobox', { name: 'Assignment policy' })).toHaveValue(
      CASE_IDS.policy,
    );
    expect(screen.getByRole('button', { name: 'Archive queue' })).toBeVisible();
  });

  it('says an archived queue takes no case, and offers no edit', async () => {
    api.me({ permissions: CASE_DEVELOPER });
    serveCaseQueue(api, caseQueue({ status: 'archived' }));

    await page();

    expect(screen.getByText(/Archived: it takes no case/u)).toBeVisible();
    expect(screen.queryByRole('form', { name: 'Edit the members' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive queue' })).toBeNull();
  });

  it('answers not found for an id that is not a queue’s', async () => {
    api.me({ permissions: CASE_REVIEWER });

    await expect(page('not-a-queue')).rejects.toThrow();
  });
});
