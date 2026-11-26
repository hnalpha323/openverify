import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../components/toasts';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { CASE_IDS, caseExport, caseQueue, caseTemplate } from '../../../testing/cases-fixtures';
import { fakeRequest } from '../../../testing/fake-request';
import {
  CASE_ADMIN,
  CASE_DEVELOPER,
  CASE_EXPORTS_PATH,
  serveCaseExports,
  serveCaseQueues,
  serveCaseTemplates,
} from '../../../testing/routes/cases';
import CaseExportsPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: CASE_ADMIN });
  serveCaseTemplates(api, [caseTemplate()]);
  serveCaseQueues(api, [caseQueue()]);
});

afterEach(() => {
  api.restore();
});

const page = async () =>
  render(
    <ToastProvider>{await CaseExportsPage({ searchParams: Promise.resolve({}) })}</ToastProvider>,
  );

const rowOf = (table: HTMLElement, id: string) =>
  within(within(table).getByRole('rowheader', { name: id }).closest('tr') as HTMLElement);

describe('the caller’s case exports (C138.1, C142.1)', () => {
  it('lists the caller’s own exports with their state, lifetime and download in words', async () => {
    expect(metadata.title).toBe('Case exports');
    serveCaseExports(api, [
      caseExport({ personalData: true }),
      caseExport({ id: CASE_IDS.otherExport, status: 'failed', errorCode: 'export_too_large' }),
      caseExport({ id: 'cexp_01JE0000000000000000000003', status: 'expired', format: 'json' }),
      caseExport({ id: 'cexp_01JE0000000000000000000004', status: 'running' }),
    ]);

    await page();

    const table = screen.getByRole('table', { name: 'Your exports' });
    const ready = rowOf(table, CASE_IDS.export);
    expect(ready.getByText('Ready to download')).toBeVisible();
    expect(ready.getByText('Includes personal data')).toBeVisible();
    expect(ready.getByText('12 cases, CSV, 4 KB')).toBeVisible();
    expect(ready.getByText(/^Deleted /u)).toBeVisible();
    expect(ready.getByRole('link', { name: `Download ${CASE_IDS.export}` })).toHaveAttribute(
      'href',
      `/cases/exports/${CASE_IDS.export}/download`,
    );
    const failed = rowOf(table, CASE_IDS.otherExport);
    expect(
      failed.getByText('An export takes at most 10,000 cases: narrow the filter.'),
    ).toBeVisible();
    expect(failed.queryByRole('link')).toBeNull();
    const expired = rowOf(table, 'cexp_01JE0000000000000000000003');
    expect(expired.getByText('Expired: the file was deleted')).toBeVisible();
    expect(expired.queryByRole('link')).toBeNull();
    const running = rowOf(table, 'cexp_01JE0000000000000000000004');
    expect(running.getByText('Being written')).toBeVisible();
    expect(running.getByText('Not known until it is written')).toBeVisible();
    expect(Object.fromEntries(api.find('GET', CASE_EXPORTS_PATH)?.query ?? [])).toEqual({
      'page[size]': '25',
    });
    expect(screen.getByText(/Only you can see and download your exports/u)).toBeVisible();
    const form = screen.getByRole('form', { name: 'Export cases' });
    expect(within(form).getByRole('checkbox', { name: /^Include personal data/u })).toBeVisible();
  });

  it('offers no personal data without pii:view', async () => {
    api.me({ permissions: [...CASE_DEVELOPER, 'cases:export'] });
    serveCaseExports(api, []);

    await page();

    const form = screen.getByRole('form', { name: 'Export cases' });
    expect(within(form).queryByRole('checkbox', { name: /^Include personal data/u })).toBeNull();
    expect(within(form).getByText(/pii:view/u)).toBeVisible();
    expect(screen.getByText('No exports yet.')).toBeVisible();
  });

  it('shows the forbidden panel without cases:export, which reviewers lack', async () => {
    api.me({ permissions: CASE_DEVELOPER });

    await page();

    expect(screen.getByRole('heading', { name: 'You do not have access' })).toBeVisible();
    expect(api.find('GET', CASE_EXPORTS_PATH)).toBeUndefined();
  });
});
