import { randomUUID } from 'node:crypto';
import { apiLogs, listApiLogs, type ApiLog } from '@openverify/db';
import { eq } from 'drizzle-orm';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ulidIdGenerator } from '../ports.js';
import { multipart } from '../test-support/harness.js';
import apiLogsPlugin, { type ApiLogWriter } from './api-logs.js';
import { bearer, createPlatformTest, type PlatformTest } from './platform.test-support.js';

let platform: PlatformTest;

beforeAll(async () => {
  platform = await createPlatformTest();
});

afterAll(async () => {
  await platform.close();
});

const KIB = 1024;
type ProbeApp = ReturnType<typeof probe>;

/** The plugin under test and probe routes. */
function probe(write?: ApiLogWriter) {
  return platform.app((scope) => {
    void scope.register(apiLogsPlugin, {
      db: platform.database.db,
      ids: ulidIdGenerator,
      ...(write === undefined ? {} : { write }),
    });
    scope.post('/api/v1/things', { config: { scopes: [] } }, (request, reply) =>
      reply.code(201).send({
        data: { type: 'thing', id: 'thg_1', attributes: { echo: request.body ?? null } },
        meta: { token: 'ov_sbx_SyntheticSecretTokenThatMustNotBeStored0000' },
      }),
    );
    scope.get('/api/v1/things/:id', { config: { scopes: [] } }, (request) => ({
      data: { type: 'thing', id: (request.params as { id: string }).id },
    }));
    scope.get('/api/v1/lists', { config: { scopes: [] } }, () => ({ data: [] }));
    scope.post('/api/v1/broken', { config: { scopes: [] } }, () => {
      throw new Error('kaboom');
    });
    scope.get('/api/v1/big', { config: { scopes: [] } }, () => ({
      data: Array.from({ length: 2_000 }, (_, index) => ({ index, text: 'x'.repeat(50) })),
    }));
    scope.get('/api/v1/big-inquiries', { config: { scopes: [] } }, () => ({
      data: Array.from({ length: 1_000 }, (_, index) => ({
        type: 'inquiry',
        id: `inq_${String(index)}`,
        attributes: { fields: { name_first: 'Synthetic-Jane' }, note: 'synthetic note' },
        relationships: { sessions: { data: [{ 'ip-address': '203.0.113.77' }] } },
      })),
    }));
    scope.post(
      '/api/v1/validated',
      { config: { scopes: [] }, schema: { body: { type: 'object' } } },
      () => ({ ok: true }),
    );
    scope.get('/api/v1/text', { config: { scopes: [] } }, (_request, reply) =>
      reply.type('text/plain').send('plain words'),
    );
    // C253.1 (Stage 1a amendment 48): the access export's manifest and file answers.
    scope.get('/api/v1/account-exports/:id/manifest', { config: { scopes: [] } }, () => ({
      schema: 'openverify.account-export.v1',
      subject: { account: { attributes: { fields: { 'name-first': 'Synthetic-Jane' } } } },
    }));
    scope.get('/api/v1/account-exports/:id/files/:fileId', { config: { scopes: [] } }, () => ({
      note: 'a JSON file of the subject: Synthetic-Jane',
    }));
    scope.get('/health', { config: { public: true } }, () => ({ status: 'ok' }));
    scope.get('/api/v1/flow/session', { config: { auth: 'session-token' } }, () => ({ ok: 1 }));
    void scope.register((uploads, _options, done) => {
      uploads.addContentTypeParser(
        'multipart/form-data',
        { parseAs: 'buffer' },
        (_request, body, parsed) => {
          parsed(null, body);
        },
      );
      uploads.post('/api/v1/uploads', { config: { scopes: [] } }, () => ({ uploaded: true }));
      done();
    });
  });
}

