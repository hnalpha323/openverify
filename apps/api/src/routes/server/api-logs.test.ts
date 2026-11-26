import {
  apiLogDocumentSchema,
  apiLogListDocumentSchema,
  newId,
  type ApiLogResource,
} from '@openverify/contracts';
import { createApiLog, listApiLogs, type NewApiLogInput } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  bearer,
  createTestApi,
  expectStatus,
  type TestApi,
  type TestTenant,
} from '../../test-support/harness.js';

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
});

afterAll(async () => {
  await api.close();
});

const URL = '/api/v1/api-logs';
const PII = {
  fields: { name_first: 'Synthetic-Jane', birthdate: '1990-01-01' },
  note: 'synthetic note',
};

interface Seeded {
  tenant: TestTenant;
  keyA: string;
  keyB: string;
  userId: string;
  /** Oldest first: a POST 201, a GET 404 and a PATCH 500. */
  ids: [string, string, string];
}

/** A fresh environment with three log entries written directly. */
async function seed(): Promise<Seeded> {
  const tenant = await api.newTenant();
  const keyA = newId('key');
  const keyB = newId('key');
  const userId = newId('usr');
  const entries: NewApiLogInput[] = [
    {
      id: newId('alog'),
      method: 'POST',
      path: '/api/v1/inquiries',
      route: '/api/v1/inquiries',
      status: 201,
      durationMs: 12,
      requestId: 'req-seed-1',
      idempotencyKey: 'seed-key-1',
      apiKeyId: keyA,
      ip: '203.0.113.1',
      userAgent: 'SeedClient/1.0',
      query: {},
      requestBody: { data: { attributes: { fields: PII.fields } } },
      responseBody: {
        data: {
          type: 'inquiry',
          id: 'inq_seed',
          attributes: { fields: PII.fields, note: PII.note },
        },
        included: [
          {
            type: 'inquiry-session',
            id: 'iqse_seed',
            attributes: { 'ip-address': '203.0.113.9', 'user-agent': 'Browser' },
          },
        ],
      },
    },
    {
      id: newId('alog'),
      method: 'GET',
      path: '/api/v1/inquiries/inq_missing',
      route: '/api/v1/inquiries/:id',
      status: 404,
      durationMs: 3,
      requestId: 'req-seed-2',
      apiKeyId: keyB,
      ip: '203.0.113.2',
      query: { include: 'verifications' },
      responseBody: { status: 404 },
    },
    {
      id: newId('alog'),
      method: 'PATCH',
      path: '/api/v1/webhooks/wbh_x',
      route: '/api/v1/webhooks/:id',
      status: 500,
      durationMs: 40,
      requestId: 'req-seed-3',
      userId,
      ip: '203.0.113.3',
    },
  ];
  for (const entry of entries) {
    await createApiLog(api.database.db, tenant.environmentId, entry);
  }
  return {
    tenant,
    keyA,
    keyB,
    userId,
    ids: entries.map((entry) => entry.id) as Seeded['ids'],
  };
}

async function list(token: string, query: string) {
  const response = await api.app.inject({ url: `${URL}?${query}`, headers: bearer(token) });
  return apiLogListDocumentSchema.parse(expectStatus(response, 200));
}

const idsOf = (document: { data: ApiLogResource[] }) => document.data.map((log) => log.id);

