// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../../testing/api-fixtures';
import { BFF_TOKEN } from '../../../../../testing/api-mock';
import { routeApi, type RouteApi } from '../../../../../testing/api-routes';
import { CASE_IDS } from '../../../../../testing/cases-fixtures';
import { fakeRequest } from '../../../../../testing/fake-request';
import { CASE_ADMIN, CASE_DEVELOPER } from '../../../../../testing/routes/cases';
import { GET } from './route';

vi.mock('next/headers', () =>
  import('../../../../../testing/fake-request').then((m) => m.nextHeaders),
);

const ID = CASE_IDS.export;
const DOWNLOAD = `/api/v1/case-exports/${ID}/download`;
const CSV = '"id","name"\r\n"case_01JE0000000000000000000001","KYC-6"\r\n';

let api: RouteApi;
let upstream: () => Response;
const downloads: Request[] = [];

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: CASE_ADMIN });
  downloads.length = 0;
  upstream = () =>
    new Response(CSV, { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8' } });
  // The download answers bytes, which the JSON route table cannot: it is answered here.
  const routed = globalThis.fetch;
  vi.stubGlobal('fetch', (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === DOWNLOAD) {
      downloads.push(new Request(url, init));
      return Promise.resolve(upstream());
    }
    return routed(input, init);
  });
});

afterEach(() => {
  api.restore();
});

const get = (id: string = ID) =>
  GET(new Request(`http://dashboard.test/cases/exports/${id}/download`), {
    params: Promise.resolve({ id }),
  });

describe('an export’s file (C138.1, P26, C142.1)', () => {
  it('passes the file on as a download named by the server, never stored', async () => {
    const response = await get();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="case-export-${ID}.csv"`,
    );
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.text()).toBe(CSV);
    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.headers.get('x-openverify-bff-token')).toBe(BFF_TOKEN);
  });

  it('names a JSON file .json, and passes on the API’s 404 before completion and 410 after 24 hours', async () => {
    upstream = () =>
      new Response('{"data":[]}', { status: 200, headers: { 'content-type': 'application/json' } });
    expect((await get()).headers.get('content-disposition')).toBe(
      `attachment; filename="case-export-${ID}.json"`,
    );

    upstream = () =>
      new Response(JSON.stringify({ type: 'about:blank', title: 'Gone', status: 410 }), {
        status: 410,
        headers: { 'content-type': 'application/problem+json' },
      });
    const gone = await get();
    expect(gone.status).toBe(410);
    expect(await gone.text()).toBe('');
  });

  it('asks nothing without cases:export, without a session, or for an id that is not an export’s', async () => {
    api.me({ permissions: CASE_DEVELOPER });
    expect((await get()).status).toBe(403);
    expect((await get('cexp_nope')).status).toBe(404);
    fakeRequest.reset();
    expect((await get()).status).toBe(401);
    expect(downloads).toHaveLength(0);
  });
});
