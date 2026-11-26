/**
 * C174.6 (Workflow 9B Stage 1a, common): the Workflow 9B settings on the C16 settings route. Each
 * is served with its default, set on the environment and audited as every change is; bounds are
 * the contract's (400 outside them).
 */
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createDashboardHarness,
  expectJson,
  type DashboardHarness,
} from './dashboard.test-support.js';

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

async function setup() {
  const api = await createDashboardHarness(database);
  harnesses.push(api);
  const organization = await api.organization({});
  const admin = await api.operator(organization, { roles: ['admin'] });
  const token = await api.signIn(admin.email);
  return { api, organization, token };
}

describe('GET /settings: the Workflow 9B settings (C174.6)', () => {
  it('serves each with its default', async () => {
    const { api, token } = await setup();

    const body = expectJson(await api.call('GET', '/settings', { token }), 200);

    expect(body).toMatchObject({
      'analytics-time-zone': 'UTC',
      'analytics-suppression-threshold': 11,
      'analytics-retention-months': 13,
      'analytics-settle-days': 30,
      'analytics-assignee-retention-months': 13,
      'api-key-age-warning-days': 90,
      'mail-sender-name': null,
      'audit-log-retention-days': null,
    });
  });
});

describe('PATCH /settings: the Workflow 9B settings (C174.6)', () => {
  it('stores and serves each on the environment, and audits the change', async () => {
    const { api, organization, token } = await setup();
    const changes = {
      'analytics-time-zone': 'Europe/Paris',
      'analytics-suppression-threshold': 20,
      'analytics-retention-months': 24,
      'analytics-settle-days': 45,
      'analytics-assignee-retention-months': 6,
      'api-key-age-warning-days': 30,
      'mail-sender-name': 'Example Verification Team',
      'audit-log-retention-days': 365,
    };

    const body = expectJson(await api.call('PATCH', '/settings', { token, payload: changes }), 200);

    expect(body).toMatchObject(changes);
    expect(expectJson(await api.call('GET', '/settings', { token }), 200)).toMatchObject(changes);
    const [entry] = await api.audit(organization.sandboxId, 'settings.updated');
    expect(entry?.metadata).toMatchObject({ 'analytics-time-zone': 'Europe/Paris' });
    expectJson(
      await api.call('PATCH', '/settings', {
        token,
        payload: { 'audit-log-retention-days': null, 'mail-sender-name': null },
      }),
      200,
    );
    expect(expectJson(await api.call('GET', '/settings', { token }), 200)).toMatchObject({
      'audit-log-retention-days': null,
      'mail-sender-name': null,
    });
  });

  it('refuses a threshold below the floor of 11 and changes nothing', async () => {
    const { api, token } = await setup();

    const response = await api.call('PATCH', '/settings', {
      token,
      payload: { 'analytics-suppression-threshold': 10 },
    });

    expect(response.statusCode, response.body).toBe(400);
    expect(expectJson(await api.call('GET', '/settings', { token }), 200)).toMatchObject({
      'analytics-suppression-threshold': 11,
    });
  });
});
