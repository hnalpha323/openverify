/**
 * Workflow 9B Stage 1b, checkpoint (W): the notification plumbing `foundation-9b` freezes for
 * `api-keys-webhooks` (C169.7; plan outcome 20; contracts B31, B32):
 *
 * - each notification is read under its own kind's rule: a case kind with `cases:read` and its case's
 *   visibility, as Phase 8 built it; a `webhook-failure` row through `readableWebhookNotifications`
 *   (`webhooks:read` in its environment, `api-keys-webhooks`'), whose stub keeps none (fail closed);
 *   so the routes take a session holding either permission, and refuse one holding neither;
 * - `GET` and `PUT /notification-preferences`, the caller's own, 501 until built, and listed in the
 *   OpenAPI document with the contract's schemas.
 *
 * Every value is synthetic.
 */
import { newId, newWebhookSecret } from '@openverify/contracts';
import {
  createRole,
  createUserNotifications,
  createWebhook,
  createWebhookFailureNotifications,
} from '@openverify/db';
import {
  createTestDatabase,
  seedCase,
  seedCaseTemplate,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readableWebhookNotifications } from '../../webhooks/alerts/notifications.js';
import {
  createDashboardHarness,
  type DashboardHarness,
  type TestOrganization,
} from './dashboard.test-support.js';

vi.mock('../../webhooks/alerts/notifications.js', { spy: true });

let database: TestDatabase;
const harnesses: DashboardHarness[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});

afterAll(async () => {
  await database.close();
});

async function setup() {
  const api = await createDashboardHarness(database);
  harnesses.push(api);
  const organization = await api.organization();
  return { api, organization };
}

/** An operator holding a custom role with exactly `permissions`, signed in. */
async function holding(
  api: DashboardHarness,
  organization: TestOrganization,
  permissions: string[],
) {
  const role = await createRole(database.db, organization.id, {
    id: newId('role'),
    name: `Synthetic ${newId('role')}`,
    permissions,
  });
  const operator = await api.operator(organization, { roles: [], roleIds: [role.id] });
  return { operator, token: await api.signIn(operator.email) };
}

/** A case notification and a webhook failure for `userId`, in the sandbox. */
async function notificationsOf(organization: TestOrganization, userId: string) {
  const environmentId = organization.sandboxId;
  const template = await seedCaseTemplate(database.db, environmentId);
  const found = await seedCase(database.db, environmentId, {
    caseTemplateId: template.id,
    caseTemplateVersionId: template.versionId,
    key: template.key,
    number: 1,
  });
  const webhook = await createWebhook(database.db, environmentId, {
    id: newId('wbh'),
    url: 'https://hooks.example.test/openverify',
    enabledEvents: ['*'],
    secret: newWebhookSecret(),
  });
  const [assigned] = await createUserNotifications(database.db, environmentId, [
    { id: newId('unot'), userId, kind: 'assigned', caseId: found.id },
  ]);
  const [failure] = await createWebhookFailureNotifications(database.db, environmentId, [
    { id: newId('unot'), userId, webhookId: webhook.id },
  ]);
  if (assigned === undefined || failure === undefined) throw new Error('not written');
  return { assigned: assigned.id, failure: failure.id, caseId: found.id, webhookId: webhook.id };
}

const idsOf = (body: string) =>
  (JSON.parse(body) as { data: { id: string }[] }).data.map(({ id }) => id).sort();

