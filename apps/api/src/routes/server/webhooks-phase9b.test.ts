/**
 * C169.5, C169.6 (Workflow 9B, `api-keys-webhooks`; decision 52; contracts B30): a webhook's `name`,
 * `description` and `failure-alert`, optional in the API, stored, changed, cleared, cloned and served,
 * and `previous-secret-expires-at`, when the previous secret stops signing after a rotation (`null`
 * when none does). Every value is synthetic.
 */
import {
  createdWebhookDocumentSchema,
  webhookDocumentSchema,
  webhookListDocumentSchema,
} from '@openverify/contracts';
import { getWebhook } from '@openverify/db';
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
const ALERT = { enabled: true, threshold: 5, 'window-minutes': 30 };

const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
  api.app.inject({
    method,
    url: `${BASE}${url}`,
    headers: bearer(api.token),
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });

async function createWebhook(attributes: Record<string, unknown> = {}) {
  const response = await call('POST', '', {
    data: {
      type: 'webhook',
      attributes: {
        url: 'https://hooks.example.test/openverify',
        'enabled-events': ['*'],
        ...attributes,
      },
    },
  });
  return createdWebhookDocumentSchema.parse(expectStatus(response, 201)).data;
}

const patch = (id: string, attributes: Record<string, unknown>) =>
  call('PATCH', `/${id}`, { data: { type: 'webhook', attributes } });

describe('a webhook’s name, description and failure alert (C169.5, C169.6)', () => {
  it('are stored and served on create, and stored as the three alert columns', async () => {
    const created = await createWebhook({
      name: '  Synthetic CRM sync  ',
      description: 'Sends completed inquiries on.',
      'failure-alert': ALERT,
    });

    expect(created.attributes).toMatchObject({
      name: 'Synthetic CRM sync',
      description: 'Sends completed inquiries on.',
      'failure-alert': ALERT,
      'previous-secret-expires-at': null,
    });
    const stored = await getWebhook(api.database.db, api.environmentId, created.id);
    expect(stored).toMatchObject({
      name: 'Synthetic CRM sync',
      failureAlertEnabled: true,
      failureAlertThreshold: 5,
      failureAlertWindowMinutes: 30,
      failureAlertNotifiedAt: null,
    });
  });

  it('are null for a webhook without them, in the list too', async () => {
    const created = await createWebhook();

    const listed = webhookListDocumentSchema.parse(expectStatus(await call('GET', ''), 200));

    expect(listed.data.find(({ id }) => id === created.id)?.attributes).toMatchObject({
      name: null,
      description: null,
      'failure-alert': null,
      'previous-secret-expires-at': null,
    });
  });

  it('change on update, null clears each, and the audit names the attributes only', async () => {
    const created = await createWebhook({ name: 'Synthetic', 'failure-alert': ALERT });

    const changed = await patch(created.id, {
      description: 'Synthetic description',
      'failure-alert': { enabled: false, threshold: 1, 'window-minutes': 5 },
    });
    const cleared = await patch(created.id, {
      name: null,
      description: null,
      'failure-alert': null,
    });

    expect(webhookDocumentSchema.parse(expectStatus(changed, 200)).data.attributes).toMatchObject({
      name: 'Synthetic',
      description: 'Synthetic description',
      'failure-alert': { enabled: false, threshold: 1, 'window-minutes': 5 },
    });
    expect(webhookDocumentSchema.parse(expectStatus(cleared, 200)).data.attributes).toMatchObject({
      name: null,
      description: null,
      'failure-alert': null,
    });
    const entries = api.audit.withAction('webhook.updated');
    expect(entries.at(-1)?.metadata).toEqual({
      attributes: ['name', 'description', 'failure-alert'],
    });
    expect(JSON.stringify(entries)).not.toContain('Synthetic description');
  });

  it('are copied by clone', async () => {
    const created = await createWebhook({
      name: 'Synthetic source',
      description: 'Synthetic',
      'failure-alert': ALERT,
    });

    const clone = createdWebhookDocumentSchema.parse(
      expectStatus(await call('POST', `/${created.id}/clone`), 201),
    );

    expect(clone.data.attributes).toMatchObject({
      name: 'Synthetic source',
      description: 'Synthetic',
      'failure-alert': ALERT,
      status: 'disabled',
    });
  });

  it('refuse a name over 200 characters, a description over 1,000 and an alert out of bounds', async () => {
    const created = await createWebhook();

    const statuses = await Promise.all(
      [
        { name: 'N'.repeat(201) },
        { name: 'Synthetic\nname' },
        { description: 'D'.repeat(1001) },
        { 'failure-alert': { enabled: true, threshold: 0, 'window-minutes': 30 } },
        { 'failure-alert': { enabled: true, threshold: 5, 'window-minutes': 4 } },
        { 'failure-alert': { enabled: true, threshold: 5, 'window-minutes': 1441 } },
      ].map(async (attributes) => (await patch(created.id, attributes)).statusCode),
    );

    expect(statuses).toEqual([400, 400, 400, 400, 400, 400]);
  });
});

describe('previous-secret-expires-at (C169.5)', () => {
  it('says until when the previous secret signs, and null once it no longer does', async () => {
    const created = await createWebhook();
    const now = api.clock.now();

    const rotated = await call('POST', `/${created.id}/rotate-secret`, {
      meta: { 'previous-secret-expires-in-seconds': 3600 },
    });
    expectStatus(rotated, 200);
    const during = webhookDocumentSchema.parse(
      expectStatus(await call('GET', `/${created.id}`), 200),
    );
    api.clock.advance(3_600_001);
    const after = webhookDocumentSchema.parse(
      expectStatus(await call('GET', `/${created.id}`), 200),
    );

    expect(during.data.attributes['previous-secret-expires-at']).toBe(
      new Date(now.getTime() + 3_600_000).toISOString(),
    );
    expect(after.data.attributes['previous-secret-expires-at']).toBeNull();
  });

  it('is null when the rotation retired the previous secret at once', async () => {
    const created = await createWebhook();

    const rotated = await call('POST', `/${created.id}/rotate-secret`, {
      meta: { 'previous-secret-expires-in-seconds': 0 },
    });

    expect(
      createdWebhookDocumentSchema.parse({ data: expectStatus(rotated, 200).data }).data.attributes[
        'previous-secret-expires-at'
      ],
    ).toBeNull();
  });
});
