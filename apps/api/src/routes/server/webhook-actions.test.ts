/**
 * C14 webhook routes: the Phase 2 attributes, status actions, clone, rotate-secret, simulate
 * and replay, with their permissions (C12) and audit entries (C15).
 */
import {
  API_SCOPES,
  buildInquiryResource,
  createdWebhookDocumentSchema,
  newId,
  problemTypeUri,
  replayWebhookDocumentSchema,
  rotateWebhookSecretDocumentSchema,
  simulateWebhookDocumentSchema,
  webhookDocumentSchema,
  type EventName,
} from '@openverify/contracts';
import { PERMISSIONS, type Permission } from '@openverify/core';
import {
  createEvent,
  createWebhookDelivery,
  getEvent,
  getWebhookDispatchConfig,
  listEvents,
  recordWebhookDeliveryAttempt,
} from '@openverify/db';
import type { HTTPMethods } from 'fastify';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEventPublisher } from '../../events/index.js';
import { createRecordingQueue } from '../../jobs/testing.js';
import {
  bearer,
  createTestApi,
  expectStatus,
  PROBLEM_JSON,
  type TestApi,
} from '../../test-support/harness.js';
import { T0 } from '../../test-support/fakes.js';
import { createWebhookDeliveryScheduler, type WebhookDeliveryJob } from '../../webhooks/queue.js';

const BASE = '/api/v1/webhooks';
const HOOK_URL = 'https://hooks.example.test/openverify';
const T1 = 'itmpl_01M5A0GTG0RSTVX9PHA0V7P3X6';
const T2 = 'itmpl_01M5A0GTG0RSTVX9PHA0V7P3X7';
const INVALID_TRANSITION = problemTypeUri('invalid-transition');
const FORBIDDEN = problemTypeUri('forbidden');

let api: TestApi;
const queue = createRecordingQueue<WebhookDeliveryJob>();

beforeAll(async () => {
  api = await createTestApi((defaults) => ({
    events: createEventPublisher({
      db: defaults.db,
      deliveries: createWebhookDeliveryScheduler(queue),
    }),
  }));
});

afterAll(async () => {
  await api.close();
});

beforeEach(() => {
  queue.jobs.length = 0;
  api.audit.entries.length = 0;
});

function inject(
  method: HTTPMethods,
  url: string,
  options: { payload?: unknown; token?: string; headers?: Record<string, string> } = {},
) {
  return api.app.inject({
    method,
    url,
    headers: { ...bearer(options.token ?? api.token), ...options.headers },
    ...(options.payload === undefined ? {} : { payload: options.payload as object }),
  });
}

async function createWebhook(attributes: Record<string, unknown> = {}, token = api.token) {
  const response = await inject('POST', BASE, {
    token,
    payload: {
      data: {
        type: 'webhook',
        attributes: { url: HOOK_URL, 'enabled-events': ['*'], ...attributes },
      },
    },
  });
  return createdWebhookDocumentSchema.parse(expectStatus(response, 201)).data;
}

const action = (id: string, name: string, meta?: unknown, token = api.token) =>
  inject('POST', `${BASE}/${id}/${name}`, {
    token,
    ...(meta === undefined ? {} : { payload: { meta } }),
  });

async function storedConfig(id: string, now: Date = T0) {
  const config = await getWebhookDispatchConfig(api.database.db, api.environmentId, id, now);
  if (config === null) throw new Error(`webhook ${id} not found`);
  return config;
}

function inquiryPayload(templateId: string = T1) {
  return {
    data: buildInquiryResource({
      id: newId('inq'),
      status: 'completed',
      referenceId: null,
      fields: {},
      inquiryTemplateId: templateId,
      verifications: [],
      createdAt: T0,
      updatedAt: T0,
    }),
  };
}