describe('GET /api/v1/api-logs', () => {
  let seeded: Seeded;

  beforeAll(async () => {
    seeded = await seed();
  });

  it("lists the environment's entries newest first", async () => {
    const [a, b, c] = seeded.ids;

    const document = await list(seeded.tenant.token, 'filter[status]=201,404,500');

    expect(idsOf(document)).toEqual([c, b, a]);
    expect(document.links.next).toBeNull();
  });

  it.each([
    ['filter[method]=POST', [0]],
    ['filter[method]=POST,PATCH', [2, 0]],
    ['filter[status]=4xx', [1]],
    ['filter[status]=500', [2]],
    ['filter[status]=201,5xx', [2, 0]],
    ['filter[route]=/api/v1/webhooks/:id', [2]],
  ])('filters with %s', async (query, expected) => {
    const document = await list(seeded.tenant.token, query);

    expect(idsOf(document)).toEqual(expected.map((index) => seeded.ids[index]));
  });

  it('filters by API key, one or several', async () => {
    const [a, b] = seeded.ids;

    expect(idsOf(await list(seeded.tenant.token, `filter[api-key-id]=${seeded.keyA}`))).toEqual([
      a,
    ]);
    expect(
      idsOf(await list(seeded.tenant.token, `filter[api-key-id]=${seeded.keyA},${seeded.keyB}`)),
    ).toEqual([b, a]);
  });

  it('filters by creation time, start inclusive and end exclusive', async () => {
    const future = encodeURIComponent(new Date(Date.now() + 3_600_000).toISOString());
    const past = encodeURIComponent(new Date(Date.now() - 3_600_000).toISOString());

    const none = await list(seeded.tenant.token, `filter[created-at-start]=${future}`);
    const all = await list(
      seeded.tenant.token,
      `filter[status]=201,404,500&filter[created-at-start]=${past}&filter[created-at-end]=${future}`,
    );

    expect(none.data).toEqual([]);
    expect(idsOf(all)).toHaveLength(3);
  });

  it('pages with page[size], keeping the filters in links.next', async () => {
    const [a, b, c] = seeded.ids;

    const first = await list(seeded.tenant.token, 'filter[status]=201,404,500&page[size]=2');
    const next = first.links.next ?? '';
    const second = apiLogListDocumentSchema.parse(
      expectStatus(await api.app.inject({ url: next, headers: bearer(seeded.tenant.token) }), 200),
    );

    expect(idsOf(first)).toEqual([c, b]);
    expect(next).toContain('filter[status]=201%2C404%2C500');
    expect(idsOf(second)).toEqual([a]);
  });

  it.each([
    'filter[status]=abc',
    'filter[method]=get',
    'filter[api-key-id]=usr_x',
    'page[after]=inq_x',
  ])('answers 400 for %s', async (query) => {
    const response = await api.app.inject({
      url: `${URL}?${query}`,
      headers: bearer(seeded.tenant.token),
    });

    expect(response.statusCode).toBe(400);
  });

  it("never lists another environment's entries", async () => {
    const other = await api.newTenant();

    const document = await list(other.token, 'filter[status]=201,404,500');

    expect(document.data).toEqual([]);
  });

  it('answers 403 forbidden without api-logs:read', async () => {
    const key = await api.newApiKey(seeded.tenant.environmentId, { scopes: ['events:read'] });
    const user = api.newUserToken(seeded.tenant.environmentId, { permissions: ['events:read'] });

    for (const token of [key, user]) {
      const response = await api.app.inject({ url: URL, headers: bearer(token) });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ type: 'https://openverify.dev/problems/forbidden' });
    }
  });

  it('records requests made through the API', async () => {
    const tenant = await api.newTenant();
    await api.app.inject({ url: '/api/v1/inquiry-templates', headers: bearer(tenant.token) });

    await vi.waitFor(async () => {
      const page = await listApiLogs(api.database.db, tenant.environmentId, {
        route: '/api/v1/inquiry-templates',
      });
      expect(page.items).toHaveLength(1);
    });
    const document = await list(tenant.token, 'filter[route]=/api/v1/inquiry-templates');
    expect(document.data[0]?.attributes).toMatchObject({
      method: 'GET',
      status: 200,
      'api-key-id': expect.stringMatching(/^key_/) as unknown,
    });
  });
});

describe('GET /api/v1/api-logs/:id', () => {
  let seeded: Seeded;

  beforeAll(async () => {
    seeded = await seed();
  });

  const get = (id: string, token: string) =>
    api.app.inject({ url: `${URL}/${id}`, headers: bearer(token) });

  it('returns one entry with every C12 attribute', async () => {
    const [a] = seeded.ids;

    const document = apiLogDocumentSchema.parse(
      expectStatus(await get(a, seeded.tenant.token), 200),
    );

    expect(document.data).toEqual({
      type: 'api-log',
      id: a,
      attributes: {
        method: 'POST',
        path: '/api/v1/inquiries',
        route: '/api/v1/inquiries',
        status: 201,
        'duration-ms': 12,
        'request-id': 'req-seed-1',
        'idempotency-key': 'seed-key-1',
        'api-key-id': seeded.keyA,
        'user-id': null,
        'ip-address': '203.0.113.1',
        'user-agent': 'SeedClient/1.0',
        query: {},
        'request-body': { data: { attributes: { fields: PII.fields } } },
        'response-body': {
          data: {
            type: 'inquiry',
            id: 'inq_seed',
            attributes: { fields: PII.fields, note: PII.note },
          },
          included: [
            {
              type: 'inquiry-session',
              id: 'iqse_seed',
              attributes: { 'ip-address': '203.0.113.9', 'user-agent': 'Browser' },
            },
          ],
        },
        'created-at': expect.stringMatching(/Z$/) as unknown,
      },
    });
  });

  it('masks personal data for a user without pii:view, at any depth', async () => {
    const [a] = seeded.ids;
    const token = api.newUserToken(seeded.tenant.environmentId, {
      permissions: ['api-logs:read'],
    });

    const document = apiLogDocumentSchema.parse(expectStatus(await get(a, token), 200));

    expect(document.data.attributes).toMatchObject({
      'ip-address': null,
      'user-agent': null,
      'request-body': { data: { attributes: { fields: { name_first: null, birthdate: null } } } },
      'response-body': {
        data: { attributes: { fields: { name_first: null, birthdate: null }, note: null } },
        included: [{ attributes: { 'ip-address': null, 'user-agent': null } }],
      },
    });
    expect(JSON.stringify(document)).not.toMatch(/Synthetic-Jane|synthetic note|203\.0\.113/);
  });

  it('shows personal data to a user with pii:view', async () => {
    const [a] = seeded.ids;
    const token = api.newUserToken(seeded.tenant.environmentId, {
      permissions: ['api-logs:read', 'pii:view'],
    });

    const document = apiLogDocumentSchema.parse(expectStatus(await get(a, token), 200));

    expect(document.data.attributes['ip-address']).toBe('203.0.113.1');
    expect(JSON.stringify(document)).toContain('Synthetic-Jane');
  });

  it("answers 404 for another environment's entry", async () => {
    const other = await api.newTenant();

    const response = await get(seeded.ids[0], other.token);

    expect(response.statusCode).toBe(404);
  });

  it('answers 404 for an unknown entry and 400 for an id that is not an API log id', async () => {
    expect((await get(newId('alog'), seeded.tenant.token)).statusCode).toBe(404);
    expect((await get('inq_01M5CJXHG07XPHF3HRM6NREDH7', seeded.tenant.token)).statusCode).toBe(400);
  });

  it('answers 403 forbidden without api-logs:read', async () => {
    const token = api.newUserToken(seeded.tenant.environmentId, { permissions: ['pii:view'] });

    const response = await get(seeded.ids[0], token);

    expect(response.statusCode).toBe(403);
  });
});

