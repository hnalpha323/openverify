// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { fakeRequest } from '../../../testing/fake-request';
import { ANALYTICS_IDS, savedView, serveSavedViews } from '../../../testing/routes/analytics';
import { transactionType } from '../../../testing/transactions-fixtures';
import { GET } from './route';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  api = routeApi();
});

afterEach(() => {
  api.restore();
});

const get = (list: string) =>
  GET(new Request(`http://dashboard.test/exports/saved-views?list=${list}`));

describe('the saved views a list page’s slot reads (C165.1)', () => {
  it('answers the list’s views, which are the reader’s, and whether it may export them', async () => {
    fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
    api.me({ permissions: ['inquiries:read', 'inquiries:export'] });
    serveSavedViews(api, [
      savedView(),
      savedView({ id: ANALYTICS_IDS.sharedView, ownerId: ANALYTICS_IDS.otherOwner, shared: true }),
    ]);

    const response = await get('inquiries');

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({
      views: [
        {
          id: ANALYTICS_IDS.view,
          name: 'Failed this month',
          mine: true,
          shared: false,
          filters: { 'filter[status]': 'failed' },
          filtersValid: true,
          invalidFilters: [],
        },
        {
          id: ANALYTICS_IDS.sharedView,
          name: 'Failed this month',
          mine: false,
          shared: true,
          filters: { 'filter[status]': 'failed' },
          filtersValid: true,
          invalidFilters: [],
        },
      ],
      exportType: 'inquiries',
    });
    expect(api.find('GET', '/dashboard/saved-views')?.query.get('filter[list]')).toBe('inquiries');
  });

  it('offers no export for a list the reader cannot export or that has none', async () => {
    fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
    api.me({ permissions: ['events:read'] });
    serveSavedViews(api, []);

    expect(await (await get('events')).json()).toEqual({ views: [], exportType: null });
  });

  it('refuses an unknown list, no session, the list’s read permission missing, or a failed read', async () => {
    expect((await get('people')).status).toBe(404);
    expect((await get('inquiries')).status).toBe(401);
    fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
    api.me({ permissions: ['inquiries:read'] });
    expect((await get('audit-logs')).status).toBe(403);
    api.onProblem('GET', '/dashboard/saved-views', 500);
    expect((await get('inquiries')).status).toBe(502);
  });
});

describe('the transaction field keys a saved view may hold (DA4; K9-19)', () => {
  const OTHER_TYPE = 'txntp_01JD0000000000000000000009';

  it('answers the keys no type declares as a string, from the types the console reads', async () => {
    fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
    api.me({ permissions: ['transactions:read'] });
    serveSavedViews(api, []);
    api.on('GET', '/transaction-types', 200, { data: [transactionType()], links: { next: null } });

    const body = (await (await get('transactions')).json()) as Record<string, unknown>;

    expect(body.nonPersonalTransactionFields).toEqual(['amount', 'receipt']);
  });

  it('counts a key one type declares as a string as personal in every type', async () => {
    fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
    api.me({ permissions: ['transactions:read'] });
    serveSavedViews(api, []);
    const other = transactionType({ id: OTHER_TYPE });
    api.on('GET', '/transaction-types', 200, {
      data: [
        transactionType(),
        {
          ...other,
          attributes: {
            ...other.attributes,
            'field-schemas': [{ type: 'string', key: 'amount', label: 'Amount' }],
          },
        },
      ],
      links: { next: null },
    });

    const body = (await (await get('transactions')).json()) as Record<string, unknown>;

    expect(body.nonPersonalTransactionFields).toEqual(['receipt']);
  });

  it('answers null when it cannot read every type, so every field filter stays refused', async () => {
    fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
    api.me({ permissions: ['transactions:read'] });
    serveSavedViews(api, []);
    api.on('GET', '/transaction-types', 200, {
      data: [transactionType()],
      links: { next: '/api/v1/transaction-types?page[after]=txntp_01JD0000000000000000000001' },
    });

    const body = (await (await get('transactions')).json()) as Record<string, unknown>;

    expect(body.nonPersonalTransactionFields).toBeNull();
  });
});