async function storeEvent(
  options: {
    name?: EventName;
    createdAt?: Date;
    simulated?: boolean;
    environmentId?: string;
    templateId?: string;
  } = {},
) {
  const environmentId = options.environmentId ?? api.environmentId;
  const event = await createEvent(api.database.db, environmentId, {
    id: newId('evt'),
    name: options.name ?? 'inquiry.completed',
    payload: inquiryPayload(options.templateId),
    ...(options.simulated === undefined ? {} : { simulated: options.simulated }),
  });
  if (options.createdAt !== undefined) {
    await api.database.db.execute(
      sql`update events set created_at = ${options.createdAt.toISOString()}::timestamptz where id = ${event.id}`,
    );
  }
  return event.id;
}

async function deliveriesOf(webhookId: string) {
  const { rows } = await api.database.client.query<{
    id: string;
    event_id: string;
    is_replay: boolean;
    status: string;
  }>(
    'select id, event_id, is_replay, status from webhook_deliveries where webhook_id = $1 order by created_at, id',
    [webhookId],
  );
  return rows;
}

function expectProblem(response: Awaited<ReturnType<typeof inject>>, status: number, type: string) {
  expect(response.statusCode, response.body).toBe(status);
  expect(response.headers['content-type']).toBe(PROBLEM_JSON);
  expect(response.json<{ type: string }>().type).toBe(type);
}

describe('POST /api/v1/webhooks with the C14 attributes', () => {
  it('stores the workflow and list filters (C143.4)', async () => {
    const workflow = newId('wfl');
    const list = newId('lst');

    const webhook = await createWebhook({
      filters: { 'workflow-ids': [workflow], 'list-ids': [list] },
    });

    expect(webhook.attributes).toMatchObject({
      filters: { 'workflow-ids': [workflow], 'list-ids': [list] },
    });
  });

  it('stores the API version, filters, blocklist and custom headers, showing header values redacted', async () => {
    const webhook = await createWebhook({
      'api-version': '2026-10-01',
      'custom-headers': { 'X-Customer-Auth': 'synthetic-header-value', 'X-Trace': 'abc' },
      filters: { 'inquiry-template-ids': [T1] },
      'attribute-blocklist': ['fields', 'reference-id'],
    });

    expect(webhook.attributes).toMatchObject({
      'api-version': '2026-10-01',
      'custom-headers': { 'X-Customer-Auth': '[REDACTED]', 'X-Trace': '[REDACTED]' },
      filters: { 'inquiry-template-ids': [T1] },
      'attribute-blocklist': ['fields', 'reference-id'],
      status: 'enabled',
    });
    expect(JSON.stringify(webhook)).not.toContain('synthetic-header-value');
    expect((await storedConfig(webhook.id)).customHeaders).toEqual({
      'X-Customer-Auth': 'synthetic-header-value',
      'X-Trace': 'abc',
    });
    const fetched = expectStatus(await inject('GET', `${BASE}/${webhook.id}`), 200);
    expect(fetched.data.attributes).toMatchObject({
      'custom-headers': { 'X-Customer-Auth': '[REDACTED]', 'X-Trace': '[REDACTED]' },
    });
  });

  it('keeps custom header values out of the API log of the create and the update (2B F009)', async () => {
    const tenant = await api.newTenant();
    const webhook = await createWebhook(
      { 'custom-headers': { Authorization: 'Bearer synthetic-create-s3cr3t' } },
      tenant.token,
    );
    expectStatus(
      await inject('PATCH', `${BASE}/${webhook.id}`, {
        token: tenant.token,
        payload: {
          data: {
            type: 'webhook',
            attributes: { 'custom-headers': { Authorization: 'Bearer synthetic-patch-s3cr3t' } },
          },
        },
      }),
      200,
    );

    let logs: unknown[] = [];
    await vi.waitFor(async () => {
      const response = await inject('GET', '/api/v1/api-logs?filter[method]=POST,PATCH', {
        token: tenant.token,
      });
      logs = response.json<{ data: unknown[] }>().data;
      expect(response.statusCode).toBe(200);
      expect(logs.length).toBeGreaterThanOrEqual(2);
    });
    const text = JSON.stringify(logs);
    expect(text).toContain('"Authorization":"[REDACTED]"');
    expect(text).not.toMatch(/synthetic-(create|patch)-s3cr3t/);
  });

  it('defaults to the latest API version without headers, filters or blocklist', async () => {
    const webhook = await createWebhook();

    expect(webhook.attributes).toMatchObject({
      'api-version': '2026-10-01',
      'custom-headers': {},
      filters: {},
      'attribute-blocklist': [],
    });
  });

  it.each([
    ['a reserved header', { 'custom-headers': { 'Content-Type': 'text/plain' } }],
    ['the host header', { 'custom-headers': { Host: 'internal.example.test' } }],
    ['an openverify-* header', { 'custom-headers': { 'OpenVerify-Signature': 'x' } }],
    ['a hop-by-hop header', { 'custom-headers': { Connection: 'close' } }],
    ['a value with a line break', { 'custom-headers': { 'X-A': 'one\r\nX-B: two' } }],
    ['the redacted placeholder', { 'custom-headers': { 'X-A': '[REDACTED]' } }],
    ['a name that is not a token', { 'custom-headers': { 'X A': 'one' } }],
    [
      'eleven headers',
      {
        'custom-headers': Object.fromEntries(
          Array.from({ length: 11 }, (_, index) => [`X-H${String(index)}`, 'v']),
        ),
      },
    ],
    ['names equal ignoring case', { 'custom-headers': { 'X-A': '1', 'x-a': '2' } }],
    ['a value over 1,024 characters', { 'custom-headers': { 'X-A': 'v'.repeat(1025) } }],
    ['a blocked name that is not kebab-case', { 'attribute-blocklist': ['Fields'] }],
    ['a template filter with another id', { filters: { 'inquiry-template-ids': ['acc_X'] } }],
    ['an unknown filter', { filters: { 'reference-ids': ['x'] } }],
    ['an unknown API version', { 'api-version': '2020-01-01' }],
  ])('rejects %s', async (_label, attributes) => {
    const response = await inject('POST', BASE, {
      payload: {
        data: {
          type: 'webhook',
          attributes: { url: HOOK_URL, 'enabled-events': ['*'], ...attributes },
        },
      },
    });

    expect(response.statusCode, response.body).toBe(400);
  });

  it('records webhook.created in the audit log, without the URL or header values', async () => {
    const webhook = await createWebhook({ 'custom-headers': { 'X-A': 'synthetic-audit-value' } });

    const [entry] = api.audit.withAction('webhook.created');
    expect(entry).toMatchObject({
      environmentId: api.environmentId,
      organizationId: api.organizationId,
      actor: { type: 'api-key', id: expect.stringMatching(/^key_/) as unknown },
      resourceType: 'webhook',
      resourceId: webhook.id,
    });
    expect(JSON.stringify(api.audit.entries)).not.toContain('synthetic-audit-value');
    expect(JSON.stringify(api.audit.entries)).not.toContain('hooks.example.test');
  });
});