describe('GET /api/v1/api-logs?filter[user-id]= (C25.9, Workflow 2E)', () => {
  it('filters by the user whose session made the request, one or several', async () => {
    const seeded = await seed();
    const [, , byUser] = seeded.ids;
    const otherUserId = newId('usr');
    const byOtherUser = newId('alog');
    await createApiLog(api.database.db, seeded.tenant.environmentId, {
      id: byOtherUser,
      method: 'GET',
      path: '/api/v1/accounts',
      route: '/api/v1/accounts',
      status: 200,
      durationMs: 5,
      requestId: 'req-other-user',
      userId: otherUserId,
    });

    expect(idsOf(await list(seeded.tenant.token, `filter[user-id]=${seeded.userId}`))).toEqual([
      byUser,
    ]);
    expect(
      idsOf(await list(seeded.tenant.token, `filter[user-id]=${seeded.userId},${otherUserId}`)),
    ).toEqual([byOtherUser, byUser]);
    expect(
      (await list(seeded.tenant.token, `filter[user-id]=${seeded.userId}&filter[status]=4xx`)).data,
    ).toEqual([]);
  });

  it("singles out the requests made with a user's dashboard session", async () => {
    const tenant = await api.newTenant();
    const userId = newId('usr');
    const session = api.newUserToken(tenant.environmentId, {
      permissions: ['inquiry-templates:read', 'api-logs:read'],
      userId,
    });
    await api.app.inject({ url: '/api/v1/inquiry-templates', headers: bearer(session) });
    await api.app.inject({ url: '/api/v1/inquiry-templates', headers: bearer(tenant.token) });

    await vi.waitFor(async () => {
      const page = await listApiLogs(api.database.db, tenant.environmentId, {
        route: '/api/v1/inquiry-templates',
      });
      expect(page.items).toHaveLength(2);
    });
    const document = await list(tenant.token, `filter[user-id]=${userId}`);

    expect(document.data).toHaveLength(1);
    expect(document.data[0]?.attributes).toMatchObject({
      route: '/api/v1/inquiry-templates',
      'user-id': userId,
      'api-key-id': null,
    });
  });

  it('keeps the filter in links.next', async () => {
    const seeded = await seed();
    for (let index = 0; index < 2; index += 1) {
      await createApiLog(api.database.db, seeded.tenant.environmentId, {
        id: newId('alog'),
        method: 'GET',
        path: '/api/v1/events',
        route: '/api/v1/events',
        status: 200,
        durationMs: 1,
        requestId: `req-page-${String(index)}`,
        userId: seeded.userId,
      });
    }

    const first = await list(seeded.tenant.token, `filter[user-id]=${seeded.userId}&page[size]=2`);
    const next = first.links.next ?? '';
    const second = apiLogListDocumentSchema.parse(
      expectStatus(await api.app.inject({ url: next, headers: bearer(seeded.tenant.token) }), 200),
    );

    expect(next).toContain(`filter[user-id]=${seeded.userId}`);
    expect(idsOf(second)).toEqual([seeded.ids[2]]);
  });

  it("never lists another environment's entries of the user", async () => {
    const seeded = await seed();
    const other = await seed();

    expect((await list(other.tenant.token, `filter[user-id]=${seeded.userId}`)).data).toEqual([]);
  });

  it.each(['filter[user-id]=key_x', `filter[user-id]=${newId('key')}`, 'filter[user-id]='])(
    'answers 400 for %s',
    async (query) => {
      const response = await api.app.inject({ url: `${URL}?${query}`, headers: bearer(api.token) });

      expect(response.statusCode).toBe(400);
    },
  );

  it('answers 403 forbidden without api-logs:read', async () => {
    const user = api.newUserToken(api.environmentId, { permissions: ['events:read'] });

    const response = await api.app.inject({
      url: `${URL}?filter[user-id]=${newId('usr')}`,
      headers: bearer(user),
    });

    expect(response.statusCode).toBe(403);
  });
});
