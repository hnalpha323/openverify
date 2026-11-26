// @vitest-environment node
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import { ANALYTICS_IDS, savedView, serveSavedViews } from '../../testing/routes/analytics';
import { transactionType } from '../../testing/transactions-fixtures';
import {
  copySavedViewAction,
  createSavedViewAction,
  deleteSavedViewAction,
  updateSavedViewAction,
} from './actions';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: RouteApi;

beforeEach(() => {
  vi.mocked(revalidatePath).mockReset();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: ['inquiries:read'] });
});

afterEach(() => {
  api.restore();
});

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  data.set('list', 'inquiries');
  data.set('path', '/inquiries');
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
};

const VIEWS = '/dashboard/saved-views';
const VIEW = `${VIEWS}/${ANALYTICS_IDS.view}`;

describe('saving and changing views (C165.1, C165.2)', () => {
  it('saves the current filters with a name and sharing', async () => {
    api.on('POST', VIEWS, 201, { data: savedView({ shared: true }) });

    const result = await createSavedViewAction(
      null,
      form({ name: 'Failed', filters: '{"filter[status]":"failed"}', shared: 'on' }),
    );

    expect(result).toEqual({ ok: true, data: { id: ANALYTICS_IDS.view } });
    expect(api.find('POST', VIEWS)?.body).toEqual({
      data: {
        type: 'saved-view',
        attributes: {
          list: 'inquiries',
          name: 'Failed',
          filters: { 'filter[status]': 'failed' },
          shared: true,
        },
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith('/inquiries');
  });

  it('refuses a personal-data filter in words before asking, naming the key only', async () => {
    const result = await createSavedViewAction(
      null,
      form({ name: 'Mine', filters: '{"filter[reference-id]":"synthetic-ref-001"}' }),
    );

    expect(result).toEqual({
      ok: false,
      problem: {
        title: 'A saved view never holds personal data',
        detail:
          'Remove the filters filter[reference-id] first: they can name a person, so a view cannot keep them.',
        errors: [],
      },
    });
    expect(JSON.stringify(result)).not.toContain('synthetic-ref-001');
    expect(api.all('POST', VIEWS)).toEqual([]);
  });

  it('reads the API’s own personal-data refusal the same way', async () => {
    api.onProblem('POST', VIEWS, 422, undefined, { code: 'saved_view_pii_filter' });

    const result = await createSavedViewAction(
      null,
      form({ name: 'Shared', filters: '{"filter[status]":"failed"}' }),
    );

    expect(result).toMatchObject({
      ok: false,
      problem: { title: 'A saved view never holds personal data' },
    });
  });

  it('refuses filters that are not a filter record, and a list the reader cannot read', async () => {
    expect(
      await createSavedViewAction(null, form({ name: 'x', filters: 'not json' })),
    ).toMatchObject({
      ok: false,
    });
    const other = form({ name: 'x', filters: '{}' });
    other.set('list', 'audit-logs');
    expect(await createSavedViewAction(null, other)).toMatchObject({
      ok: false,
      problem: { title: 'You do not have access' },
    });
  });

  it('renames, shares and deletes the owner’s view', async () => {
    api.on('PATCH', VIEW, 200, { data: savedView({ shared: true }) });
    api.on('DELETE', VIEW, 204);

    await updateSavedViewAction(null, form({ id: ANALYTICS_IDS.view, name: 'Renamed' }));
    expect(api.find('PATCH', VIEW)?.body).toEqual({
      data: { type: 'saved-view', attributes: { name: 'Renamed' } },
    });
    await updateSavedViewAction(null, form({ id: ANALYTICS_IDS.view, shared: 'true' }));
    expect(api.find('PATCH', VIEW)?.body).toEqual({
      data: { type: 'saved-view', attributes: { shared: true } },
    });
    expect(await deleteSavedViewAction(null, form({ id: ANALYTICS_IDS.view }))).toEqual({
      ok: true,
      data: undefined,
    });
  });

  it('copies another user’s shared view as the caller’s own, unshared', async () => {
    serveSavedViews(api, [
      savedView({ id: ANALYTICS_IDS.sharedView, ownerId: ANALYTICS_IDS.otherOwner, shared: true }),
    ]);
    api.on('POST', VIEWS, 201, { data: savedView() });

    await copySavedViewAction(null, form({ id: ANALYTICS_IDS.sharedView }));

    expect(api.find('POST', VIEWS)?.body).toEqual({
      data: {
        type: 'saved-view',
        attributes: {
          list: 'inquiries',
          name: 'Failed this month (copy)',
          filters: { 'filter[status]': 'failed' },
          shared: false,
        },
      },
    });
    expect(await copySavedViewAction(null, form({ id: ANALYTICS_IDS.view }))).toMatchObject({
      ok: false,
      problem: { title: 'This view no longer exists.' },
    });
  });
});

describe('a transaction field filter in a saved view (C165.2, DA4; K9-19)', () => {
  const transactionsForm = (filters: Record<string, string>) => {
    const data = form({ name: 'Large orders', filters: JSON.stringify(filters) });
    data.set('list', 'transactions');
    data.set('path', '/transactions');
    return data;
  };

  beforeEach(() => {
    api.me({ permissions: ['transactions:read'] });
  });

  it('saves a filter on a field no type declares as a string', async () => {
    api.on('GET', '/transaction-types', 200, { data: [transactionType()], links: { next: null } });
    api.on('POST', VIEWS, 201, { data: savedView() });

    const result = await createSavedViewAction(
      null,
      transactionsForm({ 'filter[fields.amount]': '100' }),
    );

    expect(result).toEqual({ ok: true, data: { id: ANALYTICS_IDS.view } });
    expect(api.find('POST', VIEWS)?.body).toMatchObject({
      data: { attributes: { list: 'transactions', filters: { 'filter[fields.amount]': '100' } } },
    });
  });

  it.each([
    ['a string field', 'filter[fields.note]'],
    ['a field no type declares', 'filter[fields.missing]'],
  ])('still refuses %s, before asking', async (_case, key) => {
    api.on('GET', '/transaction-types', 200, { data: [transactionType()], links: { next: null } });

    const result = await createSavedViewAction(null, transactionsForm({ [key]: 'synthetic' }));

    expect(result).toMatchObject({
      ok: false,
      problem: { title: 'A saved view never holds personal data' },
    });
    expect(api.all('POST', VIEWS)).toEqual([]);
  });

  it('refuses every field filter when the types cannot be read', async () => {
    api.onProblem('GET', '/transaction-types', 503);

    const result = await createSavedViewAction(
      null,
      transactionsForm({ 'filter[fields.amount]': '100' }),
    );

    expect(result).toMatchObject({
      ok: false,
      problem: { title: 'A saved view never holds personal data' },
    });
    expect(api.all('POST', VIEWS)).toEqual([]);
  });
});
