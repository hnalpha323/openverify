import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INTEGRATION_IDS,
  apiKeyResource,
  listOf,
  nth,
  rateLimitList,
} from '../../components/integrations/testing-fixtures';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { meDocument, mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import { redirectTarget } from '../../testing/next-errors';
import ApiKeysPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

const { apiKey: KEY_ID, clonedApiKey: OTHER_ID } = INTEGRATION_IDS;
const THIRD_ID = 'key_01J9ZK3M5Q0000000000000069';

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-20T12:00:00.000Z') });
});

afterEach(() => {
  api.restore();
  vi.useRealTimers();
});

async function renderPage(searchParams: Record<string, string> = {}) {
  render(await ApiKeysPage({ searchParams: Promise.resolve(searchParams) }));
}

describe('API keys page', () => {
  it("lists the environment's keys with their state, and a way to create one", async () => {
    api
      .reply(200, meDocument({ permissions: ['api-keys:read', 'api-keys:write'] }))
      .reply(
        200,
        listOf([
          apiKeyResource(),
          apiKeyResource(
            { name: 'Nightly', 'expires-at': '2026-10-27T12:00:00.000Z', 'last-used-at': null },
            OTHER_ID,
          ),
          apiKeyResource({ name: 'Old', 'expires-at': '2026-10-19T12:00:00.000Z' }, THIRD_ID),
        ]),
      )
      .replyTo('GET /rate-limits', 200, rateLimitList());

    await renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'API keys' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Create API key' })).toHaveAttribute(
      'href',
      '/api-keys/new',
    );
    const rows = within(screen.getByRole('table', { name: 'API keys' })).getAllByRole('row');
    expect(rows).toHaveLength(4);
    const active = nth(rows, 1);
    expect(within(active).getByRole('link', { name: 'CI deploys' })).toHaveAttribute(
      'href',
      `/api-keys/${KEY_ID}`,
    );
    expect(active).toHaveTextContent('ov_sbx_abcd…');
    expect(active).toHaveTextContent('2 scopes');
    expect(active).toHaveTextContent('Active');
    expect(nth(rows, 2)).toHaveTextContent('Expires');
    expect(nth(rows, 2)).toHaveTextContent('Oct 27, 2026');
    expect(nth(rows, 2)).toHaveTextContent('Never');
    expect(nth(rows, 3)).toHaveTextContent('Expired');
    expect(api.requests[1]).toMatchObject({ method: 'GET', path: '/api/v1/api-keys' });
  });

  it('says when there is none yet', async () => {
    api
      .reply(200, meDocument({ permissions: ['api-keys:read'] }))
      .reply(200, listOf([]))
      .replyTo('GET /rate-limits', 200, rateLimitList());

    await renderPage();

    expect(screen.getByRole('heading', { name: 'No API keys yet' })).toBeVisible();
    expect(screen.queryByRole('link', { name: /Create/ })).not.toBeInTheDocument();
  });

  it("pages with the API's cursor", async () => {
    api
      .reply(200, meDocument({ permissions: ['api-keys:read'] }))
      .reply(
        200,
        listOf(
          [apiKeyResource({ scopes: ['inquiries:read'] })],
          `/api/v1/api-keys?page%5Bafter%5D=${KEY_ID}`,
        ),
      )
      .replyTo('GET /rate-limits', 200, rateLimitList());

    await renderPage({ after: OTHER_ID });

    expect(api.requests[1]?.query.get('page[after]')).toBe(OTHER_ID);
    expect(screen.getByRole('table', { name: 'API keys' })).toHaveTextContent('1 scope');
    expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      `/api-keys?after=${KEY_ID}`,
    );
  });

  it('labels a key that sees personal data masked (C25.6)', async () => {
    api
      .reply(200, meDocument({ permissions: ['api-keys:read'] }))
      .reply(
        200,
        listOf([
          apiKeyResource(),
          apiKeyResource({ name: 'Masked', 'pii-masked': true }, OTHER_ID),
        ]),
      )
      .replyTo('GET /rate-limits', 200, rateLimitList());

    await renderPage();

    const rows = within(screen.getByRole('table', { name: 'API keys' })).getAllByRole('row');
    expect(nth(rows, 0)).toHaveTextContent('Personal data');
    expect(nth(rows, 1)).toHaveTextContent('Visible');
    expect(nth(rows, 2)).toHaveTextContent('Masked');
  });

  it("shows the caller's rate limits as an information panel (C26)", async () => {
    api
      .reply(200, meDocument({ permissions: ['api-keys:read'] }))
      .reply(200, listOf([apiKeyResource()]))
      .replyTo('GET /rate-limits', 200, rateLimitList());

    await renderPage();

    const panel = screen.getByRole('region', { name: 'Your rate limit' });
    expect(panel).toHaveTextContent('300 requests every 60 seconds');
    expect(within(panel).getByText('Left in this window').nextElementSibling).toHaveTextContent(
      '297',
    );
    expect(within(panel).getByText('Full again (UTC)').nextElementSibling).toHaveTextContent(
      'Oct 20, 2026, 12:01 PM',
    );
  });

  it('says the rate limit is unknown when the API cannot tell it, and still lists the keys', async () => {
    api
      .reply(200, meDocument({ permissions: ['api-keys:read'] }))
      .reply(200, listOf([apiKeyResource()]))
      .replyProblemTo('GET /rate-limits', 503);

    await renderPage();

    expect(screen.getByRole('region', { name: 'Your rate limit' })).toHaveTextContent(
      'Your rate limit is not available right now.',
    );
    expect(screen.getByRole('table', { name: 'API keys' })).toBeVisible();
  });

  it('sends the operator to sign in when the rate limit answers that the session ended', async () => {
    api
      .reply(200, meDocument({ permissions: ['api-keys:read'] }))
      .reply(200, listOf([apiKeyResource()]))
      .replyProblemTo('GET /rate-limits', 401);

    await expect(redirectTarget(ApiKeysPage({ searchParams: Promise.resolve({}) }))).resolves.toBe(
      '/login',
    );
  });

  it('shows the forbidden panel without api-keys:read', async () => {
    api.reply(200, meDocument({ permissions: ['inquiries:read'] }));

    await renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'You do not have access' })).toBeVisible();
    expect(api.requests).toHaveLength(1);
  });

  it('is titled for the browser tab', () => {
    expect(metadata.title).toBe('API keys');
  });
});
