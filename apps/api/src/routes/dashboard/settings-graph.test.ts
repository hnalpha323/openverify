/**
 * C101.3, C101.5, C101.6, C102.7, C107.7 (Workflow 7B Stage 1b (G); P26, F37): the graph settings,
 * served by `GET /settings` and set by `PATCH /settings`. `graph-indexing` (default on),
 * `graph-weak-kinds` and `graph-components` (default off) need `settings:privacy` too;
 * `graph-query-retention-days` (1-365, default 30) needs `settings:write`. Every settings change runs
 * `onGraphSettingsChangedInTx` in its transaction with the settings before and after, so `api-graph`
 * marks a kind incomplete when a switch starts writing it (C101.5); a hook that throws rolls the
 * change back.
 */
import { newId } from '@openverify/contracts';
import { createRole, getEnvironment, type EnvironmentSettings } from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDashboardHarness,
  expectJson,
  type DashboardHarness,
} from './dashboard.test-support.js';

const calls = vi.hoisted(() => [] as { environmentId: string; before: unknown; after: unknown }[]);
const failing = vi.hoisted(() => ({ value: false }));
vi.mock('../../services/graph/settings-hook.js', () => ({
  onGraphSettingsChangedInTx: (
    _tx: unknown,
    environmentId: string,
    before: EnvironmentSettings,
    after: EnvironmentSettings,
  ) => {
    calls.push({ environmentId, before, after });
    return failing.value ? Promise.reject(new Error('synthetic')) : Promise.resolve();
  },
}));

let database: TestDatabase;
const harnesses: DashboardHarness[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

beforeEach(() => {
  calls.length = 0;
  failing.value = false;
});

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

async function writerOnly(
  api: DashboardHarness,
  organization: Awaited<ReturnType<DashboardHarness['organization']>>,
) {
  const role = await createRole(database.db, organization.id, {
    id: newId('role'),
    name: 'Synthetic Settings Writer 7B G',
    permissions: ['settings:read', 'settings:write'],
  });
  const writer = await api.operator(organization, { roles: [], roleIds: [role.id] });
  return api.signIn(writer.email);
}

describe('the graph settings (C101.3, C101.6, C102.7, C107.7)', () => {
  it('serves the defaults: indexing on, weak kinds and components off, results kept 30 days', async () => {
    const { api, token } = await setup();

    expect(expectJson(await api.call('GET', '/settings', { token }), 200)).toMatchObject({
      'graph-indexing': true,
      'graph-weak-kinds': false,
      'graph-components': false,
      'graph-query-retention-days': 30,
    });
  });

  it('stores and serves each one once set', async () => {
    const { api, organization, token } = await setup();
    const changes = {
      'graph-indexing': false,
      'graph-weak-kinds': true,
      'graph-components': true,
      'graph-query-retention-days': 7,
    };

    expectJson(await api.call('PATCH', '/settings', { token, payload: changes }), 200);

    expect(expectJson(await api.call('GET', '/settings', { token }), 200)).toMatchObject(changes);
    expect((await getEnvironment(database.db, organization.sandboxId))?.settings).toMatchObject(
      changes,
    );
  });

  it.each(['graph-indexing', 'graph-weak-kinds', 'graph-components'])(
    '%s needs settings:privacy; settings:write alone gets 403 and nothing changes (F37)',
    async (name) => {
      const { api, organization } = await setup();
      const token = await writerOnly(api, organization);

      const refused = await api.call('PATCH', '/settings', { token, payload: { [name]: true } });

      expect(refused.statusCode).toBe(403);
      expect((await getEnvironment(database.db, organization.sandboxId))?.settings).toEqual({});
    },
  );

  it('sets graph-query-retention-days with settings:write alone', async () => {
    const { api, organization } = await setup();
    const token = await writerOnly(api, organization);

    expectJson(
      await api.call('PATCH', '/settings', {
        token,
        payload: { 'graph-query-retention-days': 90 },
      }),
      200,
    );
  });

  it.each([0, 366, 1.5, '30', null])('refuses graph-query-retention-days %s', async (value) => {
    const { api, token } = await setup();

    const response = await api.call('PATCH', '/settings', {
      token,
      payload: { 'graph-query-retention-days': value },
    });

    expect(response.statusCode).toBe(400);
  });

  it.each([null, 'on', 1])('refuses graph-indexing %s', async (value) => {
    const { api, token } = await setup();

    const response = await api.call('PATCH', '/settings', {
      token,
      payload: { 'graph-indexing': value },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('onGraphSettingsChangedInTx (C101.5, F16)', () => {
  it('sees the settings before and after each change', async () => {
    const { api, organization, token } = await setup();

    expectJson(
      await api.call('PATCH', '/settings', { token, payload: { 'graph-weak-kinds': true } }),
      200,
    );

    expect(calls).toEqual([
      {
        environmentId: organization.sandboxId,
        before: {},
        after: { 'graph-weak-kinds': true },
      },
    ]);
  });

  it('rolls the change back when the hook fails', async () => {
    const { api, organization, token } = await setup();
    failing.value = true;

    const response = await api.call('PATCH', '/settings', {
      token,
      payload: { 'graph-weak-kinds': true },
    });

    expect(response.statusCode).toBe(500);
    expect((await getEnvironment(database.db, organization.sandboxId))?.settings).toEqual({});
  });
});