describe('PATCH /api/v1/webhooks/:id with the C14 attributes', () => {
  const patch = (id: string, attributes: Record<string, unknown>) =>
    inject('PATCH', `${BASE}/${id}`, { payload: { data: { type: 'webhook', attributes } } });

  it('replaces the custom headers, filters and blocklist', async () => {
    const webhook = await createWebhook({
      'custom-headers': { 'X-Old': 'old' },
      filters: { 'inquiry-template-ids': [T1] },
      'attribute-blocklist': ['fields'],
    });

    const response = await patch(webhook.id, {
      'custom-headers': { 'X-New': 'new-value' },
      filters: { 'inquiry-template-ids': [T2] },
      'attribute-blocklist': ['note'],
      'api-version': '2026-10-01',
    });

    expect(webhookDocumentSchema.parse(expectStatus(response, 200)).data.attributes).toMatchObject({
      'custom-headers': { 'X-New': '[REDACTED]' },
      filters: { 'inquiry-template-ids': [T2] },
      'attribute-blocklist': ['note'],
    });
    expect((await storedConfig(webhook.id)).customHeaders).toEqual({ 'X-New': 'new-value' });

    const cleared = await patch(webhook.id, { 'custom-headers': {}, filters: {} });
    expect(expectStatus(cleared, 200).data.attributes).toMatchObject({
      'custom-headers': {},
      filters: {},
    });
  });

  it('refuses to archive through PATCH', async () => {
    const webhook = await createWebhook();

    expect((await patch(webhook.id, { status: 'archived' })).statusCode).toBe(400);
  });

  it('records webhook.updated with the names of the changed attributes only', async () => {
    const webhook = await createWebhook();

    expectStatus(
      await patch(webhook.id, {
        url: 'https://hooks.example.test/v2?token=synthetic-url-token',
        'custom-headers': { 'X-A': 'synthetic-patch-value' },
      }),
      200,
    );

    expect(api.audit.withAction('webhook.updated')).toEqual([
      expect.objectContaining({
        resourceId: webhook.id,
        metadata: { attributes: ['url', 'custom-headers'] },
      }),
    ]);
    const logged = JSON.stringify(api.audit.entries);
    expect(logged).not.toContain('synthetic-url-token');
    expect(logged).not.toContain('synthetic-patch-value');
  });
});

