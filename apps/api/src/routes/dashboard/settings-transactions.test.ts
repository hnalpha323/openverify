/**
 * C105.5, C107.7 (Workflow 7B Stage 1b (T)): `transaction-retention-days`, served by `GET /settings`
 * and set by `PATCH /settings` with `settings:write`: `null` (the default) or 1-3,650.
 */
import { getEnvironment } from '@openverify/db';
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
}, 60_000);

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});

afterAll(async () => {
  await database.close();
});

async function setup() {
  const api = await createDashboardHarness(database);
  harnesses.push(api);
  const organization = await api.organization();
  const admin = await api.operator(organization, { roles: ['admin'] });
  const token = await api.signIn(admin.email);
  return { api, organization, token };
}

describe('transaction-retention-days (C105.5, C107.7)', () => {
  it('reads null by default, and is stored and served once set', async () => {
    const { api, organization, token } = await setup();

    expect(expectJson(await api.call('GET', '/settings', { token }), 200)).toMatchObject({
      'transaction-retention-days': null,
    });
    expectJson(
      await api.call('PATCH', '/settings', {
        token,
        payload: { 'transaction-retention-days': 90 },
      }),
      200,
    );

    expect(expectJson(await api.call('GET', '/settings', { token }), 200)).toMatchObject({
      'transaction-retention-days': 90,
    });
    const environment = await getEnvironment(database.db, organization.sandboxId);
    expect(environment?.settings['transaction-retention-days']).toBe(90);
  });

  it('goes back to null', async () => {
    const { api, token } = await setup();
    await api.call('PATCH', '/settings', { token, payload: { 'transaction-retention-days': 90 } });

    expectJson(
      await api.call('PATCH', '/settings', {
        token,
        payload: { 'transaction-retention-days': null },
      }),
      200,
    );

    expect(expectJson(await api.call('GET', '/settings', { token }), 200)).toMatchObject({
      'transaction-retention-days': null,
    });
  });

  it.each([0, 3651, 1.5, '30'])('refuses %s', async (value) => {
    const { api, token } = await setup();

    const response = await api.call('PATCH', '/settings', {
      token,
      payload: { 'transaction-retention-days': value },
    });

    expect(response.statusCode).toBe(400);
  });
});
