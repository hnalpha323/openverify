/** C14 `GET /webhook-deliveries` and `GET /webhook-deliveries/:id` (scope `webhooks:read`). */
import {
  API_SCOPES,
  buildInquiryResource,
  newId,
  newWebhookSecret,
  problemTypeUri,
  webhookDeliveryDocumentSchema,
  webhookDeliveryListDocumentSchema,
} from '@openverify/contracts';
import { PERMISSIONS } from '@openverify/core';
import {
  createEvent,
  createWebhook,
  createWebhookDelivery,
  recordWebhookDeliveryAttempt,
} from '@openverify/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { T0 } from '../../test-support/fakes.js';
import {
  bearer,
  createTestApi,
  expectStatus,
  PROBLEM_JSON,
  type TestApi,
} from '../../test-support/harness.js';

const BASE = '/api/v1/webhook-deliveries';

let api: TestApi;
let otherEnvironmentId: string;
let otherToken: string;
/** Deliveries of the main environment, oldest first. */
const ids = { first: '', second: '', third: '', foreign: '' };
const webhooks = { one: '', two: '' };
const events = { completed: '', failed: '' };

async function seedWebhook(environmentId: string) {
  return (
    await createWebhook(api.database.db, environmentId, {
      id: newId('wbh'),
      url: 'https://hooks.example.test/openverify',
      enabledEvents: ['*'],
      secret: newWebhookSecret(),
    })
  ).id;
}

async function seedEvent(environmentId: string, name: 'inquiry.completed' | 'inquiry.failed') {
  const event = await createEvent(api.database.db, environmentId, {
    id: newId('evt'),
    name,
    payload: {
      data: buildInquiryResource({
        id: newId('inq'),
        status: name === 'inquiry.completed' ? 'completed' : 'failed',
        referenceId: null,
        fields: {},
        inquiryTemplateId: newId('itmpl'),
        verifications: [],
        createdAt: T0,
        updatedAt: T0,
      }),
    },
  });
  return event.id;
}

async function seedDelivery(
  environmentId: string,
  webhookId: string,
  eventId: string,
  createdAt: Date,
) {
  const delivery = await createWebhookDelivery(api.database.db, environmentId, {
    id: newId('whd'),
    webhookId,
    eventId,
  });
  if (delivery === null) throw new Error('no delivery');
  await api.database.db.execute(
    sql`update webhook_deliveries set created_at = ${createdAt.toISOString()}::timestamptz where id = ${delivery.id}`,
  );
  return delivery.id;
}

const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

beforeAll(async () => {
  api = await createTestApi();
  const other = await api.newTenant();
  otherEnvironmentId = other.environmentId;
  otherToken = other.token;
  const env = api.environmentId;
  webhooks.one = await seedWebhook(env);
  webhooks.two = await seedWebhook(env);
  events.completed = await seedEvent(env, 'inquiry.completed');
  events.failed = await seedEvent(env, 'inquiry.failed');
  ids.first = await seedDelivery(env, webhooks.one, events.completed, at(0));
  ids.second = await seedDelivery(env, webhooks.one, events.failed, at(10));
  ids.third = await seedDelivery(env, webhooks.two, events.completed, at(20));
  // The second delivery failed after two attempts.
  await recordWebhookDeliveryAttempt(api.database.db, env, ids.second, {
    outcome: 'retry',
    attemptedAt: at(10),
    responseStatus: 503,
    durationMs: 120,
    nextAttemptAt: at(11),
  });
  await recordWebhookDeliveryAttempt(api.database.db, env, ids.second, {
    outcome: 'failed',
    attemptedAt: at(11),
    error: 'The webhook receiver did not answer in time',
  });
  const foreignWebhook = await seedWebhook(otherEnvironmentId);
  const foreignEvent = await seedEvent(otherEnvironmentId, 'inquiry.completed');
  ids.foreign = await seedDelivery(otherEnvironmentId, foreignWebhook, foreignEvent, at(30));
});

afterAll(async () => {
  await api.close();
});

async function list(query = '', token = api.token) {
  const response = await api.app.inject({ url: `${BASE}${query}`, headers: bearer(token) });
  return webhookDeliveryListDocumentSchema.parse(expectStatus(response, 200));
}

const listed = async (query = '') => (await list(query)).data.map((delivery) => delivery.id);