describe('POST /api/v1/webhooks/:id/enable, /disable and /archive', () => {
  it('disables and enables a webhook, recording each change', async () => {
    const webhook = await createWebhook();

    const disabled = await action(webhook.id, 'disable');
    expect(webhookDocumentSchema.parse(expectStatus(disabled, 200)).data.attributes.status).toBe(
      'disabled',
    );
    const enabled = await action(webhook.id, 'enable', {});
    expect(expectStatus(enabled, 200).data.attributes.status).toBe('enabled');
    const again = await action(webhook.id, 'enable');
    expect(expectStatus(again, 200).data.attributes.status).toBe('enabled');

    expect(api.audit.entries.map((entry) => [entry.action, entry.metadata])).toEqual([
      ['webhook.created', undefined],
      ['webhook.disabled', { from: 'enabled', to: 'disabled' }],
      ['webhook.enabled', { from: 'disabled', to: 'enabled' }],
      ['webhook.enabled', { from: 'enabled', to: 'enabled' }],
    ]);
  });

  it('archives a webhook for good: every later change answers 409 invalid-transition', async () => {
    const webhook = await createWebhook();
    const archived = await action(webhook.id, 'archive');
    expect(expectStatus(archived, 200).data.attributes.status).toBe('archived');
    expect(api.audit.withAction('webhook.archived')).toHaveLength(1);

    const attempts = [
      () =>
        inject('PATCH', `${BASE}/${webhook.id}`, {
          payload: { data: { type: 'webhook', attributes: { url: `${HOOK_URL}/v2` } } },
        }),
      () => action(webhook.id, 'enable'),
      () => action(webhook.id, 'disable'),
      () => action(webhook.id, 'archive'),
      () => action(webhook.id, 'rotate-secret'),
      () => action(webhook.id, 'simulate', { 'event-name': 'inquiry.completed' }),
      () => action(webhook.id, 'replay', { 'event-ids': [newId('evt')] }),
    ];
    for (const attempt of attempts) {
      expectProblem(await attempt(), 409, INVALID_TRANSITION);
    }

    const after = expectStatus(await inject('GET', `${BASE}/${webhook.id}`), 200);
    expect(after.data.attributes).toMatchObject({ status: 'archived', url: HOOK_URL });
    expect(api.audit.withAction('webhook.archived')).toHaveLength(1);
  });

  it('rejects an unknown body member', async () => {
    const webhook = await createWebhook();

    expect((await action(webhook.id, 'disable', { reason: 'x' })).statusCode).toBe(400);
  });
});

