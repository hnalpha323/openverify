import {
  createdWebhookDocumentSchema,
  webhookDocumentSchema,
  webhookListDocumentSchema,
} from '@openverify/contracts';
import { getWebhookSigningSecret } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApi, expectStatus, type TestApi } from '../../test-support/harness.js';

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
});

afterAll(async () => {
  await api.close();
});

const BASE = '/api/v1/webhooks';

function create(attributes: Record<string, unknown>, token = api.token) {
  return api.app.inject({
    method: 'POST',
    url: BASE,
    headers: bearer(token),
    payload: { data: { type: 'webhook', attributes } },
  });
}

async function createWebhook(token = api.token) {
  const response = await create(
    { url: 'https://hooks.example.test/openverify', 'enabled-events': ['*'] },
    token,
  );
  return createdWebhookDocumentSchema.parse(expectStatus(response, 201)).data;
}

describe('POST /api/v1/webhooks', () => {
  it('creates an enabled webhook and returns its signing secret once', async () => {
    const response = await create({
      url: 'https://hooks.example.test/openverify',
      'enabled-events': ['inquiry.completed', 'inquiry.failed'],
    });

    const { data } = createdWebhookDocumentSchema.parse(expectStatus(response, 201));
    expect(response.headers.location).toBe(`${BASE}/${data.id}`);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(data.attributes).toMatchObject({
      url: 'https://hooks.example.test/openverify',
      'enabled-events': ['inquiry.completed', 'inquiry.failed'],
      status: 'enabled',
    });
    expect(data.attributes.secret).toMatch(/^wbhsec_[A-Za-z0-9_-]{43}$/);
    expect(data.attributes['secret-last4']).toBe(data.attributes.secret.slice(-4));
    expect(await getWebhookSigningSecret(api.database.db, api.environmentId, data.id)).toBe(
      data.attributes.secret,
    );
  });

  it('stores the secret encrypted', async () => {
    const webhook = await createWebhook();

    const { rows } = await api.database.client.query<{ secret: string }>(
      'select secret from webhooks where id = $1',
      [webhook.id],
    );
    expect(rows[0]?.secret).not.toContain(webhook.attributes.secret);
  });

  it.each([
    ['a non-http URL', { url: 'ftp://hooks.example.test', 'enabled-events': ['*'] }],
    ['a URL with credentials', { url: 'https://u:p@hooks.example.test', 'enabled-events': ['*'] }],
    ['an unknown event', { url: 'https://hooks.example.test', 'enabled-events': ['x.y'] }],
    ['no events', { url: 'https://hooks.example.test', 'enabled-events': [] }],
    [
      'a client-chosen secret',
      { url: 'https://hooks.example.test', 'enabled-events': ['*'], secret: 'wbhsec_x' },
    ],
  ])('rejects %s', async (_label, attributes) => {
    expect((await create(attributes)).statusCode).toBe(400);
  });
});

describe('GET /api/v1/webhooks/:id and GET /api/v1/webhooks', () => {
  it('never shows the secret again, only its last four characters', async () => {
    const webhook = await createWebhook();

    const response = await api.app.inject({
      url: `${BASE}/${webhook.id}`,
      headers: bearer(api.token),
    });

    const { data } = webhookDocumentSchema.parse(expectStatus(response, 200));
    expect(data.attributes['secret-last4']).toBe(webhook.attributes['secret-last4']);
    expect(response.body).not.toContain(webhook.attributes.secret);
    expect(data.attributes).not.toHaveProperty('secret');
  });

  it('lists the environment webhooks newest first', async () => {
    const tenant = await api.newTenant();
    const first = await createWebhook(tenant.token);
    const second = await createWebhook(tenant.token);

    const response = await api.app.inject({ url: BASE, headers: bearer(tenant.token) });

    const list = webhookListDocumentSchema.parse(expectStatus(response, 200));
    expect(list.data.map((webhook) => webhook.id)).toEqual([second.id, first.id]);
    expect(list.links.next).toBeNull();
    expect(response.body).not.toContain(first.attributes.secret);
  });

  it('answers 404 for a webhook of another environment', async () => {
    const other = await api.newTenant();
    const foreign = await createWebhook(other.token);

    const response = await api.app.inject({
      url: `${BASE}/${foreign.id}`,
      headers: bearer(api.token),
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('PATCH /api/v1/webhooks/:id', () => {
  function patch(id: string, attributes: Record<string, unknown>, token = api.token) {
    return api.app.inject({
      method: 'PATCH',
      url: `${BASE}/${id}`,
      headers: bearer(token),
      payload: { data: { type: 'webhook', attributes } },
    });
  }

  it('changes the URL, the events and the status', async () => {
    const webhook = await createWebhook();

    const response = await patch(webhook.id, {
      url: 'https://hooks.example.test/v2',
      'enabled-events': ['verification.passed'],
      status: 'disabled',
    });

    const { data } = webhookDocumentSchema.parse(expectStatus(response, 200));
    expect(data.attributes).toMatchObject({
      url: 'https://hooks.example.test/v2',
      'enabled-events': ['verification.passed'],
      status: 'disabled',
      'secret-last4': webhook.attributes['secret-last4'],
    });
    expect(response.body).not.toContain(webhook.attributes.secret);
  });

  it('rejects an empty change and a secret change', async () => {
    const webhook = await createWebhook();

    expect((await patch(webhook.id, {})).statusCode).toBe(400);
    expect((await patch(webhook.id, { secret: 'wbhsec_x' })).statusCode).toBe(400);
  });

  it('answers 404 for a webhook of another environment, leaving it unchanged', async () => {
    const other = await api.newTenant();
    const foreign = await createWebhook(other.token);

    const response = await patch(foreign.id, { status: 'disabled' });

    expect(response.statusCode).toBe(404);
    const unchanged = await api.app.inject({
      url: `${BASE}/${foreign.id}`,
      headers: bearer(other.token),
    });
    expect(expectStatus(unchanged, 200).data.attributes.status).toBe('enabled');
  });
});
