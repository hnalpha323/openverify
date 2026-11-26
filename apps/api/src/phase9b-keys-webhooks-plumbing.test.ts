/**
 * Workflow 9B Stage 1b, checkpoint (W): the keys and webhooks plumbing `foundation-9b` freezes for
 * `api-keys-webhooks` (C169.1-C169.6; contracts B3, B29, B30):
 *
 * - `POST /api-keys/:id/rotate`, under `api-keys:write`, with the contract's body and answer, 501 until
 *   built, and listed in the OpenAPI document;
 * - the members Stage 1a added to the key and webhook bodies (`note`, `attribute-blocklist`, `name`,
 *   `description`, `failure-alert`) refused with 501 until built, never accepted and ignored (fail
 *   closed: a key created with a blocklist must never see what it blocks);
 * - the key attribute blocklist hook: an `onSend` hook of `plugins/api-version.ts` that hands the
 *   serialized body of every answer to a key with a blocklist to `applyKeyAttributeBlocklist`, and
 *   sends, replays and logs what it answers (B3);
 * - the delivery attempt headers hook in the dispatcher, after the custom headers and before the
 *   dispatcher's own.
 *
 * Every value is synthetic.
 */
import { buildVerificationResource, newId, newWebhookSecret } from '@openverify/contracts';
import { createApiKey, createWebhook, generateApiKey, listApiLogs } from '@openverify/db';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { createDbApiKeyAuthenticator } from './auth/api-key-lookup.js';
import { createEventPublisher } from './events/index.js';
import { createCapturingLogger, createRecordingQueue } from './jobs/testing.js';
import { applyKeyAttributeBlocklist } from './services/api-keys/blocklist.js';
import {
  bearer,
  createTestApi,
  TEST_PEPPER,
  type TestApi,
  type TestApp,
} from './test-support/harness.js';
import { deliveryAttemptHeaders } from './webhooks/attempt-headers/headers.js';
import { DEFAULT_WEBHOOK_RETRY_POLICY, deliverWebhook } from './webhooks/dispatcher.js';
import type { WebhookHttpRequest, WebhookSender } from './webhooks/http-sender.js';
import { createWebhookDeliveryScheduler, type WebhookDeliveryJob } from './webhooks/queue.js';

vi.mock('./services/api-keys/blocklist.js', { spy: true });
vi.mock('./webhooks/attempt-headers/headers.js', { spy: true });

let api: TestApi;
/** The API with the key pepper, so keys can be created and rotated. */
let app: TestApp;

beforeAll(async () => {
  api = await createTestApi();
  const authenticator = createDbApiKeyAuthenticator({
    db: api.database.db,
    pepper: TEST_PEPPER,
    clock: api.clock,
  });
  app = buildApp({
    lookupApiKey: authenticator.lookup,
    onAuthenticated: authenticator.touch,
    now: () => api.clock.now(),
    logger: false,
    mode: 'test',
    api: api.deps,
    apiKeyPepper: TEST_PEPPER,
  });
});

afterAll(async () => {
  await app.close();
  await api.close();
});

afterEach(() => {
  vi.clearAllMocks();
});

const call = (
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  token: string,
  payload?: Record<string, unknown>,
) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: bearer(token),
    ...(payload === undefined ? {} : { payload }),
  });

const keyBody = (attributes: Record<string, unknown> = {}) => ({
  data: {
    type: 'api-key',
    attributes: { name: 'Synthetic', scopes: ['inquiries:read'], ...attributes },
  },
});
const webhookBody = (attributes: Record<string, unknown> = {}) => ({
  data: {
    type: 'webhook',
    attributes: {
      url: 'https://hooks.example.test/openverify',
      'enabled-events': ['inquiry.completed'],
      ...attributes,
    },
  },
});

async function newKeyId(token: string): Promise<string> {
  const response = await call('POST', '/api-keys', token, keyBody());
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ data: { id: string } }>().data.id;
}

async function newWebhookId(token: string): Promise<string> {
  const response = await call('POST', '/webhooks', token, webhookBody());
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ data: { id: string } }>().data.id;
}