describe('POST /api/v1/webhooks/:id/clone', () => {
  it('copies the configuration with a new secret, returned once, and status disabled', async () => {
    const source = await createWebhook({
      'enabled-events': ['inquiry.completed', 'inquiry.failed'],
      'custom-headers': { 'X-Customer-Auth': 'synthetic-clone-value' },
      filters: { 'inquiry-template-ids': [T1] },
      'attribute-blocklist': ['fields'],
    });

    const response = await action(source.id, 'clone');

    const clone = createdWebhookDocumentSchema.parse(expectStatus(response, 201)).data;
    expect(response.headers.location).toBe(`${BASE}/${clone.id}`);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(clone.id).not.toBe(source.id);
    expect(clone.attributes.secret).not.toBe(source.attributes.secret);
    expect(clone.attributes).toMatchObject({
      url: HOOK_URL,
      'enabled-events': ['inquiry.completed', 'inquiry.failed'],
      status: 'disabled',
      'api-version': '2026-10-01',
      'custom-headers': { 'X-Customer-Auth': '[REDACTED]' },
      filters: { 'inquiry-template-ids': [T1] },
      'attribute-blocklist': ['fields'],
    });
    expect(await storedConfig(clone.id)).toMatchObject({
      secrets: [clone.attributes.secret],
      customHeaders: { 'X-Customer-Auth': 'synthetic-clone-value' },
    });
    expect(response.body).not.toContain('synthetic-clone-value');
    expect(api.audit.withAction('webhook.cloned')).toEqual([
      expect.objectContaining({
        resourceId: clone.id,
        metadata: { 'source-webhook-id': source.id },
      }),
    ]);
  });

  it('clones an archived webhook, which stays archived', async () => {
    const source = await createWebhook();
    expectStatus(await action(source.id, 'archive'), 200);

    const clone = expectStatus(await action(source.id, 'clone'), 201);

    expect(clone.data.attributes.status).toBe('disabled');
    expect(
      expectStatus(await inject('GET', `${BASE}/${source.id}`), 200).data.attributes.status,
    ).toBe('archived');
  });
});

describe('POST /api/v1/webhooks/:id/rotate-secret', () => {
  it('returns the new secret once and keeps the previous one signing for 24 hours', async () => {
    const webhook = await createWebhook();

    const response = await action(webhook.id, 'rotate-secret');

    const rotated = rotateWebhookSecretDocumentSchema.parse(expectStatus(response, 200));
    const secret = rotated.data.attributes.secret;
    expect(response.headers['cache-control']).toBe('no-store');
    expect(secret).not.toBe(webhook.attributes.secret);
    expect(response.body).not.toContain(webhook.attributes.secret);
    expect(rotated.meta['previous-secret-expires-at']).toBe(
      new Date(T0.getTime() + 86_400_000).toISOString(),
    );
    expect((await storedConfig(webhook.id)).secrets).toEqual([secret, webhook.attributes.secret]);
    expect((await storedConfig(webhook.id, new Date(T0.getTime() + 86_400_001))).secrets).toEqual([
      secret,
    ]);
    const fetched = expectStatus(await inject('GET', `${BASE}/${webhook.id}`), 200);
    expect(fetched.data.attributes['secret-last4']).toBe(secret.slice(-4));
  });

  it('retires the previous secret at once with 0, or after the given time', async () => {
    const now = await createWebhook();
    const later = await createWebhook();

    const immediate = rotateWebhookSecretDocumentSchema.parse(
      expectStatus(
        await action(now.id, 'rotate-secret', { 'previous-secret-expires-in-seconds': 0 }),
        200,
      ),
    );
    const hour = rotateWebhookSecretDocumentSchema.parse(
      expectStatus(
        await action(later.id, 'rotate-secret', { 'previous-secret-expires-in-seconds': 3600 }),
        200,
      ),
    );

    expect(immediate.meta['previous-secret-expires-at']).toBe(T0.toISOString());
    expect((await storedConfig(now.id)).secrets).toEqual([immediate.data.attributes.secret]);
    expect(hour.meta['previous-secret-expires-at']).toBe(
      new Date(T0.getTime() + 3_600_000).toISOString(),
    );
    expect((await storedConfig(later.id)).secrets).toHaveLength(2);
  });

  it.each([[-1], [604_801], [1.5]])('rejects an overlap of %s seconds', async (seconds) => {
    const webhook = await createWebhook();

    const response = await action(webhook.id, 'rotate-secret', {
      'previous-secret-expires-in-seconds': seconds,
    });

    expect(response.statusCode).toBe(400);
  });

  it('records webhook.secret-rotated without either secret', async () => {
    const webhook = await createWebhook();

    const rotated = expectStatus(await action(webhook.id, 'rotate-secret'), 200);

    expect(api.audit.withAction('webhook.secret-rotated')).toEqual([
      expect.objectContaining({
        resourceId: webhook.id,
        metadata: {
          'previous-secret-expires-at': new Date(T0.getTime() + 86_400_000).toISOString(),
        },
      }),
    ]);
    const logged = JSON.stringify(api.audit.entries);
    expect(logged).not.toContain(webhook.attributes.secret);
    expect(logged).not.toContain(String(rotated.data.attributes.secret));
  });
});

