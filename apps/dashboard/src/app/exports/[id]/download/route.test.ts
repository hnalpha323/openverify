// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../../testing/api-routes';
import { fakeRequest } from '../../../../testing/fake-request';
import { ANALYTICS_IDS, INQUIRY_EXPORTER } from '../../../../testing/routes/analytics';
import { GET } from './route';

vi.mock('next/headers', () =>
  import('../../../../testing/fake-request').then((m) => m.nextHeaders),
);

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  api = routeApi();
});

afterEach(() => {
  api.restore();
});

const PATH = `/exports/${ANALYTICS_IDS.export}/download`;
const download = (id: string = ANALYTICS_IDS.export) =>
  GET(new Request(`http://dashboard.test/exports/${id}/download`), {
    params: Promise.resolve({ id }),
  });

describe('downloading an export (C166.1, C166.4)', () => {
  it('passes the CSV on as an attachment, never stored', async () => {
    fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
    api.me({ permissions: INQUIRY_EXPORTER });
    api.on('GET', PATH, 200, 'id,status');

    const response = await download();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="export-${ANALYTICS_IDS.export}.csv"`,
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.text()).toContain('id,status');
  });

  it('answers 404 for a malformed id and 401 without a session, asking nothing', async () => {
    expect((await download('exp_1')).status).toBe(404);
    expect((await download()).status).toBe(401);
    expect(api.requests).toEqual([]);
  });

  it('refuses a reader without any export permission before asking', async () => {
    fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
    api.me({ permissions: ['inquiries:read'] });

    expect((await download()).status).toBe(403);
    expect(api.all('GET', PATH)).toEqual([]);
  });

  it('passes the API’s refusals on as statuses without a body', async () => {
    fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
    api.me({ permissions: INQUIRY_EXPORTER });
    for (const [status, expected] of [
      [410, 410],
      [404, 404],
      [403, 403],
      [500, 502],
    ] as const) {
      api.onProblem('GET', PATH, status);
      const response = await download();
      expect(response.status).toBe(expected);
      expect(await response.text()).toBe('');
    }
  });
});