describe('POST /api-keys/:id/rotate, frozen for api-keys-webhooks (C169.1)', () => {
  it('answers 201 to a caller holding api-keys:write (built by api-keys-webhooks)', async () => {
    const tenant = await api.newTenant();
    const id = await newKeyId(tenant.token);

    const response = await call('POST', `/api-keys/${id}/rotate`, tenant.token, {
      meta: { 'previous-expires-in-seconds': 3600 },
    });

    expect(response.statusCode, response.body).toBe(201);
  });

  it('needs api-keys:write', async () => {
    const tenant = await api.newTenant();
    const id = await newKeyId(tenant.token);
    const reader = await api.newApiKey(tenant.environmentId, { scopes: ['api-keys:read'] });

    const response = await call('POST', `/api-keys/${id}/rotate`, reader, {
      meta: { 'previous-expires-in-seconds': 0 },
    });

    expect(response.statusCode, response.body).toBe(403);
  });

  it('reads the contract: the previous token lasts 0 to 30 days, and the body has a meta', async () => {
    const tenant = await api.newTenant();
    const id = await newKeyId(tenant.token);

    const statuses = await Promise.all(
      [{ meta: { 'previous-expires-in-seconds': 2_592_001 } }, { meta: {} }, {}].map(
        async (body) =>
          (await call('POST', `/api-keys/${id}/rotate`, tenant.token, body)).statusCode,
      ),
    );

    expect(statuses).toEqual([400, 400, 400]);
  });

  it('is listed in the OpenAPI document with the new key and 501', async () => {
    const { paths } = (await app.inject({ url: '/openapi.json' })).json<{
      paths: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
    }>();
    const operation = paths['/api/v1/api-keys/{id}/rotate']?.post;
    expect(operation).toBeDefined();
    expect(Object.keys(operation?.responses ?? {})).toEqual(
      expect.arrayContaining(['201', '400', '401', '403', '404']),
    );
  });
});

describe('the members api-keys-webhooks builds (contracts B29, B30)', () => {
  it.each([
    ['note', { note: 'Synthetic reconciliation job' }],
    ['attribute-blocklist', { 'attribute-blocklist': ['birthdate'] }],
  ])(
    'creates and changes a key with %s, and serves it (built by api-keys-webhooks)',
    async (_, member) => {
      const tenant = await api.newTenant();
      const id = await newKeyId(tenant.token);

      const created = await call('POST', '/api-keys', tenant.token, keyBody(member));
      const changed = await call('PATCH', `/api-keys/${id}`, tenant.token, {
        data: { type: 'api-key', attributes: member },
      });

      expect([created.statusCode, changed.statusCode]).toEqual([201, 200]);
      expect(changed.json<{ data: { attributes: object } }>().data.attributes).toMatchObject(
        member,
      );
    },
  );

  it.each([
    ['name', { name: 'Synthetic CRM sync' }],
    ['description', { description: 'Sends completed inquiries on.' }],
    ['failure-alert', { 'failure-alert': { enabled: true, threshold: 5, 'window-minutes': 30 } }],
  ])(
    'creates and changes a webhook with %s, and serves it (built by api-keys-webhooks)',
    async (_, member) => {
      const tenant = await api.newTenant();
      const id = await newWebhookId(tenant.token);

      const created = await call('POST', '/webhooks', tenant.token, webhookBody(member));
      const changed = await call('PATCH', `/webhooks/${id}`, tenant.token, {
        data: { type: 'webhook', attributes: member },
      });

      expect([created.statusCode, changed.statusCode]).toEqual([201, 200]);
      expect(changed.json<{ data: { attributes: object } }>().data.attributes).toMatchObject(
        member,
      );
    },
  );

  it('still creates and changes a key and a webhook without them', async () => {
    const tenant = await api.newTenant();
    const keyId = await newKeyId(tenant.token);
    const webhookId = await newWebhookId(tenant.token);

    const key = await call('PATCH', `/api-keys/${keyId}`, tenant.token, {
      data: { type: 'api-key', attributes: { name: 'Renamed' } },
    });
    const webhook = await call('PATCH', `/webhooks/${webhookId}`, tenant.token, {
      data: { type: 'webhook', attributes: { 'enabled-events': ['inquiry.failed'] } },
    });

    expect([key.statusCode, webhook.statusCode]).toEqual([200, 200]);
  });
});