describe('POST /api/v1/webhooks/:id/simulate', () => {
  it('stores a simulated sample event and delivers it to this webhook only', async () => {
    const target = await createWebhook();
    const bystander = await createWebhook();

    const response = await action(target.id, 'simulate', { 'event-name': 'inquiry.approved' });

    const document = simulateWebhookDocumentSchema.parse(expectStatus(response, 200));
    expect(document.data.id).toBe(target.id);
    const eventId = document.meta['event-id'];
    expect(await getEvent(api.database.db, api.environmentId, eventId)).toMatchObject({
      name: 'inquiry.approved',
      simulated: true,
    });
    const listed = await listEvents(api.database.db, api.environmentId, { size: 100 });
    expect(listed.items.map((event) => event.id)).not.toContain(eventId);
    const [delivery] = await deliveriesOf(target.id);
    expect(delivery).toMatchObject({ event_id: eventId, status: 'pending', is_replay: false });
    expect(await deliveriesOf(bystander.id)).toEqual([]);
    expect(queue.jobs.map((job) => job.data)).toEqual([
      { environmentId: api.environmentId, deliveryId: delivery?.id, attempt: 1 },
    ]);
    expect(api.audit.withAction('webhook.simulated')).toEqual([
      expect.objectContaining({
        resourceId: target.id,
        metadata: { 'event-name': 'inquiry.approved', 'event-id': eventId },
      }),
    ]);
  });

  it('simulates an event the webhook does not subscribe to, because it was asked for', async () => {
    const webhook = await createWebhook({ 'enabled-events': ['inquiry.completed'] });

    const response = await action(webhook.id, 'simulate', { 'event-name': 'account.created' });

    expectStatus(response, 200);
    expect(await deliveriesOf(webhook.id)).toHaveLength(1);
  });

  it('answers 409 for a disabled webhook, which could not receive it', async () => {
    const webhook = await createWebhook();
    expectStatus(await action(webhook.id, 'disable'), 200);

    expectProblem(
      await action(webhook.id, 'simulate', { 'event-name': 'inquiry.completed' }),
      409,
      INVALID_TRANSITION,
    );
    expect(await deliveriesOf(webhook.id)).toEqual([]);
  });

  it.each([
    ['an unknown event name', { 'event-name': 'inquiry.exploded' }],
    ['no event name', {}],
  ])('rejects %s', async (_label, meta) => {
    const webhook = await createWebhook();

    expect((await action(webhook.id, 'simulate', meta)).statusCode).toBe(400);
  });
});