describe('the notifications, each read under its kind’s rule (C169.7; outcome 20)', () => {
  it('hand the rows about a webhook to readableWebhookNotifications, which keeps them for webhooks:read (built by api-keys-webhooks)', async () => {
    const { api, organization } = await setup();
    const { operator, token } = await holding(api, organization, ['cases:read', 'webhooks:read']);
    const rows = await notificationsOf(organization, operator.user.id);

    const listed = await api.call('GET', '/notifications', { token });
    const read = await api.call('POST', `/notifications/${rows.failure}/read`, {
      token,
      payload: { meta: {} },
    });

    expect(listed.statusCode, listed.body).toBe(200);
    expect(idsOf(listed.body)).toEqual([rows.assigned, rows.failure].sort());
    expect(read.statusCode, read.body).toBe(200);
    const handed = vi.mocked(readableWebhookNotifications).mock.calls.map(([, user, given]) => ({
      userId: user.userId,
      ids: given.map((row) => (row as unknown as { id: string }).id),
    }));
    expect(handed).toEqual([
      { userId: operator.user.id, ids: [rows.failure] },
      { userId: operator.user.id, ids: [rows.failure] },
    ]);
  });

  it('serve a webhook failure the rule keeps, naming its webhook, to a reader without cases:read', async () => {
    const { api, organization } = await setup();
    const { operator, token } = await holding(api, organization, ['webhooks:read']);
    const rows = await notificationsOf(organization, operator.user.id);

    const listed = await api.call('GET', '/notifications', { token });
    const read = await api.call('POST', `/notifications/${rows.failure}/read`, {
      token,
      payload: { meta: {} },
    });

    expect(listed.statusCode, listed.body).toBe(200);
    // The case kind needs cases:read, which this reader does not hold.
    const listedData = JSON.parse(listed.body) as {
      data: { id: string; attributes: Record<string, unknown>; relationships: unknown }[];
    };
    expect(listedData.data.map(({ id }) => id)).toEqual([rows.failure]);
    expect(listedData.data[0]?.attributes).toMatchObject({
      kind: 'webhook-failure',
      'subject-type': 'webhook',
    });
    expect(listedData.data[0]?.relationships).toEqual({
      webhook: { data: { type: 'webhook', id: rows.webhookId } },
    });
    expect(read.statusCode, read.body).toBe(200);
    expect(
      (JSON.parse(read.body) as { data: { attributes: { 'read-at': string | null } } }).data
        .attributes['read-at'],
    ).not.toBeNull();
  });

  it('keep a webhook failure from a reader holding cases:read and not webhooks:read', async () => {
    const { api, organization } = await setup();
    const { operator, token } = await holding(api, organization, ['cases:read']);
    const rows = await notificationsOf(organization, operator.user.id);

    const listed = await api.call('GET', '/notifications', { token });
    const read = await api.call('POST', `/notifications/${rows.failure}/read`, {
      token,
      payload: { meta: {} },
    });

    expect(listed.statusCode, listed.body).toBe(200);
    expect(idsOf(listed.body)).toEqual([rows.assigned]);
    expect(read.statusCode).toBe(404);
  });

  it('keep a case reader’s case rows as Phase 8 served them', async () => {
    const { api, organization } = await setup();
    const reviewer = await api.operator(organization, { roles: ['reviewer'] });
    const rows = await notificationsOf(organization, reviewer.user.id);
    const token = await api.signIn(reviewer.email);

    const listed = await api.call('GET', '/notifications', { token });

    expect(listed.statusCode, listed.body).toBe(200);
    expect(idsOf(listed.body)).toEqual([rows.assigned]);
  });

  it('refuse a session holding neither cases:read nor webhooks:read, and one without a session', async () => {
    const { api, organization } = await setup();
    const { token } = await holding(api, organization, ['inquiries:read']);

    const listed = await api.call('GET', '/notifications', { token });
    const read = await api.call('POST', `/notifications/${newId('unot')}/read`, {
      token,
      payload: { meta: {} },
    });
    const anonymous = await api.call('GET', '/notifications');

    expect([listed.statusCode, read.statusCode, anonymous.statusCode]).toEqual([403, 403, 401]);
  });
});

describe('the notification preferences, frozen for api-keys-webhooks (C169.7; contracts B32)', () => {
  const body = {
    data: {
      type: 'notification-preferences',
      attributes: { preferences: { 'webhook-failure': { console: true, email: true } } },
    },
  };

  it('answer any session (built by api-keys-webhooks), and 401 without one', async () => {
    const { api, organization } = await setup();
    const { token } = await holding(api, organization, ['inquiries:read']);

    const read = await api.call('GET', '/notification-preferences', { token });
    const written = await api.call('PUT', '/notification-preferences', { token, payload: body });
    const anonymous = await api.call('GET', '/notification-preferences');

    expect([read.statusCode, written.statusCode, anonymous.statusCode]).toEqual([200, 200, 401]);
  });

  it('read the contract: at least one kind, each kind known, both channels', async () => {
    const { api, organization } = await setup();
    const { token } = await holding(api, organization, ['inquiries:read']);
    const withPreferences = (preferences: unknown) => ({
      data: { type: 'notification-preferences', attributes: { preferences } },
    });

    const statuses = await Promise.all(
      [
        withPreferences({}),
        withPreferences({ archived: { console: true, email: false } }),
        withPreferences({ assigned: { console: true } }),
      ].map(
        async (payload) =>
          (await api.call('PUT', '/notification-preferences', { token, payload })).statusCode,
      ),
    );

    expect(statuses).toEqual([400, 400, 400]);
  });

  it('are listed in the OpenAPI document with their answers', async () => {
    const { api } = await setup();
    const { paths } = (await api.app.inject({ url: '/openapi.json' })).json<{
      paths: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
    }>();

    for (const method of ['get', 'put']) {
      const operation = paths['/api/v1/dashboard/notification-preferences']?.[method];
      expect(operation, method).toBeDefined();
      expect(Object.keys(operation?.responses ?? {}), method).toEqual(
        expect.arrayContaining(['200', '401']),
      );
    }
  });
});