describe('GET /api/v1/webhook-deliveries', () => {
  it('lists the environment deliveries newest first, with their attempts', async () => {
    const page = await list();

    expect(page.data.map((delivery) => delivery.id)).toEqual([ids.third, ids.second, ids.first]);
    expect(page.links.next).toBeNull();
    expect(page.data[1]).toEqual({
      type: 'webhook-delivery',
      id: ids.second,
      attributes: {
        status: 'failed',
        'webhook-id': webhooks.one,
        'event-id': events.failed,
        'event-name': 'inquiry.failed',
        attempts: [
          {
            'attempted-at': at(10).toISOString(),
            'response-status': 503,
            'duration-ms': 120,
            error: null,
          },
          {
            'attempted-at': at(11).toISOString(),
            'response-status': null,
            'duration-ms': null,
            error: 'The webhook receiver did not answer in time',
          },
        ],
        'next-attempt-at': null,
        'created-at': at(10).toISOString(),
      },
    });
    expect(page.data[0]?.attributes).toMatchObject({
      status: 'pending',
      attempts: [],
      'next-attempt-at': expect.any(String) as unknown,
    });
  });

  it('filters by webhook, event and status, with comma-separated values', async () => {
    expect(await listed(`?filter[webhook-id]=${webhooks.one}`)).toEqual([ids.second, ids.first]);
    expect(await listed(`?filter[webhook-id]=${webhooks.one},${webhooks.two}`)).toEqual([
      ids.third,
      ids.second,
      ids.first,
    ]);
    expect(await listed(`?filter[event-id]=${events.completed}`)).toEqual([ids.third, ids.first]);
    expect(await listed('?filter[status]=failed')).toEqual([ids.second]);
    expect(await listed('?filter[status]=pending,failed')).toEqual([
      ids.third,
      ids.second,
      ids.first,
    ]);
    expect(await listed(`?filter[webhook-id]=${webhooks.one}&filter[status]=pending`)).toEqual([
      ids.first,
    ]);
  });

  it('filters by creation time, inclusive start and exclusive end', async () => {
    const start = encodeURIComponent(at(10).toISOString());
    const end = encodeURIComponent(at(20).toISOString());

    expect(await listed(`?filter[created-at-start]=${start}`)).toEqual([ids.third, ids.second]);
    expect(await listed(`?filter[created-at-end]=${end}`)).toEqual([ids.second, ids.first]);
    expect(
      await listed(`?filter[created-at-start]=${start}&filter[created-at-end]=${end}`),
    ).toEqual([ids.second]);
  });

  it('pages with the C1 cursor, keeping the filters in the next link', async () => {
    const first = await list(`?filter[status]=pending,failed&page[size]=2`);

    expect(first.data.map((delivery) => delivery.id)).toEqual([ids.third, ids.second]);
    expect(first.links.next).toBe(
      `${BASE}?filter[status]=${encodeURIComponent('pending,failed')}&page[after]=${ids.second}&page[size]=2`,
    );
    const second = await list((first.links.next ?? '').slice(BASE.length));
    expect(second.data.map((delivery) => delivery.id)).toEqual([ids.first]);
    expect(second.links.next).toBeNull();
  });

  it('answers 400 for a cursor that is not in this list, and for invalid filters', async () => {
    for (const query of [
      `?page[after]=${ids.foreign}`,
      `?page[after]=${newId('whd')}`,
      '?filter[webhook-id]=evt_01M5CK4VW0MRQ4HKKTBDT6PXEM',
      '?filter[status]=delivered',
      '?filter[created-at-start]=yesterday',
      '?filter[unknown]=x',
    ]) {
      const response = await api.app.inject({ url: `${BASE}${query}`, headers: bearer(api.token) });
      expect(response.statusCode, query).toBe(400);
      expect(response.headers['content-type'], query).toBe(PROBLEM_JSON);
    }
  });

  it("never lists another environment's deliveries", async () => {
    expect(await listed()).not.toContain(ids.foreign);
    expect((await list('', otherToken)).data.map((delivery) => delivery.id)).toEqual([ids.foreign]);
  });
});

describe('GET /api/v1/webhook-deliveries/:id', () => {
  it('serves one delivery', async () => {
    const response = await api.app.inject({
      url: `${BASE}/${ids.second}`,
      headers: bearer(api.token),
    });

    const document = webhookDeliveryDocumentSchema.parse(expectStatus(response, 200));
    expect(document.data).toMatchObject({
      id: ids.second,
      attributes: { status: 'failed', 'event-name': 'inquiry.failed' },
    });
    expect(document.data.attributes.attempts).toHaveLength(2);
  });

  it('answers 404 for a delivery of another environment, or none', async () => {
    for (const id of [ids.foreign, newId('whd')]) {
      const response = await api.app.inject({ url: `${BASE}/${id}`, headers: bearer(api.token) });
      expect(response.statusCode).toBe(404);
      expect(response.headers['content-type']).toBe(PROBLEM_JSON);
    }
  });

  it('answers 400 for an id that is not a delivery id', async () => {
    const response = await api.app.inject({
      url: `${BASE}/${events.completed}`,
      headers: bearer(api.token),
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('webhook deliveries: permissions', () => {
  const routes = () => [BASE, `${BASE}/${ids.first}`];

  it('needs webhooks:read from an API key', async () => {
    const token = await api.newApiKey(api.environmentId, {
      scopes: API_SCOPES.filter((scope) => scope !== 'webhooks:read'),
    });
    for (const url of routes()) {
      const response = await api.app.inject({ url, headers: bearer(token) });
      expect(response.statusCode, url).toBe(403);
      expect(response.json<{ type: string }>().type).toBe(problemTypeUri('forbidden'));
      expect(response.headers['www-authenticate']).toContain('scope="webhooks:read"');
    }
  });

  it('needs webhooks:read from a user, and that permission is enough', async () => {
    const without = api.newUserToken(api.environmentId, {
      permissions: PERMISSIONS.filter((permission) => permission !== 'webhooks:read'),
    });
    const only = api.newUserToken(api.environmentId, { permissions: ['webhooks:read'] });
    for (const url of routes()) {
      expect((await api.app.inject({ url, headers: bearer(without) })).statusCode, url).toBe(403);
      expect((await api.app.inject({ url, headers: bearer(only) })).statusCode, url).toBe(200);
    }
  });

  it('requires a credential', async () => {
    for (const url of routes()) {
      expect((await api.app.inject({ url })).statusCode).toBe(401);
    }
  });

  it('documents both routes in OpenAPI', async () => {
    const document = (await api.app.inject({ url: '/openapi.json' })).json<{
      paths: Record<string, Record<string, { tags?: string[] }>>;
    }>();

    expect(document.paths['/api/v1/webhook-deliveries']?.get?.tags).toEqual(['webhooks']);
    expect(document.paths['/api/v1/webhook-deliveries/{id}']?.get?.tags).toEqual(['webhooks']);
  });
});