describe('POST /api/v1/webhooks/:id/replay', () => {
  it('creates new deliveries for the named events the webhook subscribes to', async () => {
    const webhook = await createWebhook({ 'enabled-events': ['inquiry.completed'] });
    const subscribed = await storeEvent();
    const original = await createWebhookDelivery(api.database.db, api.environmentId, {
      id: newId('whd'),
      webhookId: webhook.id,
      eventId: subscribed,
    });
    const unsubscribed = await storeEvent({ name: 'inquiry.failed' });
    const simulated = await storeEvent({ simulated: true });
    const other = await api.newTenant();
    const foreign = await storeEvent({ environmentId: other.environmentId });

    const response = await action(webhook.id, 'replay', {
      'event-ids': [subscribed, unsubscribed, simulated, foreign, newId('evt')],
    });

    const document = replayWebhookDocumentSchema.parse(expectStatus(response, 200));
    expect(document.meta).toEqual({ 'replayed-count': 1 });
    const rows = await deliveriesOf(webhook.id);
    expect(rows).toEqual([
      expect.objectContaining({ id: original?.id, event_id: subscribed, is_replay: false }),
      expect.objectContaining({ event_id: subscribed, is_replay: true, status: 'pending' }),
    ]);
    expect(queue.jobs.map((job) => job.data)).toEqual([
      { environmentId: api.environmentId, deliveryId: rows[1]?.id, attempt: 1 },
    ]);
    expect(api.audit.withAction('webhook.replayed')).toEqual([
      expect.objectContaining({
        resourceId: webhook.id,
        metadata: { 'replayed-count': 1, selection: 'event-ids' },
      }),
    ]);
  });

  it('replays the events of a time range, inclusive start and exclusive end', async () => {
    const webhook = await createWebhook();
    const start = new Date('2026-09-01T00:00:00.000Z');
    const end = new Date('2026-09-02T00:00:00.000Z');
    const before = await storeEvent({ createdAt: new Date(start.getTime() - 1) });
    const first = await storeEvent({ createdAt: start });
    const second = await storeEvent({ createdAt: new Date(end.getTime() - 1) });
    const atEnd = await storeEvent({ createdAt: end });

    const response = await action(webhook.id, 'replay', {
      'created-at-start': start.toISOString(),
      'created-at-end': end.toISOString(),
    });

    expect(expectStatus(response, 200).meta).toEqual({ 'replayed-count': 2 });
    const replayed = (await deliveriesOf(webhook.id)).map((row) => row.event_id);
    expect(replayed).toEqual([first, second]);
    expect(replayed).not.toContain(before);
    expect(replayed).not.toContain(atEnd);
  });

  it('replays only the events whose delivery to this webhook failed, with status failed', async () => {
    const webhook = await createWebhook();
    const createdAt = new Date('2026-09-10T00:00:00.000Z');
    const failed = await storeEvent({ createdAt });
    const succeeded = await storeEvent({ createdAt });
    for (const [eventId, outcome] of [
      [failed, 'failed'],
      [succeeded, 'succeeded'],
    ] as const) {
      const delivery = await createWebhookDelivery(api.database.db, api.environmentId, {
        id: newId('whd'),
        webhookId: webhook.id,
        eventId,
      });
      await recordWebhookDeliveryAttempt(api.database.db, api.environmentId, delivery?.id ?? '', {
        outcome,
        attemptedAt: createdAt,
        responseStatus: outcome === 'failed' ? 500 : 200,
      });
    }

    const response = await action(webhook.id, 'replay', {
      'created-at-start': '2026-09-09T00:00:00.000Z',
      'created-at-end': '2026-09-11T00:00:00.000Z',
      status: 'failed',
    });

    expect(expectStatus(response, 200).meta).toEqual({ 'replayed-count': 1 });
    expect(
      (await deliveriesOf(webhook.id)).filter((row) => row.is_replay).map((row) => row.event_id),
    ).toEqual([failed]);
  });

  it("applies the webhook's filters", async () => {
    const webhook = await createWebhook({ filters: { 'inquiry-template-ids': [T1] } });
    const matching = await storeEvent({ templateId: T1 });
    const filtered = await storeEvent({ templateId: T2 });

    const response = await action(webhook.id, 'replay', { 'event-ids': [matching, filtered] });

    expect(expectStatus(response, 200).meta).toEqual({ 'replayed-count': 1 });
    expect((await deliveriesOf(webhook.id)).map((row) => row.event_id)).toEqual([matching]);
  });

  it('answers 409 for a disabled webhook', async () => {
    const webhook = await createWebhook();
    const eventId = await storeEvent();
    expectStatus(await action(webhook.id, 'disable'), 200);

    expectProblem(
      await action(webhook.id, 'replay', { 'event-ids': [eventId] }),
      409,
      INVALID_TRANSITION,
    );
    expect(await deliveriesOf(webhook.id)).toEqual([]);
  });

  it.each([
    ['more than 100 event ids', { 'event-ids': Array.from({ length: 101 }, () => newId('evt')) }],
    ['no event ids', { 'event-ids': [] }],
    [
      'an end before the start',
      { 'created-at-start': '2026-09-02T00:00:00Z', 'created-at-end': '2026-09-01T00:00:00Z' },
    ],
    ['a start without an end', { 'created-at-start': '2026-09-01T00:00:00Z' }],
    [
      'both selections',
      {
        'event-ids': [newId('evt')],
        'created-at-start': '2026-09-01T00:00:00Z',
        'created-at-end': '2026-09-02T00:00:00Z',
      },
    ],
    [
      'another status',
      {
        'created-at-start': '2026-09-01T00:00:00Z',
        'created-at-end': '2026-09-02T00:00:00Z',
        status: 'succeeded',
      },
    ],
  ])('rejects %s', async (_label, meta) => {
    const webhook = await createWebhook();

    expect((await action(webhook.id, 'replay', meta)).statusCode).toBe(400);
  });
});

