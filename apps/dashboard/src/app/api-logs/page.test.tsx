import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INTEGRATION_IDS,
  apiLogResource,
  listOf,
  nth,
} from '../../components/integrations/testing-fixtures';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { meDocument, mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import ApiLogsPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

const { apiLog: LOG, apiKey: CALLER, user: USER } = INTEGRATION_IDS;
const OTHER_LOG = 'alog_01J9ZK3M5Q7R8S9T0V1W2X3Y70';

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

afterEach(() => {
  api.restore();
});

async function renderPage(searchParams: Record<string, string> = {}) {
  render(await ApiLogsPage({ searchParams: Promise.resolve(searchParams) }));
}

describe('API logs page', () => {
  it('lists the requests, newest first, with who made them', async () => {
    api.reply(200, meDocument({ permissions: ['api-logs:read', 'api-keys:read'] })).reply(
      200,
      listOf([
        apiLogResource(),
        apiLogResource(
          {
            method: 'GET',
            path: '/api/v1/nowhere',
            route: null,
            status: 404,
            'api-key-id': null,
            'user-id': USER,
          },
          OTHER_LOG,
        ),
      ]),
    );

    await renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'API logs' })).toBeVisible();
    const rows = within(screen.getByRole('table', { name: 'API logs' })).getAllByRole('row');
    expect(rows).toHaveLength(3);
    const first = nth(rows, 1);
    expect(within(first).getByRole('link', { name: 'Oct 20, 2026, 4:35 AM' })).toHaveAttribute(
      'href',
      `/api-logs/${LOG}`,
    );
    expect(first).toHaveTextContent('POST');
    expect(first).toHaveTextContent(`/api/v1/inquiries/${INTEGRATION_IDS.inquiry}/approve`);
    expect(first).toHaveTextContent('200');
    expect(first).toHaveTextContent('42 ms');
    expect(within(first).getByRole('link', { name: CALLER })).toHaveAttribute(
      'href',
      `/api-keys/${CALLER}`,
    );
    // A dashboard user links to the requests made with their sessions (C25.9).
    expect(within(nth(rows, 2)).getByRole('link', { name: USER })).toHaveAttribute(
      'href',
      `/api-logs?user-id=${USER}`,
    );
    expect(Object.fromEntries(api.last().query)).toEqual({ 'page[size]': '25' });
  });

  it('applies the filters of the URL, keeps them in the form and pages with them', async () => {
    api
      .reply(200, meDocument({ permissions: ['api-logs:read'] }))
      .reply(200, listOf([apiLogResource()], `/api/v1/api-logs?page%5Bafter%5D=${LOG}`));

    await renderPage({
      method: 'POST',
      status: '4xx',
      route: '/api/v1/inquiries/:id',
      'api-key-id': CALLER,
      'created-at-start': '2026-10-20T00:00',
      'created-at-end': '2026-10-21T00:00',
    });

    expect(Object.fromEntries(api.last().query)).toEqual({
      'filter[method]': 'POST',
      'filter[status]': '4xx',
      'filter[route]': '/api/v1/inquiries/:id',
      'filter[api-key-id]': CALLER,
      'filter[created-at-start]': '2026-10-20T00:00:00.000Z',
      'filter[created-at-end]': '2026-10-21T00:00:00.000Z',
      'page[size]': '25',
    });
    const filters = screen.getByRole('search', { name: 'Filter API logs' });
    expect(within(filters).getByRole('combobox', { name: 'Method' })).toHaveValue('POST');
    expect(within(filters).getByRole('textbox', { name: 'Status' })).toHaveValue('4xx');
    expect(within(filters).getByLabelText('From (UTC)')).toHaveValue('2026-10-20T00:00');
    expect(within(filters).getByRole('link', { name: 'Clear filters' })).toHaveAttribute(
      'href',
      '/api-logs',
    );
    // The caller is not a link for a role without api-keys:read.
    expect(screen.queryByRole('link', { name: CALLER })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Next page' }).getAttribute('href')).toContain(
      `after=${LOG}`,
    );
  });

  it('filters by the user whose dashboard sessions made the requests, kept in the URL (C25.9)', async () => {
    api
      .reply(200, meDocument({ permissions: ['api-logs:read'] }))
      .reply(200, listOf([apiLogResource()], `/api/v1/api-logs?page%5Bafter%5D=${LOG}`));

    await renderPage({ 'user-id': USER });

    expect(Object.fromEntries(api.last().query)).toEqual({
      'filter[user-id]': USER,
      'page[size]': '25',
    });
    const filters = screen.getByRole('search', { name: 'Filter API logs' });
    expect(within(filters).getByRole('textbox', { name: 'User ID' })).toHaveValue(USER);
    expect(screen.getByRole('link', { name: 'Next page' }).getAttribute('href')).toContain(
      `user-id=${USER}`,
    );
  });

  it('says why a filter was not applied, and when nothing matches', async () => {
    api.reply(200, meDocument({ permissions: ['api-logs:read'] })).reply(200, listOf([]));

    await renderPage({ status: 'teapot' });

    expect(screen.getByRole('textbox', { name: 'Status' })).toHaveAccessibleDescription(
      'Enter a status code such as 404, or a class such as 4xx.',
    );
    expect(api.last().query.get('filter[status]')).toBeNull();
    expect(screen.getByRole('table', { name: 'API logs' })).toHaveTextContent('No API logs match.');
  });

  it('says when nothing was logged yet', async () => {
    api.reply(200, meDocument({ permissions: ['api-logs:read'] })).reply(200, listOf([]));

    await renderPage();

    expect(screen.getByRole('table', { name: 'API logs' })).toHaveTextContent(
      'No requests to the server API yet.',
    );
  });

  it('shows the forbidden panel without api-logs:read', async () => {
    api.reply(200, meDocument({ permissions: ['events:read'] }));

    await renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'You do not have access' })).toBeVisible();
    expect(api.requests).toHaveLength(1);
  });

  it('is titled for the browser tab', () => {
    expect(metadata.title).toBe('API logs');
  });
});
