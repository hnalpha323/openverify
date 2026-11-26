import { readFileSync } from 'node:fs';
import {
  defaultInquiryTemplateAttributes,
  LATEST_API_VERSION,
  newId,
  newSessionToken,
} from '@openverify/contracts';
import { createInquirySession, hashSessionToken } from '@openverify/db';
import { createTestInquiry } from '@openverify/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { buildApp, type BuildAppOptions } from './app.js';
import { createDbApiKeyAuthenticator } from './auth/api-key-lookup.js';
import { USER_SESSION_SECURITY_SCHEME } from './routes/dashboard/openapi.js';
import { createAllowAllRateLimiter } from './test-support/fakes.js';
import { bearer, createTestApi, TEST_PEPPER, type TestApi } from './test-support/harness.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const packageVersion = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

const apps: ReturnType<typeof buildApp>[] = [];

function makeApp(options: Partial<BuildAppOptions> = {}) {
  const app = buildApp({ lookupApiKey: () => Promise.resolve(null), logger: false, ...options });
  apps.push(app);
  return app;
}

function captureLogs() {
  const lines: Record<string, unknown>[] = [];
  const stream = {
    write(line: string) {
      lines.push(JSON.parse(line) as Record<string, unknown>);
    },
  };
  return { lines, stream, text: () => JSON.stringify(lines) };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('GET /health', () => {
  it('reports ok with the package version', async () => {
    const response = await makeApp().inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.json()).toEqual({ status: 'ok', version: packageVersion });
  });

  it('reports the version it was built with', async () => {
    const response = await makeApp({ version: '1.2.3' }).inject({ url: '/health' });

    expect(response.json()).toEqual({ status: 'ok', version: '1.2.3' });
  });

  it('is public: it needs no API key and never calls the key lookup', async () => {
    const lookupApiKey = vi.fn(() => Promise.resolve(null));
    const response = await makeApp({ lookupApiKey }).inject({ url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(lookupApiKey).not.toHaveBeenCalled();
  });
});

describe('x-request-id', () => {
  it('generates a UUID when the client sends none and echoes it back', async () => {
    const app = makeApp();
    const first = await app.inject({ url: '/health' });
    const second = await app.inject({ url: '/health' });

    expect(first.headers['x-request-id']).toMatch(UUID);
    expect(second.headers['x-request-id']).toMatch(UUID);
    expect(first.headers['x-request-id']).not.toBe(second.headers['x-request-id']);
  });

  it('echoes a well-formed client request id', async () => {
    const response = await makeApp().inject({
      url: '/health',
      headers: { 'x-request-id': 'edge-01:req.42_A-b' },
    });

    expect(response.headers['x-request-id']).toBe('edge-01:req.42_A-b');
  });

  it.each([
    ['contains spaces', 'not a valid id'],
    ['contains markup', '<script>alert(1)</script>'],
    ['is longer than 128 characters', 'a'.repeat(129)],
    ['is empty', ''],
  ])('replaces a client request id that %s', async (_label, value) => {
    const response = await makeApp().inject({
      url: '/health',
      headers: { 'x-request-id': value },
    });

    expect(response.headers['x-request-id']).toMatch(UUID);
  });

  it('is sent on error responses too', async () => {
    const response = await makeApp().inject({
      url: '/does-not-exist',
      headers: { 'x-request-id': 'trace-404' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers['x-request-id']).toBe('trace-404');
  });

  it('labels every log line of the request with requestId', async () => {
    const logs = captureLogs();
    const app = makeApp({ logger: { level: 'info', stream: logs.stream } });

    await app.inject({ url: '/health', headers: { 'x-request-id': 'trace-log' } });

    const requestLines = logs.lines.filter((line) => 'req' in line || 'res' in line);
    expect(requestLines.length).toBeGreaterThanOrEqual(2);
    for (const line of requestLines) {
      expect(line.requestId).toBe('trace-log');
    }
  });
});

describe('logging', () => {
  it('redacts credentials and any "pii" field before writing a log line', async () => {
    const logs = captureLogs();
    const app = makeApp({ logger: { level: 'info', stream: logs.stream } });
    app.get('/log-probe', { config: { public: true } }, (request) => {
      request.log.info(
        {
          headers: request.headers,
          pii: { name: 'Jane Example' },
          account: { pii: { email: 'jane@example.test' } },
          inquiry: { fields: { pii: 'deep secret' } },
          verification: { checks: { name: { pii: 'deeper secret' } } },
          checkId: 'id_glare_detection',
        },
        'probe',
      );
      return { ok: true };
    });

    const response = await app.inject({
      url: '/log-probe',
      headers: {
        authorization: 'Bearer ov_sbx_synthetic-secret',
        cookie: 'session=synthetic-cookie',
        'proxy-authorization': 'Basic c3ludGhldGlj',
      },
    });

    expect(response.statusCode).toBe(200);
    const probe = logs.lines.find((line) => line.msg === 'probe');
    expect(probe).toMatchObject({
      headers: {
        authorization: '[REDACTED]',
        cookie: '[REDACTED]',
        'proxy-authorization': '[REDACTED]',
        'user-agent': 'lightMyRequest',
      },
      pii: '[REDACTED]',
      account: { pii: '[REDACTED]' },
      inquiry: { fields: { pii: '[REDACTED]' } },
      verification: { checks: { name: { pii: '[REDACTED]' } } },
      checkId: 'id_glare_detection',
    });
    for (const secret of [
      'ov_sbx_synthetic-secret',
      'synthetic-cookie',
      'c3ludGhldGlj',
      'Jane Example',
      'jane@example.test',
      'deep secret',
      'deeper secret',
    ]) {
      expect(logs.text()).not.toContain(secret);
    }
  });

  it('never writes credentials when a whole request, or its headers, is logged', async () => {
    const logs = captureLogs();
    const app = makeApp({ logger: { level: 'info', stream: logs.stream } });
    app.get('/log-req', { config: { public: true } }, (request) => {
      request.log.info({ req: request, upstream: { headers: request.headers } }, 'req probe');
      return { ok: true };
    });

    await app.inject({
      url: '/log-req',
      headers: { authorization: 'Bearer ov_sbx_synthetic-secret', cookie: 'a=synthetic' },
    });

    // C93.7 (P06): the req serializer keeps the method and the route pattern only, never headers.
    expect(logs.lines.find((line) => line.msg === 'req probe')).toMatchObject({
      req: { method: 'GET', route: '/log-req' },
      upstream: { headers: { authorization: '[REDACTED]', cookie: '[REDACTED]' } },
    });
    expect(logs.text()).not.toContain('ov_sbx_synthetic-secret');
    expect(logs.text()).not.toContain('a=synthetic');
  });
});

describe('the request log (C93.7, P06; Workflow 7A)', () => {
  it('logs the method, the route pattern and the request id, never the URL, a query or the address', async () => {
    const logs = captureLogs();
    const app = makeApp({ logger: { level: 'info', stream: logs.stream }, trustProxy: true });
    app.get('/probe/:token', { config: { public: true } }, () => ({ ok: true }));

    const response = await app.inject({
      url: '/probe/synthetic-path-token?email=quinn%40example.com&ip=198.51.100.77',
      headers: {
        'x-request-id': 'trace-c937',
        'x-forwarded-for': '203.0.113.66',
        host: 'synthetic-host.example.org',
      },
      remoteAddress: '192.0.2.55',
    });

    expect(response.statusCode).toBe(200);
    const incoming = logs.lines.find((line) => line.msg === 'incoming request');
    expect(incoming).toMatchObject({
      requestId: 'trace-c937',
      req: { method: 'GET', route: '/probe/:token' },
    });
    expect(Object.keys(incoming?.req as object).sort()).toEqual(['method', 'route']);
    for (const value of [
      'synthetic-path-token',
      'quinn',
      'example.com',
      '198.51.100.77',
      '203.0.113.66',
      '192.0.2.55',
      'synthetic-host',
      'remoteAddress',
      'remotePort',
    ]) {
      expect(logs.text(), value).not.toContain(value);
    }
  });

  it('names no route for a request that matched none, and still logs no URL', async () => {
    const logs = captureLogs();
    const app = makeApp({ logger: { level: 'info', stream: logs.stream } });

    await app.inject({ url: '/nowhere/synthetic-secret-path?q=1', remoteAddress: '198.51.100.8' });

    expect(logs.lines.find((line) => line.msg === 'incoming request')).toMatchObject({
      req: { method: 'GET', route: null },
    });
    expect(logs.text()).not.toContain('synthetic-secret-path');
    expect(logs.text()).not.toContain('198.51.100.8');
  });

  it('logs a flow call without its address or a query value', async () => {
    const logs = captureLogs();
    const api = await createTestApi();
    const app = buildApp({
      lookupApiKey: () => Promise.resolve(null),
      logger: { level: 'info', stream: logs.stream },
      api: api.deps,
    });
    apps.push(app);

    await app.inject({
      url: '/api/v1/flow/session?inquiry-id=inq_synthetic&handoff=ovh_synthetic',
      headers: { authorization: 'Bearer ovs_synthetic-not-a-session' },
      remoteAddress: '203.0.113.123',
    });
    await api.close();

    expect(logs.lines.find((line) => line.msg === 'incoming request')).toMatchObject({
      req: { method: 'GET', route: '/api/v1/flow/session' },
    });
    for (const value of ['203.0.113.123', 'inq_synthetic', 'ovh_synthetic', 'ovs_synthetic']) {
      expect(logs.text(), value).not.toContain(value);
    }
  });
});

describe('GET /openapi.json', () => {
  it('serves an OpenAPI 3.1 document generated from the zod route schemas', async () => {
    const response = await makeApp({ version: '9.9.9' }).inject({ url: '/openapi.json' });
    const document = response.json<{
      openapi: string;
      info: { title: string; version: string };
      paths: Record<string, Record<string, unknown>>;
      components: { securitySchemes: Record<string, unknown> };
      security: unknown[];
    }>();

    expect(response.statusCode).toBe(200);
    expect(document.openapi).toMatch(/^3\.1\.\d+$/);
    expect(document.info).toMatchObject({ title: 'OpenVerify API', version: '9.9.9' });
    expect(document.paths['/health']?.get).toMatchObject({
      security: [],
      responses: {
        200: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string', enum: ['ok'] },
                  version: { type: 'string' },
                },
                required: ['status', 'version'],
              },
            },
          },
        },
      },
    });
  });

  it('declares bearer API keys as the default security and hides itself', async () => {
    const response = await makeApp().inject({ url: '/openapi.json' });
    const document = response.json<{
      paths: Record<string, unknown>;
      components: { securitySchemes: Record<string, unknown> };
      security: unknown[];
    }>();

    expect(document.components.securitySchemes).toEqual({
      apiKey: expect.objectContaining({ type: 'http', scheme: 'bearer' }) as unknown,
    });
    expect(document.security).toEqual([{ apiKey: [] }]);
    expect(Object.keys(document.paths)).not.toContain('/openapi.json');
  });

  it('declares that server operations also accept user sessions once a resolver is wired (C12)', async () => {
    const response = await makeApp({ resolveUserSession: () => Promise.resolve(null) }).inject({
      url: '/openapi.json',
    });
    const document = response.json<{
      components: { securitySchemes: Record<string, unknown> };
      security: unknown[];
    }>();

    expect(document.components.securitySchemes).toEqual({
      apiKey: expect.objectContaining({ type: 'http', scheme: 'bearer' }) as unknown,
      ...USER_SESSION_SECURITY_SCHEME,
    });
    // Either scheme authorizes a server API operation (OpenAPI: alternatives are listed apart).
    expect(document.security).toEqual([{ apiKey: [] }, { userSession: [] }]);
  });

  it('documents routes registered as plugins; they inherit API key security', async () => {
    const app = makeApp();
    void app.register((routes, _options, done) => {
      routes.get(
        '/v1/probe',
        {
          config: { scopes: ['events:read'] },
          schema: { response: { 200: z.object({ ok: z.boolean() }) } },
        },
        () => ({ ok: true }),
      );
      done();
    });

    const document = (await app.inject({ url: '/openapi.json' })).json<{
      paths: Record<string, { get?: Record<string, unknown> }>;
    }>();

    expect(document.paths['/v1/probe']?.get).toMatchObject({ responses: { 200: {} } });
    expect(document.paths['/v1/probe']?.get).not.toHaveProperty('security');
  });

  it('is public', async () => {
    const lookupApiKey = vi.fn(() => Promise.resolve(null));
    const response = await makeApp({ lookupApiKey }).inject({ url: '/openapi.json' });

    expect(response.statusCode).toBe(200);
    expect(lookupApiKey).not.toHaveBeenCalled();
  });
});

