import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { LIFECYCLE_IDS as IDS, inquiry, inquiryList } from '../../testing/lifecycle-fixtures';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { fakeRequest } from '../../testing/fake-request';
import { redirectTarget } from '../../testing/next-errors';
import InquiriesPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

const LIST = '/inquiries';
let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: ['inquiries:read', 'accounts:read'] });
});

afterEach(() => {
  api.restore();
});

type Params = Record<string, string | string[] | undefined>;
const page = (params: Params = {}) => InquiriesPage({ searchParams: Promise.resolve(params) });
const listQuery = () => Object.fromEntries(api.find('GET', LIST)?.query ?? []);

describe('inquiries page', () => {
  it("lists the environment's inquiries with their tags and accounts", async () => {
    api.on(
      'GET',
      LIST,
      200,
      inquiryList([
        inquiry({ status: 'failed' }),
        inquiry({ status: 'pending', 'reference-id': null, tags: [] }, IDS.otherInquiry, null),
      ]),
    );

    render(await page());

    expect(screen.getByRole('heading', { level: 1, name: 'Inquiries' })).toBeVisible();
    const table = screen.getByRole('table', { name: 'Inquiries' });
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getByRole('link', { name: IDS.inquiry })).toHaveAttribute(
      'href',
      `/inquiries/${IDS.inquiry}`,
    );
    expect(within(table).getByRole('link', { name: IDS.account })).toHaveAttribute(
      'href',
      `/accounts/${IDS.account}`,
    );
    expect(listQuery()).toEqual({ 'page[size]': '25' });
  });

  it('passes the filters and cursor of the URL to the API and shows them in the form', async () => {
    api.on('GET', LIST, 200, inquiryList([]));

    render(
      await page({
        status: ['failed', 'needs_review'],
        tag: 'vip',
        'account-id': IDS.account,
        'reference-id': 'ref-synthetic-001',
        'created-from': '2026-10-01',
        'created-to': '2026-10-19',
        after: IDS.otherInquiry,
      }),
    );

    expect(listQuery()).toEqual({
      'filter[status]': 'failed,needs_review',
      'filter[tag]': 'vip',
      'filter[account-id]': IDS.account,
      'filter[reference-id]': 'ref-synthetic-001',
      'filter[created-at-start]': '2026-10-01T00:00:00.000Z',
      'filter[created-at-end]': '2026-10-20T00:00:00.000Z',
      'page[after]': IDS.otherInquiry,
      'page[size]': '25',
    });
    expect(screen.getByRole('checkbox', { name: 'Failed' })).toBeChecked();
    expect(screen.getByRole('cell')).toHaveTextContent('No inquiries match these filters.');
    // Back to the first page keeps the filters.
    const first = new URL(
      screen.getByRole('link', { name: 'First page' }).getAttribute('href') ?? '',
      'http://dashboard.test',
    );
    expect(first.pathname).toBe('/inquiries');
    expect(first.searchParams.getAll('status')).toEqual(['failed', 'needs_review']);
    expect(first.searchParams.get('account-id')).toBe(IDS.account);
    expect(first.searchParams.has('after')).toBe(false);
  });

  it("links to the next page from the API's cursor, keeping the filters", async () => {
    api.on(
      'GET',
      LIST,
      200,
      inquiryList(
        [inquiry()],
        `/api/v1/dashboard/inquiries?filter%5Bstatus%5D=failed&page%5Bsize%5D=25&page%5Bafter%5D=${IDS.inquiry}`,
      ),
    );

    render(await page({ status: 'failed' }));

    expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      `/inquiries?status=failed&after=${IDS.inquiry}`,
    );
  });

  it('says how to start when the environment has no inquiries yet', async () => {
    api.on('GET', LIST, 200, inquiryList([]));

    render(await page());

    expect(screen.getByRole('heading', { name: 'No inquiries yet' })).toBeVisible();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('explains a filter the API would refuse instead of listing', async () => {
    render(await page({ 'account-id': 'not-an-account' }));

    expect(api.find('GET', LIST)).toBeUndefined();
    expect(screen.getByRole('alert')).toHaveTextContent('Check the filters');
    expect(screen.getByRole('textbox', { name: 'Account ID' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('keeps the ticked statuses in the form while another filter is explained (Workflow 2D F003)', async () => {
    render(await page({ status: ['failed', 'needs_review'], 'created-from': '2026-02-30' }));

    expect(api.find('GET', LIST)).toBeUndefined();
    expect(screen.getByLabelText('Created from (UTC)')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('checkbox', { name: 'Failed' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Needs review' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Completed' })).not.toBeChecked();
  });

  it('names accounts without linking them for a role without accounts:read', async () => {
    api.me({ permissions: ['inquiries:read'] });
    api.on('GET', LIST, 200, inquiryList());

    render(await page());

    expect(screen.queryByRole('link', { name: IDS.account })).not.toBeInTheDocument();
    expect(screen.getByText(IDS.account)).toBeVisible();
  });

  it('sends the operator to sign in when the session has ended', async () => {
    api.onProblem('GET', LIST, 401);

    await expect(redirectTarget(page())).resolves.toBe('/login');
  });

  it('sends the operator to sign in without a session cookie, without calling the API', async () => {
    fakeRequest.cookies.clear();

    await expect(redirectTarget(page())).resolves.toBe('/login');
    expect(api.requests).toHaveLength(0);
  });

  it('shows the forbidden panel to a role without inquiries:read, without listing', async () => {
    api.me({ permissions: ['users:read'] });

    render(await page());

    expect(screen.getByRole('heading', { level: 1, name: 'You do not have access' })).toBeVisible();
    expect(api.find('GET', LIST)).toBeUndefined();
  });

  it('is titled for the browser tab', () => {
    expect(metadata.title).toBe('Inquiries');
  });
});