/** Every C14 webhook action: method, path suffix and a valid body. */
const ACTIONS: [string, unknown][] = [
  ['enable', undefined],
  ['disable', undefined],
  ['archive', undefined],
  ['clone', undefined],
  ['rotate-secret', { 'previous-secret-expires-in-seconds': 0 }],
  ['simulate', { 'event-name': 'inquiry.completed' }],
  ['replay', { 'event-ids': ['evt_01M5CK4VW0MRQ4HKKTBDT6PXEM'] }],
];

describe('C14 webhook actions: permissions and tenancy', () => {
  const withoutWrite = API_SCOPES.filter((scope) => scope !== 'webhooks:write');
  const userWithout = PERMISSIONS.filter((permission) => permission !== 'webhooks:write');

  it.each(ACTIONS)(
    'POST /webhooks/:id/%s needs webhooks:write from an API key',
    async (name, meta) => {
      const webhook = await createWebhook();
      const token = await api.newApiKey(api.environmentId, { scopes: withoutWrite });

      const response = await action(webhook.id, name, meta, token);

      expectProblem(response, 403, FORBIDDEN);
      expect(response.headers['www-authenticate']).toContain('scope="webhooks:write"');
    },
  );

  it.each(ACTIONS)('POST /webhooks/:id/%s needs webhooks:write from a user', async (name, meta) => {
    const webhook = await createWebhook();
    const token = api.newUserToken(api.environmentId, { permissions: userWithout });

    expectProblem(await action(webhook.id, name, meta, token), 403, FORBIDDEN);
  });

  it.each(ACTIONS)(
    'POST /webhooks/:id/%s works for a user holding only webhooks:write',
    async (name, meta) => {
      const webhook = await createWebhook();
      const userId = newId('usr');
      const permissions: Permission[] = ['webhooks:write'];
      const token = api.newUserToken(api.environmentId, { permissions, userId });

      const response = await action(webhook.id, name, meta, token);

      expect([200, 201]).toContain(response.statusCode);
      expect(api.audit.entries.at(-1)?.actor).toEqual({ type: 'user', id: userId });
    },
  );

  it.each(ACTIONS)(
    "POST /webhooks/:id/%s answers 404 for another environment's webhook",
    async (name, meta) => {
      const other = await api.newTenant();
      const foreign = await createWebhook({}, other.token);

      const response = await action(foreign.id, name, meta);

      expect(response.statusCode).toBe(404);
      expect(response.headers['content-type']).toBe(PROBLEM_JSON);
      const unchanged = await getWebhookDispatchConfig(
        api.database.db,
        other.environmentId,
        foreign.id,
        T0,
      );
      expect(unchanged).toMatchObject({
        webhook: { status: 'enabled' },
        secrets: [foreign.attributes.secret],
      });
    },
  );

  it('documents every action in OpenAPI', async () => {
    const document = (await api.app.inject({ url: '/openapi.json' })).json<{
      paths: Record<string, Record<string, { tags?: string[]; summary?: string }>>;
    }>();

    for (const [name] of ACTIONS) {
      const operation = document.paths[`/api/v1/webhooks/{id}/${name}`]?.post;
      expect(operation, name).toBeDefined();
      expect(operation?.tags, name).toEqual(['webhooks']);
      expect(operation?.summary, name).toBeTruthy();
    }
  });
});
