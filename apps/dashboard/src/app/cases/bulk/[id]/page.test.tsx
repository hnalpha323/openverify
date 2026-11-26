import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CASE_PROBLEM_WORDS } from '../../../../components/cases/case-words';
import { SESSION_COOKIE } from '../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../../testing/api-routes';
import { CASE_IDS, bulkAction } from '../../../../testing/cases-fixtures';
import { fakeRequest } from '../../../../testing/fake-request';
import { CASE_REVIEWER, serveBulkAction } from '../../../../testing/routes/cases';
import CaseBulkActionPage, { metadata } from './page';

vi.mock('next/headers', () =>
  import('../../../../testing/fake-request').then((m) => m.nextHeaders),
);

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

const page = async (id: string = CASE_IDS.bulk) =>
  render(await CaseBulkActionPage({ params: Promise.resolve({ id }) }));

describe('a bulk action’s outcomes (C137.4, C142.1)', () => {
  it('says each case’s outcome, and a refusal’s reason in words', async () => {
    expect(metadata.title).toBe('Bulk action');
    serveBulkAction(api, bulkAction());

    await page();

    expect(screen.getByRole('heading', { level: 1, name: 'Set the status' })).toBeVisible();
    expect(screen.getByText('3 cases: 1 applied, 1 without change, 1 refused.')).toBeVisible();
    const table = screen.getByRole('table', { name: 'Outcome of each case' });
    const refused = within(
      within(table)
        .getByRole('rowheader', { name: CASE_IDS.thirdCase })
        .closest('tr') as HTMLElement,
    );
    expect(refused.getByText('Refused')).toBeVisible();
    expect(refused.getByText(CASE_PROBLEM_WORDS.case_transition_refused)).toBeVisible();
    expect(within(table).getByRole('link', { name: CASE_IDS.case })).toHaveAttribute(
      'href',
      `/cases/${CASE_IDS.case}`,
    );
    expect(within(table).getByText('No change: the case already was so')).toBeVisible();
  });

  it('says the outcomes are not known while the action waits or runs, never that nothing happened', async () => {
    serveBulkAction(api, bulkAction({ status: 'running' }));

    await page();

    expect(screen.getByRole('status')).toHaveTextContent(
      'Running: the outcomes are not known yet. 3 cases asked.',
    );
    expect(screen.getByRole('link', { name: 'Refresh' })).toHaveAttribute(
      'href',
      `/cases/bulk/${CASE_IDS.bulk}`,
    );
    expect(screen.queryByRole('table', { name: 'Outcome of each case' })).toBeNull();
  });

  it('answers not found for an id that is not a bulk action’s', async () => {
    await expect(page('cblk_nope')).rejects.toThrow();
  });
});
