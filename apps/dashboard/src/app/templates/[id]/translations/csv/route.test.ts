// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../../testing/api-fixtures';
import { problemDocument } from '../../../../../testing/api-mock';
import { routeApi, type RouteApi } from '../../../../../testing/api-routes';
import { fakeRequest } from '../../../../../testing/fake-request';
import { LIFECYCLE_IDS } from '../../../../../testing/lifecycle-fixtures';
import {
  translationRow,
  translationsDocument,
  translationsPath,
} from '../../../../../testing/routes/themes-copy';
import { GET, POST } from './route';

vi.mock('next/headers', () =>
  import('../../../../../testing/fake-request').then((m) => m.nextHeaders),
);

let api: RouteApi;
const ID = LIFECYCLE_IDS.template;
const CSV_PATH = `${translationsPath(ID)}.csv`;
const params = (id: string = ID) => ({ params: Promise.resolve({ id }) });
const post = (body: string, headers: Record<string, string> = {}) =>
  new Request('http://dashboard.test/templates/x/translations/csv', {
    method: 'POST',
    headers: { 'content-type': 'text/csv', ...headers },
    body,
  });

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
});

afterEach(() => {
  api.restore();
});

describe('GET /templates/:id/translations/csv (C162.7)', () => {
  it('passes the API file on as a download that is never stored', async () => {
    api.on('GET', CSV_PATH, 200, 'step,component,attribute,en');

    const response = await GET(new Request('http://dashboard.test/'), params());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="translations-${ID}.csv"`,
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('answers a bare status for a failure, a malformed id or no session', async () => {
    api.onProblem('GET', CSV_PATH, 403);
    expect((await GET(new Request('http://dashboard.test/'), params())).status).toBe(403);
    expect((await GET(new Request('http://dashboard.test/'), params('nope'))).status).toBe(404);
    fakeRequest.reset();
    expect((await GET(new Request('http://dashboard.test/'), params())).status).toBe(401);
  });
});

describe('POST /templates/:id/translations/csv (C162.7)', () => {
  it('imports the bytes and answers how many texts the draft holds', async () => {
    api.on(
      'POST',
      CSV_PATH,
      200,
      translationsDocument([translationRow('consent.title', { en: '=1+1' })]),
    );

    const response = await POST(post('step,component,attribute,en'), params());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ imported: 1 });
    expect(api.find('POST', CSV_PATH)?.headers.get('content-type')).toBe('text/csv');
  });

  it('answers each problem of a refused file by row and column, never a value', async () => {
    api.on(
      'POST',
      CSV_PATH,
      422,
      problemDocument(422, undefined, {
        errors: [
          { pointer: '/rows/3/fr', code: 'copy_bidi_override', detail: 'synthetic' },
          { pointer: '/rows/header', code: 'unknown_column', detail: 'unknown_column' },
        ],
      }),
    );

    const response = await POST(post('x'), params());

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      problems: [
        { row: 3, column: 'fr', code: 'copy_bidi_override' },
        { row: null, column: null, code: 'unknown_column' },
      ],
    });
  });

  it('refuses another origin, a file over 2 MiB and a malformed id before calling the API', async () => {
    expect((await POST(post('x', { origin: 'https://elsewhere.example' }), params())).status).toBe(
      403,
    );
    expect(
      (await POST(post('x', { 'content-length': String(3 * 1024 * 1024) }), params())).status,
    ).toBe(413);
    expect((await POST(post('x'), params('nope'))).status).toBe(404);
    expect(api.find('POST', CSV_PATH)).toBeUndefined();
  });

  it('passes a known API status on, and answers 401 without a session', async () => {
    api.onProblem('POST', CSV_PATH, 429);
    expect((await POST(post('x'), params())).status).toBe(429);
    fakeRequest.reset();
    expect((await POST(post('x'), params())).status).toBe(401);
  });
});
