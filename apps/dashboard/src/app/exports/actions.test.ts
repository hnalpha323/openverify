// @vitest-environment node
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { ENVIRONMENTS } from '../../testing/api-mock';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import {
  ANALYTICS_IDS,
  INQUIRY_EXPORTER,
  INQUIRY_EXPORTER_PII,
  exportResource,
} from '../../testing/routes/analytics';
import { createExportAction } from './actions';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: RouteApi;

beforeEach(() => {
  vi.mocked(revalidatePath).mockReset();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.on('POST', '/exports', 202, { data: exportResource({ status: 'pending' }) });
});

afterEach(() => {
  api.restore();
});

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  data.set('environment-id', ENVIRONMENTS.sandbox.id);
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
};

const attributes = () =>
  (api.find('POST', '/exports')?.body as { data: { attributes: unknown } } | undefined)?.data
    .attributes;

describe('asking for an export (C166.1, C166.2)', () => {
  it('sends the type, the filters in the route’s names and no personal data', async () => {
    api.me({ permissions: INQUIRY_EXPORTER });

    expect(
      await createExportAction(
        null,
        form({
          'object-type': 'inquiries',
          status: 'failed',
          'created-from': '2026-10-01',
          'created-to': '2026-10-02',
        }),
      ),
    ).toEqual({ ok: true, data: { id: ANALYTICS_IDS.export } });
    expect(attributes()).toEqual({
      'object-type': 'inquiries',
      format: 'csv',
      'include-personal-data': false,
      filter: {
        'filter[status]': 'failed',
        'filter[created-at-start]': '2026-10-01T00:00:00.000Z',
        'filter[created-at-end]': '2026-10-03T00:00:00.000Z',
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith('/exports');
  });

  it('exports a saved view’s rows by its id, never both a view and filters', async () => {
    api.me({ permissions: INQUIRY_EXPORTER });

    await createExportAction(
      null,
      form({ 'object-type': 'inquiries', 'saved-view-id': ANALYTICS_IDS.view, status: 'failed' }),
    );

    expect(attributes()).toEqual({
      'object-type': 'inquiries',
      format: 'csv',
      'include-personal-data': false,
      'saved-view-id': ANALYTICS_IDS.view,
    });
  });

  it('sends what verifications and lists need', async () => {
    api.me({ permissions: ['verifications:export', 'lists:export'] });

    await createExportAction(
      null,
      form({ 'object-type': 'verifications', 'verification-type': 'government-id' }),
    );
    expect(attributes()).toMatchObject({ filter: { 'filter[type]': 'government-id' } });

    await createExportAction(
      null,
      form({ 'object-type': 'lists', 'list-id': ANALYTICS_IDS.list, 'created-from': '2026-10-01' }),
    );
    expect(attributes()).toMatchObject({ filter: { 'filter[list-id]': ANALYTICS_IDS.list } });
    expect(Object.keys((attributes() as { filter: object }).filter)).toEqual(['filter[list-id]']);
  });

  it('includes personal data only with pii:view and after the confirmation', async () => {
    api.me({ permissions: INQUIRY_EXPORTER });
    const refused = await createExportAction(
      null,
      form({ 'object-type': 'inquiries', 'include-personal-data': 'on' }),
    );
    expect(refused).toMatchObject({ ok: false, problem: { title: 'You do not have access' } });

    api.me({ permissions: INQUIRY_EXPORTER_PII });
    const unconfirmed = await createExportAction(
      null,
      form({ 'object-type': 'inquiries', 'include-personal-data': 'on' }),
    );
    expect(unconfirmed).toMatchObject({
      ok: false,
      problem: { title: 'Confirm the personal data first' },
    });
    expect(api.all('POST', '/exports')).toEqual([]);

    await createExportAction(
      null,
      form({
        'object-type': 'inquiries',
        'include-personal-data': 'on',
        'personal-data-confirmed': 'true',
      }),
    );
    expect(attributes()).toMatchObject({ 'include-personal-data': true });
  });

  it('refuses a type the operator cannot export, and shows the API’s refusals', async () => {
    api.me({ permissions: INQUIRY_EXPORTER });
    expect(await createExportAction(null, form({ 'object-type': 'accounts' }))).toMatchObject({
      ok: false,
      problem: { title: 'You do not have access' },
    });

    api.onProblem('POST', '/exports', 429, 'rate-limited');
    expect(await createExportAction(null, form({ 'object-type': 'inquiries' }))).toMatchObject({
      ok: false,
    });
  });
});