describe('the key attribute blocklist hook (C169.3; contracts B3)', () => {
  /** A key of `environmentId` with `blocklist`, written as the repository stores it. */
  async function keyWith(environmentId: string, blocklist: readonly string[]) {
    const generated = generateApiKey('sandbox', TEST_PEPPER);
    const key = await createApiKey(api.database.db, environmentId, {
      id: newId('key'),
      name: 'Synthetic blocked',
      prefix: generated.prefix,
      tokenPrefix: generated.tokenPrefix,
      secretHash: generated.secretHash,
      scopes: ['api-keys:read'],
      attributeBlocklist: blocklist,
    });
    return { id: key.id, token: generated.token };
  }

  it('hands the serialized answer to a key with a blocklist, and sends and logs what it answers', async () => {
    const tenant = await api.newTenant();
    const key = await keyWith(tenant.environmentId, ['token-prefix', 'scopes']);
    const stripped = JSON.stringify({ data: [], links: { next: null } });
    vi.mocked(applyKeyAttributeBlocklist).mockImplementationOnce(() => stripped);

    const response = await call('GET', '/api-keys', key.token);

    expect(response.statusCode, response.body).toBe(200);
    expect(response.body).toBe(stripped);
    expect(applyKeyAttributeBlocklist).toHaveBeenCalledTimes(1);
    const [payload, context] = vi.mocked(applyKeyAttributeBlocklist).mock.calls[0] ?? [];
    expect(typeof payload).toBe('string');
    expect(JSON.parse(payload as string)).toMatchObject({ data: expect.any(Array) as unknown });
    expect(context?.blocklist).toEqual(['token-prefix', 'scopes']);
    expect(context?.principal).toMatchObject({ kind: 'api-key', apiKeyId: key.id });
    expect(context?.contentType).toContain('json');
    await vi.waitFor(async () => {
      const logs = await listApiLogs(api.database.db, tenant.environmentId, { apiKeyId: key.id });
      expect(logs.items.map((log) => log.responseBody)).toEqual([JSON.parse(stripped)]);
    });
  });

  it('carries the blocklist on the principal from the key row, and runs on problems too', async () => {
    const tenant = await api.newTenant();
    const key = await keyWith(tenant.environmentId, ['name']);

    const response = await call('GET', `/api-keys/${newId('key')}`, key.token);

    expect(response.statusCode).toBe(404);
    expect(applyKeyAttributeBlocklist).toHaveBeenCalledTimes(1);
    expect(vi.mocked(applyKeyAttributeBlocklist).mock.calls[0]?.[1].principal).toMatchObject({
      attributeBlocklist: ['name'],
    });
  });

  it('leaves a key without a blocklist and a user session alone', async () => {
    const tenant = await api.newTenant();
    const user = api.newUserToken(tenant.environmentId);

    const forKey = await call('GET', '/api-keys', tenant.token);
    const forUser = await call('GET', '/api-keys', user);

    expect([forKey.statusCode, forUser.statusCode]).toEqual([200, 200]);
    expect(applyKeyAttributeBlocklist).not.toHaveBeenCalled();
  });
});

describe('the delivery attempt headers hook (C169.5)', () => {
  const NOW = new Date('2026-11-06T12:00:00.000Z');

  function recordingSender(): WebhookSender & { requests: WebhookHttpRequest[] } {
    const requests: WebhookHttpRequest[] = [];
    return {
      requests,
      send(request) {
        requests.push(request);
        return Promise.resolve({ status: 500, durationMs: 4 });
      },
      close: () => Promise.resolve(),
    };
  }

  it('sends the hook’s headers after the custom ones, with the dispatcher’s own winning', async () => {
    const tenant = await api.newTenant();
    const db = api.database.db;
    // The event's only subscriber.
    await createWebhook(db, tenant.environmentId, {
      id: newId('wbh'),
      url: 'https://hooks.example.test/openverify',
      enabledEvents: ['*'],
      secret: newWebhookSecret(),
      customHeaders: { 'x-synthetic': 'custom' },
    });
    const publisher = createEventPublisher({
      db,
      deliveries: createWebhookDeliveryScheduler(createRecordingQueue<WebhookDeliveryJob>()),
    });
    const staged = await db.transaction((tx) =>
      publisher.stage(tx, {
        environmentId: tenant.environmentId,
        name: 'verification.passed',
        payload: {
          data: buildVerificationResource({
            id: newId('ver'),
            type: 'government_id',
            status: 'passed',
            inquiryId: newId('inq'),
            fileIds: [],
            checks: [],
            createdAt: NOW,
            updatedAt: NOW,
          }),
        },
      }),
    );
    const [delivery] = staged.deliveries;
    vi.mocked(deliveryAttemptHeaders).mockImplementationOnce(() => ({
      'openverify-webhook-attempts-made': '1',
      'x-synthetic': 'from-the-hook',
      'openverify-event-id': 'not-the-event',
    }));
    const sender = recordingSender();

    await deliverWebhook(
      {
        environmentId: tenant.environmentId,
        deliveryId: delivery?.deliveryId ?? '',
        attempt: 1,
      },
      {
        db,
        sender,
        scheduler: createWebhookDeliveryScheduler(createRecordingQueue<WebhookDeliveryJob>()),
        clock: { now: () => NOW },
        logger: createCapturingLogger(),
        retry: { ...DEFAULT_WEBHOOK_RETRY_POLICY, random: () => 0.5 },
      },
    );

    expect(deliveryAttemptHeaders).toHaveBeenCalledWith({
      attempt: 1,
      maxAttempts: DEFAULT_WEBHOOK_RETRY_POLICY.offsetsSeconds.length,
      firstAttemptedAt: NOW,
    });
    expect(sender.requests[0]?.headers).toMatchObject({
      'openverify-webhook-attempts-made': '1',
      'x-synthetic': 'from-the-hook',
      'openverify-event-id': staged.eventId,
    });
  });

  it('adds the three attempt headers (built by api-keys-webhooks)', () => {
    expect(deliveryAttemptHeaders({ attempt: 1, maxAttempts: 8, firstAttemptedAt: NOW })).toEqual({
      'openverify-webhook-attempts-made': '1',
      'openverify-webhook-attempts-left': '7',
      'openverify-webhook-first-attempted-at': NOW.toISOString(),
    });
  });
});
