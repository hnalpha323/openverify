// @vitest-environment node
import { OpenVerifyApiError } from '@openverify/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import { ANALYTICS_IDS, savedView } from '../../testing/routes/analytics';
import { createSavedView, deleteSavedView, listSavedViews, updateSavedView } from './saved-views';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

let api: MockApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = mockApi();
});

afterEach(() => {
  api.restore();
});

describe('the saved views API (C165.1)', () => {
  it('lists the views of one list', async () => {
    api.replyTo('GET /dashboard/saved-views', 200, {
      data: [savedView()],
      links: { next: null },
    });

    const answer = await listSavedViews('inquiries');

    expect(answer.data[0]?.id).toBe(ANALYTICS_IDS.view);
    expect(Object.fromEntries(api.last().query)).toEqual({ 'filter[list]': 'inquiries' });
  });

  it('creates a view with its list, name, filters and sharing', async () => {
    api.replyTo('POST /dashboard/saved-views', 201, { data: savedView({ shared: true }) });

    await createSavedView({
      list: 'inquiries',
      name: 'Failed this month',
      filters: { 'filter[status]': 'failed' },
      shared: true,
    });

    expect(api.last().body).toEqual({
      data: {
        type: 'saved-view',
        attributes: {
          list: 'inquiries',
          name: 'Failed this month',
          filters: { 'filter[status]': 'failed' },
          shared: true,
        },
      },
    });
  });

  it('renames and deletes the owner’s view', async () => {
    api.replyTo(`PATCH /dashboard/saved-views/${ANALYTICS_IDS.view}`, 200, {
      data: savedView({ name: 'Renamed' }),
    });
    api.replyTo(`DELETE /dashboard/saved-views/${ANALYTICS_IDS.view}`, 204);

    await expect(updateSavedView(ANALYTICS_IDS.view, { name: 'Renamed' })).resolves.toMatchObject({
      data: { attributes: { name: 'Renamed' } },
    });
    expect(api.requests[0]?.body).toEqual({
      data: { type: 'saved-view', attributes: { name: 'Renamed' } },
    });
    await expect(deleteSavedView(ANALYTICS_IDS.view)).resolves.toBeUndefined();
  });

  it('passes the personal-data refusal on with its code', async () => {
    api.replyProblemTo('POST /dashboard/saved-views', 422, undefined, {
      code: 'saved_view_pii_filter',
    });

    const refused = await createSavedView({
      list: 'inquiries',
      name: 'By reference',
      filters: { 'filter[reference-id]': 'synthetic-ref' },
    }).catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(OpenVerifyApiError);
    expect((refused as OpenVerifyApiError).code).toBe('saved_view_pii_filter');
  });
});
