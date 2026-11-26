/**
 * C169.7 (Workflow 9B, `api-keys-webhooks`; contracts B32; plan W5): `GET` and
 * `PUT /api/v1/dashboard/notification-preferences`, the signed-in user's own, per kind of
 * `USER_NOTIFICATION_KINDS` `{ console, email }`, the console on and email off by default; `PUT` sets
 * the kinds it names and keeps the others, and one user's preferences never reach another's. Every
 * value is synthetic.
 */
import { notificationPreferencesDocumentSchema } from '@openverify/contracts';
import { USER_NOTIFICATION_KINDS } from '@openverify/core';
import { listNotificationPreferences } from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createDashboardHarness, type DashboardHarness } from './dashboard.test-support.js';

let database: TestDatabase;
const harnesses: DashboardHarness[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});

afterAll(async () => {
  await database.close();
});

async function signedIn(roles: ('admin' | 'viewer')[] = ['viewer']) {
  const api = await createDashboardHarness(database);
  harnesses.push(api);
  const organization = await api.organization();
  const operator = await api.operator(organization, { roles });
  return { api, organization, operator, token: await api.signIn(operator.email) };
}

const put = (preferences: Record<string, unknown>) => ({
  data: { type: 'notification-preferences', attributes: { preferences } },
});

const DEFAULTS = Object.fromEntries(
  USER_NOTIFICATION_KINDS.map((kind) => [kind, { console: true, email: false }]),
);

describe('GET /notification-preferences (C169.7)', () => {
  it('answers every kind with the defaults, the console on and email off, under the user’s id', async () => {
    const { api, operator, token } = await signedIn();

    const response = await api.call('GET', '/notification-preferences', { token });

    expect(response.statusCode, response.body).toBe(200);
    const document = notificationPreferencesDocumentSchema.parse(response.json());
    expect(document.data).toEqual({
      type: 'notification-preferences',
      id: operator.user.id,
      attributes: { preferences: DEFAULTS },
    });
  });
});

describe('PUT /notification-preferences (C169.7)', () => {
  it('sets the kinds it names and keeps every other kind', async () => {
    const { api, token } = await signedIn();

    const first = await api.call('PUT', '/notification-preferences', {
      token,
      payload: put({ 'webhook-failure': { console: true, email: true } }),
    });
    const second = await api.call('PUT', '/notification-preferences', {
      token,
      payload: put({ assigned: { console: false, email: false } }),
    });
    const read = await api.call('GET', '/notification-preferences', { token });

    expect([first.statusCode, second.statusCode, read.statusCode]).toEqual([200, 200, 200]);
    const expected = {
      ...DEFAULTS,
      'webhook-failure': { console: true, email: true },
      assigned: { console: false, email: false },
    };
    expect(notificationPreferencesDocumentSchema.parse(second.json()).data.attributes).toEqual({
      preferences: expected,
    });
    expect(notificationPreferencesDocumentSchema.parse(read.json()).data.attributes).toEqual({
      preferences: expected,
    });
  });

  it('changes only the caller’s own, stored per user', async () => {
    const one = await signedIn();
    const other = await one.api.operator(one.organization, { roles: ['viewer'] });
    const otherToken = await one.api.signIn(other.email);

    await one.api.call('PUT', '/notification-preferences', {
      token: one.token,
      payload: put({ 'webhook-failure': { console: false, email: true } }),
    });
    const theirs = await one.api.call('GET', '/notification-preferences', { token: otherToken });

    expect(
      notificationPreferencesDocumentSchema.parse(theirs.json()).data.attributes.preferences,
    ).toEqual(DEFAULTS);
    expect(
      (await listNotificationPreferences(database.db, one.operator.user.id)).map(
        ({ kind, console, email }) => ({ kind, console, email }),
      ),
    ).toEqual([{ kind: 'webhook-failure', console: false, email: true }]);
    expect(await listNotificationPreferences(database.db, other.user.id)).toEqual([]);
  });
});
