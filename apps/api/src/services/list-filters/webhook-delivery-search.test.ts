/**
 * C165.4 (Workflow 9B, `api-exports`; S7; contracts B22): `POST /webhook-deliveries/search`: `and`,
 * `or` and `not` over `updated_at`, `status`, `webhook_id` and `event_name`, the environment's
 * deliveries only, newest first (`created_at DESC, id DESC`), paged by `page { after, size }` with
 * `links.next` the id to send as `page.after`.
 *
 * Every value is synthetic.
 */
import { buildInquiryResource, newId, newWebhookSecret } from '@openverify/contracts';
import { createEvent, createWebhook, createWebhookDelivery } from '@openverify/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { T0 } from '../../test-support/fakes.js';
import { bearer, createTestApi, type TestApi } from '../../test-support/harness.js';

let api: TestApi;
const ids = { first: '', second: '', third: '', foreign: '' };
let hookOne = '';
let hookTwo = '';

const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

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
  return (
    await createEvent(api.database.db, environmentId, {
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
    })
  ).id;
}

async function seedDelivery(
  environmentId: string,
  webhookId: string,
  eventId: string,
  minutes: number,
  status: 'pending' | 'succeeded' | 'failed',
) {
  const delivery = await createWebhookDelivery(api.database.db, environmentId, {
    id: newId('whd'),
    webhookId,
    eventId,
  });
  if (delivery === null) throw new Error('no delivery');
  await api.database.db.execute(sql`update webhook_deliveries
    set created_at = ${at(minutes).toISOString()}::timestamptz,
      updated_at = ${at(minutes).toISOString()}::timestamptz, status = ${status}
    where id = ${delivery.id}`);
  return delivery.id;
}

beforeAll(async () => {
  api = await createTestApi();
  hookOne = await seedWebhook(api.environmentId);
  hookTwo = await seedWebhook(api.environmentId);
  const completed = await seedEvent(api.environmentId, 'inquiry.completed');
  const failed = await seedEvent(api.environmentId, 'inquiry.failed');
  ids.first = await seedDelivery(api.environmentId, hookOne, completed, 1, 'succeeded');
  ids.second = await seedDelivery(api.environmentId, hookTwo, failed, 2, 'failed');
  ids.third = await seedDelivery(api.environmentId, hookOne, failed, 3, 'failed');
  const other = await api.newTenant();
  ids.foreign = await seedDelivery(
    other.environmentId,
    await seedWebhook(other.environmentId),
    await seedEvent(other.environmentId, 'inquiry.failed'),
    4,
    'failed',
  );
}, 120_000);

afterAll(async () => {
  await api.close();
});

async function search(body: unknown, token = api.token) {
  const response = await api.app.inject({
    method: 'POST',
    url: '/api/v1/webhook-deliveries/search',
    headers: bearer(token),
    payload: body as Record<string, unknown>,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ data: { id: string }[]; links: { next: string | null } }>();
}

const idsOf = (document: { data: { id: string }[] }) => document.data.map(({ id }) => id);

describe('POST /webhook-deliveries/search (C165.4)', () => {
  it('reads one clause of each attribute, in the environment only, newest first', async () => {
    const failed = await search({
      query: { attribute: 'status', operator: 'eq', value: 'failed' },
    });
    const byHook = await search({
      query: { attribute: 'webhook_id', operator: 'in', value: [hookOne] },
    });
    const byName = await search({
      query: { attribute: 'event_name', operator: 'eq', value: 'inquiry.completed' },
    });
    const recent = await search({
      query: { attribute: 'updated_at', operator: 'gte', value: at(2).toISOString() },
    });

    expect(idsOf(failed)).toEqual([ids.third, ids.second]);
    expect(idsOf(byHook)).toEqual([ids.third, ids.first]);
    expect(idsOf(byName)).toEqual([ids.first]);
    expect(idsOf(recent)).toEqual([ids.third, ids.second]);
  });

  it('combines clauses with and, or and not', async () => {
    const both = await search({
      query: {
        and: [
          { attribute: 'status', operator: 'eq', value: 'failed' },
          { attribute: 'webhook_id', operator: 'eq', value: hookOne },
        ],
      },
    });
    const either = await search({
      query: {
        or: [
          { attribute: 'event_name', operator: 'eq', value: 'inquiry.completed' },
          { not: { attribute: 'webhook_id', operator: 'eq', value: hookOne } },
        ],
      },
    });

    expect(idsOf(both)).toEqual([ids.third]);
    expect(idsOf(either)).toEqual([ids.second, ids.first]);
  });

  it('pages by page.after, links.next naming the last delivery of the page', async () => {
    const query = { attribute: 'status', operator: 'in', value: ['failed', 'succeeded'] };

    const first = await search({ query, page: { size: 2 } });
    const second = await search({ query, page: { size: 2, after: first.links.next } });

    expect(idsOf(first)).toEqual([ids.third, ids.second]);
    expect(first.links.next).toBe(ids.second);
    expect(idsOf(second)).toEqual([ids.first]);
    expect(second.links.next).toBeNull();
  });

  it('refuses a page.after of another environment with 400', async () => {
    const response = await api.app.inject({
      method: 'POST',
      url: '/api/v1/webhook-deliveries/search',
      headers: bearer(api.token),
      payload: {
        query: { attribute: 'status', operator: 'eq', value: 'pending' },
        page: { after: ids.foreign },
      },
    });

    expect(response.statusCode).toBe(400);
  });
});