describe('C12 platform behaviour when the API is served', () => {
  let api: TestApi;

  beforeAll(async () => {
    api = await createTestApi();
  });

  afterAll(async () => {
    await api.close();
  });

  it('rate-limits server API requests and echoes the API version', async () => {
    const response = await api.app.inject({
      url: '/api/v1/inquiry-templates',
      headers: bearer(api.token),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers).toMatchObject({
      'ratelimit-limit': '300',
      'ratelimit-remaining': expect.stringMatching(/^\d+$/) as unknown,
      'ratelimit-reset': '60',
      'openverify-version': LATEST_API_VERSION,
    });
    expect(api.rateLimiter.calls.at(-1)?.policy).toEqual({
      name: 'api',
      limit: 300,
      windowSeconds: 60,
    });
  });

  it('rate-limits flow API calls per client address and per session', async () => {
    const template = defaultInquiryTemplateAttributes();
    const { inquiry } = await createTestInquiry(api.database.db, api.environmentId, {
      flow: template.flow,
      verificationConfig: template['verification-config'],
    });
    const sessionToken = newSessionToken();
    await createInquirySession(api.database.db, api.environmentId, {
      id: newId('iqse'),
      inquiryId: inquiry.id,
      tokenHash: hashSessionToken(sessionToken),
      expiresAt: new Date(api.clock.now().getTime() + 3_600_000),
    });
    const before = api.rateLimiter.calls.length;

    const response = await api.app.inject({
      url: '/api/v1/flow/session',
      headers: bearer(sessionToken),
      remoteAddress: '203.0.113.50',
    });

    expect(response.statusCode).toBe(200);
    expect(api.rateLimiter.calls.slice(before).map(({ policy }) => policy.name)).toEqual([
      'flow-ip',
      'flow-session',
    ]);
  });

  it('replays idempotent server API requests', async () => {
    const send = () =>
      api.app.inject({
        method: 'POST',
        url: '/api/v1/webhooks',
        headers: { ...bearer(api.token), 'idempotency-key': 'app-wiring-webhook-1' },
        payload: {
          data: {
            type: 'webhook',
            attributes: { url: 'https://hooks.example.test/a', 'enabled-events': ['*'] },
          },
        },
      });

    const first = await send();
    const retry = await send();

    expect(first.statusCode).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body).toBe(first.body);
  });

  it('still serves /openapi.json, whose route predates the platform plugins', async () => {
    const response = await api.app.inject({ url: '/openapi.json' });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ paths: Record<string, unknown> }>().paths).toHaveProperty(
      '/api/v1/rate-limits',
    );
  });

  it('applies the configured limits', async () => {
    const app = buildApp({
      lookupApiKey: createDbApiKeyAuthenticator({ db: api.database.db, pepper: TEST_PEPPER })
        .lookup,
      logger: false,
      api: { ...api.deps, rateLimiter: createAllowAllRateLimiter() },
      rateLimits: { api: 5 },
    });
    apps.push(app);

    const response = await app.inject({
      url: '/api/v1/inquiry-templates',
      headers: bearer(api.token),
    });

    expect(response.headers['ratelimit-limit']).toBe('5');
  });

  it('serves the API without the platform plugins only when no API is given', async () => {
    const response = await makeApp().inject({ url: '/health' });

    expect(response.headers['ratelimit-limit']).toBeUndefined();
    expect(response.headers['openverify-version']).toBeUndefined();
  });
});
