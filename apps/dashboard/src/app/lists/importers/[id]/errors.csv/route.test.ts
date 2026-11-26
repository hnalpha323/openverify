// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../../../testing/api-routes';
import { fakeRequest } from '../../../../../testing/fake-request';
import { LIST_IDS, importerErrors } from '../../../../../testing/lists-fixtures';
import { GET } from './route';

vi.mock('next/headers', () =>
  import('../../../../../testing/fake-request').then((m) => m.nextHeaders),
);

const ERRORS = `/importers/${LIST_IDS.importer}/errors`;
let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
});

afterEach(() => {
  api.restore();
});

const get = (id: string = LIST_IDS.importer) =>
  GET(new Request(`http://dashboard.test/lists/importers/${id}/errors.csv`), {
    params: Promise.resolve({ id }),
  });

describe("an import's errors as CSV (C100.4, C100.6)", () => {
  it('writes every page of codes, rows and columns, never a value, with the header row', async () => {
    api.handle('GET', ERRORS, (request) =>
      request.query.get('page[after]') === null
        ? {
            status: 200,
            body: importerErrors(
              [{ row: null, column: null, code: 'missing_column' }],
              `/api/v1${ERRORS}?page%5Bafter%5D=1`,
            ),
          }
        : {
            status: 200,
            body: importerErrors([{ row: 4, column: 'value', code: 'invalid_value' }]),
          },
    );

    const response = await get();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="${LIST_IDS.importer}-errors.csv"`,
    );
    expect(await response.text()).toBe(
      '"row","column","code"\r\n"","","missing_column"\r\n"4","value","invalid_value"\r\n',
    );
    expect(api.all('GET', ERRORS).map((request) => request.query.get('page[after]'))).toEqual([
      null,
      '1',
    ]);
  });

  it('answers 404 for an id that is not an importer id, asking nothing', async () => {
    const response = await get('nope');

    expect(response.status).toBe(404);
    expect(api.requests).toHaveLength(0);
  });

  it('passes on the API refusal as a status without a body', async () => {
    api.onProblem('GET', ERRORS, 403, 'forbidden');

    const response = await get();

    expect(response.status).toBe(403);
    expect(await response.text()).toBe('');
  });

  it('answers 401 without a session', async () => {
    fakeRequest.reset();

    const response = await get();

    expect(response.status).toBe(401);
    expect(api.requests).toHaveLength(0);
  });
});
