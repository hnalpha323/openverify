/**
 * Workflow 8B Stage 1b, checkpoint (F) (C129.5, C135, C138): every route of the (F) family is
 * registered in its implementer's file with its schema and scope, and answers 501 until
 * `api-case-files` builds it (Stage 3). A key without the route's scope gets 403 before anything is
 * read, and a request that does not fit the frozen schema gets 400.
 *
 * Every value is synthetic.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApi, type TestApi } from '../../test-support/harness.js';

const CASE = 'case_01M6FQZCV622MRCK2ZKC7F4HD9';
const ATTACHMENT = 'catt_01M6FQZCV622MRCK2ZKC7F4HD9';
const EXPORT = 'cexp_01M6FQZCV622MRCK2ZKC7F4HD9';

const BOUNDARY = 'synthetic-boundary-0123456789';

/** A multipart body with one synthetic PNG part named `file`. */
function multipart(): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="synthetic.png"\r\n` +
        'Content-Type: image/png\r\n\r\n',
    ),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ]);
}

type Method = 'GET' | 'POST';

interface Frozen {
  method: Method;
  url: string;
  scope: string;
  body?: Record<string, unknown>;
  multipart?: boolean;
}

const UPLOAD: Frozen = {
  method: 'POST',
  url: `/cases/${CASE}/attachments`,
  scope: 'cases:write',
  multipart: true,
};

const CREATE_EXPORT: Frozen = {
  method: 'POST',
  url: '/case-exports',
  scope: 'cases:export',
  body: { data: { type: 'case-export', attributes: { format: 'csv' } } },
};

/** One valid request per frozen route, with the scope it needs. */
const ROUTES: readonly Frozen[] = [
  UPLOAD,
  {
    method: 'GET',
    url: `/cases/${CASE}/attachments/${ATTACHMENT}/content`,
    scope: 'cases:read',
  },
  {
    method: 'GET',
    url: `/cases/${CASE}/attachments/${ATTACHMENT}/content?page=2`,
    scope: 'cases:read',
  },
  {
    method: 'GET',
    url: `/cases/${CASE}/attachments/${ATTACHMENT}/original`,
    scope: 'cases:redact',
  },
  CREATE_EXPORT,
  { method: 'GET', url: '/case-exports', scope: 'cases:export' },
  { method: 'GET', url: `/case-exports/${EXPORT}`, scope: 'cases:export' },
  { method: 'GET', url: `/case-exports/${EXPORT}/download`, scope: 'cases:export' },
];

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
}, 120_000);

afterAll(async () => {
  await api.close();
});

let keys = 0;

const call = (route: Frozen, token: string, body = route.body) =>
  api.app.inject({
    method: route.method,
    url: `/api/v1${route.url}`,
    headers: {
      ...bearer(token),
      // A key of its own per request: one key with another body is a reuse (422).
      'idempotency-key': `synthetic-${String((keys += 1))}`,
      ...(route.multipart === true
        ? { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` }
        : {}),
    },
    ...(route.multipart === true ? { payload: multipart() } : {}),
    ...(body === undefined ? {} : { payload: body }),
  });

/**
 * The routes `api-case-files` built (Stage 3), with what each answers here: 404 for a case, an
 * attachment or an export this environment does not hold; an export of every visible case is made
 * (202) and the caller's own are listed (200).
 */
const BUILT: ReadonlyMap<string, number> = new Map([
  [`POST /cases/${CASE}/attachments`, 404],
  [`GET /cases/${CASE}/attachments/${ATTACHMENT}/content`, 404],
  [`GET /cases/${CASE}/attachments/${ATTACHMENT}/content?page=2`, 404],
  [`GET /cases/${CASE}/attachments/${ATTACHMENT}/original`, 404],
  ['POST /case-exports', 202],
  ['GET /case-exports', 200],
  [`GET /case-exports/${EXPORT}`, 404],
  [`GET /case-exports/${EXPORT}/download`, 404],
]);

const nameOf = (route: Frozen) => `${route.method} ${route.url}`;

describe('the frozen (F) routes (C129.5)', () => {
  it.each(
    ROUTES.filter((route) => BUILT.has(nameOf(route))).map(
      (route) => [nameOf(route), route] as const,
    ),
  )('%s answers as built', async (name, route) => {
    const user = api.newUserToken(api.environmentId);

    const response = await call(route, user);

    expect(response.statusCode, response.body).toBe(BUILT.get(name));
  });

  it.each(
    ROUTES.filter((route) => !BUILT.has(nameOf(route))).map(
      (route) => [`${route.method} ${route.url}`, route] as const,
    ),
  )('%s answers 501 until its owner builds it', async (_name, route) => {
    const user = api.newUserToken(api.environmentId);

    const response = await call(route, user);

    expect(response.statusCode, response.body).toBe(501);
  });

  it.each(ROUTES.map((route) => [`${route.method} ${route.url}`, route] as const))(
    '%s refuses a key without its scope',
    async (_name, route) => {
      const token = await api.newApiKey(api.environmentId, { scopes: ['inquiries:read'] });

      const response = await call(route, token);

      expect(response.statusCode, response.body).toBe(403);
      expect(response.headers['www-authenticate']).toContain(route.scope);
    },
  );

  it('refuses an export with both a filter and a search, or of an unknown format', async () => {
    const user = api.newUserToken(api.environmentId);
    const attributes = (extra: Record<string, unknown>) => ({
      data: { type: 'case-export', attributes: { format: 'csv', ...extra } },
    });

    const both = await call(
      CREATE_EXPORT,
      user,
      attributes({
        filter: { status: ['open'] },
        search: { query: { attribute: 'status', operator: 'eq', value: 'open' } },
      }),
    );
    const unknown = await call(CREATE_EXPORT, user, attributes({ format: 'xlsx' }));

    expect(both.statusCode, both.body).toBe(400);
    expect(unknown.statusCode, unknown.body).toBe(400);
  });

  it('refuses a rendition page past 20, and an id of another kind', async () => {
    const user = api.newUserToken(api.environmentId);

    const page = await call(
      {
        method: 'GET',
        url: `/cases/${CASE}/attachments/${ATTACHMENT}/content?page=21`,
        scope: 'cases:read',
      },
      user,
    );
    const kind = await call(
      { method: 'GET', url: `/case-exports/${CASE}`, scope: 'cases:export' },
      user,
    );

    expect(page.statusCode, page.body).toBe(400);
    expect(kind.statusCode, kind.body).toBe(400);
  });
});
