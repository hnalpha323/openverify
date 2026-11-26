// @vitest-environment node
import { CLIENT_USER_AGENT } from '@openverify/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../../../testing/api-fixtures';
import { BFF_TOKEN } from '../../../../../../testing/api-mock';
import { routeApi, type RouteApi } from '../../../../../../testing/api-routes';
import { fakeRequest } from '../../../../../../testing/fake-request';
import { TRANSACTION_IDS } from '../../../../../../testing/transactions-fixtures';
import { GET } from './route';

vi.mock('next/headers', () =>
  import('../../../../../../testing/fake-request').then((m) => m.nextHeaders),
);

const ID = TRANSACTION_IDS.transaction;
const FILE = TRANSACTION_IDS.file;
const CONTENT = `/api/v1/transactions/${ID}/files/${FILE}/content`;
const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

let api: RouteApi;
let upstream: () => Response;
const contentRequests: Request[] = [];

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  contentRequests.length = 0;
  upstream = () =>
    new Response(BYTES, {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
    });
  // The content route answers bytes, which the JSON route table cannot: it is answered here.
  const routed = globalThis.fetch;
  vi.stubGlobal('fetch', (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === CONTENT) {
      contentRequests.push(new Request(url, init));
      return Promise.resolve(upstream());
    }
    return routed(input, init);
  });
});

afterEach(() => {
  api.restore();
});

const get = (id: string = ID, fileId: string = FILE) =>
  GET(new Request(`http://dashboard.test/transactions/${id}/files/${fileId}/content`), {
    params: Promise.resolve({ id, fileId }),
  });

describe("a transaction file's content (C105.2, P12)", () => {
  it('streams the bytes as a download to an operator with pii:view, never stored', async () => {
    api.me({ permissions: ['transactions:read', 'pii:view'] });

    const response = await get();

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES);
    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    expect(response.headers.get('content-disposition')).toBe(`attachment; filename="${FILE}"`);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const sent = contentRequests[0];
    expect(sent?.headers.get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
    expect(sent?.headers.get('x-openverify-bff-token')).toBe(BFF_TOKEN);
    expect(sent?.headers.get('user-agent')).toBe(CLIENT_USER_AGENT);
  });

  it('answers 403 without pii:view, asking the API nothing for the content', async () => {
    api.me({ permissions: ['transactions:read'] });

    expect((await get()).status).toBe(403);
    expect(contentRequests).toHaveLength(0);
  });

  it('passes on a refusal, a missing or replaced file and a redaction as a status without a body', async () => {
    api.me({ permissions: ['transactions:read', 'pii:view'] });
    for (const status of [403, 404, 410]) {
      upstream = () =>
        new Response('{"title":"x"}', {
          status,
          headers: { 'content-type': 'application/problem+json' },
        });
      const response = await get();
      expect(response.status).toBe(status);
      expect(await response.text()).toBe('');
    }
    upstream = () => new Response(null, { status: 500 });
    expect((await get()).status).toBe(502);
  });

  it('answers 404 for ids of the wrong form and 401 without a session, asking nothing', async () => {
    expect((await get('nope')).status).toBe(404);
    expect((await get(ID, 'file_01JD0000000000000000000001')).status).toBe(404);
    fakeRequest.reset();
    expect((await get()).status).toBe(401);
    expect(api.requests).toHaveLength(0);
    expect(contentRequests).toHaveLength(0);
  });
});