/** Sends a request with a unique request id, so its log entry can be found. */
async function send(app: ProbeApp, options: InjectOptions & { headers?: Record<string, string> }) {
  const requestId = randomUUID();
  const response = await app.inject({
    ...options,
    headers: { ...options.headers, 'x-request-id': requestId },
  });
  return { response, requestId };
}

/** The entry of one request, which the onResponse hook writes after the response. */
async function logOf(environmentId: string, requestId: string): Promise<ApiLog> {
  let found: ApiLog | undefined;
  await vi.waitFor(async () => {
    const { items } = await listApiLogs(platform.database.db, environmentId, { size: 100 });
    found = items.find((item) => item.requestId === requestId);
    expect(found).toBeDefined();
  });
  if (found === undefined) {
    throw new Error('no log entry');
  }
  return found;
}

describe('API logs (C12)', () => {
  it('records a server API request after its response, with the C12 attributes', async () => {
    const app = probe();
    const [tenant] = platform.tenants;

    const { response, requestId } = await send(app, {
      method: 'POST',
      url: '/api/v1/things?include=everything',
      headers: {
        ...bearer(tenant.token),
        'idempotency-key': 'log-test-001',
        'user-agent': 'SyntheticClient/1.0',
      },
      remoteAddress: '203.0.113.10',
      payload: { data: { attributes: { name: 'Synthetic' } } },
    });

    const log = await logOf(tenant.environmentId, requestId);
    expect(response.statusCode).toBe(201);
    expect(log).toMatchObject({
      id: expect.stringMatching(/^alog_/) as unknown,
      method: 'POST',
      path: '/api/v1/things',
      route: '/api/v1/things',
      status: 201,
      requestId,
      idempotencyKey: 'log-test-001',
      apiKeyId: tenant.apiKeyId,
      userId: null,
      resourceId: 'thg_1',
      ip: '203.0.113.10',
      userAgent: 'SyntheticClient/1.0',
      query: { include: 'everything' },
      requestBody: { data: { attributes: { name: 'Synthetic' } } },
      responseBody: {
        data: {
          type: 'thing',
          id: 'thg_1',
          attributes: { echo: { data: { attributes: { name: 'Synthetic' } } } },
        },
        meta: { token: '[REDACTED]' },
      },
    });
    expect(log.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('replaces secret-bearing values with [REDACTED] at any depth, in the query and both bodies', async () => {
    const app = probe();
    const [, tenant] = platform.tenants;

    const { requestId } = await send(app, {
      method: 'POST',
      url: '/api/v1/things?code=123456&keep=yes',
      headers: bearer(tenant.token),
      payload: {
        password: 'synthetic-password',
        nested: { 'session-token': 'ovs_x', list: [{ secret: 's', 'totp-code': '000000' }] },
        'one-time-link': 'https://flow.example.test/#x',
        'recovery-code': 'AAAA-BBBB-CCCC',
        keep: 'visible',
      },
    });

    const log = await logOf(tenant.environmentId, requestId);
    expect(log.query).toEqual({ code: '[REDACTED]', keep: 'yes' });
    expect(log.requestBody).toEqual({
      password: '[REDACTED]',
      nested: {
        'session-token': '[REDACTED]',
        list: [{ secret: '[REDACTED]', 'totp-code': '[REDACTED]' }],
      },
      'one-time-link': '[REDACTED]',
      'recovery-code': '[REDACTED]',
      keep: 'visible',
    });
    expect(JSON.stringify(log)).not.toMatch(/synthetic-password|AAAA-BBBB|SyntheticSecretToken/);
  });

  it('records 5xx answers with their problem document', async () => {
    const app = probe();
    const [tenant] = platform.tenants;

    const { requestId } = await send(app, {
      method: 'POST',
      url: '/api/v1/broken',
      headers: bearer(tenant.token),
    });

    expect(await logOf(tenant.environmentId, requestId)).toMatchObject({
      status: 500,
      requestBody: null,
      responseBody: { status: 500, title: 'Internal Server Error' },
    });
  });

  it('truncates bodies over 64 KiB, keeping a preview of the start', async () => {
    const app = probe();
    const [tenant] = platform.tenants;

    const { response, requestId } = await send(app, {
      url: '/api/v1/big',
      headers: bearer(tenant.token),
    });

    const stored = (await logOf(tenant.environmentId, requestId)).responseBody;
    expect(stored).toEqual({
      truncated: true,
      'byte-length': Buffer.byteLength(response.body),
      preview: expect.stringMatching(/^\{"data":\[\{"index":0,/) as unknown,
    });
    expect(Buffer.byteLength(JSON.stringify(stored))).toBeLessThanOrEqual(64 * KIB);
    expect(Buffer.byteLength(JSON.stringify(stored))).toBeGreaterThan(60 * KIB);
  });

  it('keeps PII out of the preview of a truncated body, so masking cannot be bypassed (2B F008)', async () => {
    const app = probe();
    const [tenant] = platform.tenants;

    const { response, requestId } = await send(app, {
      url: '/api/v1/big-inquiries',
      headers: bearer(tenant.token),
    });

    const stored = (await logOf(tenant.environmentId, requestId)).responseBody;
    expect(stored).toMatchObject({
      truncated: true,
      'byte-length': Buffer.byteLength(response.body),
      preview: expect.stringMatching(/^\{"data":\[\{"type":"inquiry","id":"inq_0",/) as unknown,
    });
    expect(JSON.stringify(stored)).not.toMatch(/Synthetic-Jane|synthetic note|203\.0\.113\.77/);
  });

  it('answers a body nested too deeply to log as the route would, and logs it without the body (2B F034)', async () => {
    const app = probe();
    const [tenant] = platform.tenants;
    const depth = 100_000;

    const { response, requestId } = await send(app, {
      method: 'POST',
      url: '/api/v1/validated',
      headers: { ...bearer(tenant.token), 'content-type': 'application/json' },
      payload: `${'['.repeat(depth)}${']'.repeat(depth)}`,
    });

    expect(response.statusCode).toBe(400);
    expect((await logOf(tenant.environmentId, requestId)).requestBody).toBeNull();
  });

  it('stores multipart bodies as part metadata only, never their bytes', async () => {
    const app = probe();
    const [tenant] = platform.tenants;
    const body = await multipart({
      kind: 'front',
      file: {
        bytes: new TextEncoder().encode('synthetic-image-bytes-marker'),
        filename: 'front.jpg',
        type: 'image/jpeg',
      },
    });

    const { requestId } = await send(app, {
      method: 'POST',
      url: '/api/v1/uploads',
      headers: { ...bearer(tenant.token), ...body.headers },
      payload: body.payload,
    });

    const log = await logOf(tenant.environmentId, requestId);
    expect(log.requestBody).toEqual({
      parts: [
        { name: 'kind', filename: null, 'content-type': null, size: 5 },
        { name: 'file', filename: 'front.jpg', 'content-type': 'image/jpeg', size: 28 },
      ],
    });
    expect(JSON.stringify(log)).not.toContain('synthetic-image-bytes-marker');
  });

  it('keeps non-JSON response bodies out of the log', async () => {
    const app = probe();
    const [tenant] = platform.tenants;

    const { requestId } = await send(app, { url: '/api/v1/text', headers: bearer(tenant.token) });

    expect((await logOf(tenant.environmentId, requestId)).responseBody).toBeNull();
  });

  it('never keeps the access export’s manifest or file in the log (C253.1, amendment 48)', async () => {
    const app = probe();
    const [tenant] = platform.tenants;

    const manifest = await send(app, {
      url: '/api/v1/account-exports/aexp_01M5CN0000000000000011B100/manifest',
      headers: bearer(tenant.token),
    });
    const file = await send(app, {
      url: '/api/v1/account-exports/aexp_01M5CN0000000000000011B100/files/file_01M5CK17N82ZP0PQ8RZRRTT5V5',
      headers: bearer(tenant.token),
    });

    expect(manifest.response.json()).toMatchObject({ schema: 'openverify.account-export.v1' });
    for (const { requestId } of [manifest, file]) {
      const entry = await logOf(tenant.environmentId, requestId);
      expect(entry.responseBody).toBeNull();
      expect(entry.status).toBe(200);
      expect(JSON.stringify(entry)).not.toContain('Synthetic-Jane');
    }
  });

  it('links a request to the resource in its path when the answer names none', async () => {
    const app = probe();
    const [tenant] = platform.tenants;

    const list = await send(app, { url: '/api/v1/lists', headers: bearer(tenant.token) });
    const single = await send(app, {
      url: '/api/v1/things/thg_from_path',
      headers: bearer(tenant.token),
    });

    expect((await logOf(tenant.environmentId, list.requestId)).resourceId).toBeNull();
    expect((await logOf(tenant.environmentId, single.requestId)).resourceId).toBe('thg_from_path');
  });

  it('attributes dashboard user sessions to the user', async () => {
    const app = probe();
    const [, tenant] = platform.tenants;

    const { requestId } = await send(app, {
      url: '/api/v1/lists',
      headers: bearer(platform.userToken(tenant.environmentId)),
    });

    expect(await logOf(tenant.environmentId, requestId)).toMatchObject({
      userId: platform.userId,
      apiKeyId: null,
    });
  });

  it('cuts user agents to the length the contract allows', async () => {
    const app = probe();
    const [, tenant] = platform.tenants;

    const { requestId } = await send(app, {
      url: '/api/v1/things/thg_ua',
      headers: { ...bearer(tenant.token), 'user-agent': 'U'.repeat(3_000) },
    });

    expect((await logOf(tenant.environmentId, requestId)).userAgent).toBe('U'.repeat(1_024));
  });

  it('stores the address, user agent, query and bodies encrypted', async () => {
    const app = probe();
    const [, tenant] = platform.tenants;

    const { requestId } = await send(app, {
      method: 'POST',
      url: '/api/v1/things?q=query-marker-91',
      headers: { ...bearer(tenant.token), 'user-agent': 'agent-marker-91' },
      remoteAddress: '198.51.100.91',
      payload: { field: 'body-marker-91' },
    });

    const log = await logOf(tenant.environmentId, requestId);
    const [row] = await platform.database.db.select().from(apiLogs).where(eq(apiLogs.id, log.id));
    expect(row).toBeDefined();
    expect(JSON.stringify(row)).not.toMatch(/marker-91|198\.51\.100\.91/);
  });

  it('records nothing for unauthenticated requests, public routes or other APIs', async () => {
    const write = vi.fn<ApiLogWriter>(() => Promise.resolve());
    const app = probe(write);

    await app.inject({ url: '/api/v1/lists' });
    await app.inject({ url: '/health' });
    expect((await app.inject({ url: '/early' })).statusCode).toBe(200);
    await app.inject({ url: '/api/v1/flow/session' });
    await app.inject({ url: '/api/v1/lists', headers: bearer(platform.tenants[0].token) });

    await vi.waitFor(() => {
      expect(write).toHaveBeenCalledOnce();
    });
    expect(write.mock.calls[0]?.[1]).toBe(platform.tenants[0].environmentId);
    expect(app.logs.filter((line) => Number(line.level) >= 50)).toEqual([]);
  });

  it('logs a failed write and never fails the request', async () => {
    const app = probe(() => Promise.reject(new Error('database unavailable')));

    const response = await app.inject({
      url: '/api/v1/lists',
      headers: bearer(platform.tenants[0].token),
    });

    expect(response.statusCode).toBe(200);
    await vi.waitFor(() => {
      expect(app.logs).toContainEqual(
        expect.objectContaining({ level: 50, msg: expect.stringMatching(/API log/) as unknown }),
      );
    });
  });
});
