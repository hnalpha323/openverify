/**
 * C97.4, C107.7 (Workflow 7B Stage 1b (L); F16, F37): `biometric-lists-basis`, served by
 * `GET /settings` and set by `PATCH /settings`. It needs `settings:privacy` too; a principal with
 * `settings:write` alone gets 403 and nothing changes. Every settings change runs
 * `onSettingsChangedInTx` in its transaction, with the settings before and after, so
 * `api-biometric-lists` can redact when the basis is cleared; a hook that throws rolls it back.
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
vi.mock('../../services/lists/biometric/settings-hook.js', () => ({
  onSettingsChangedInTx: (
    _tx: unknown,
    environmentId: string,
    before: EnvironmentSettings,
    after: EnvironmentSettings,
  ) => {
    calls.push({ environmentId, before, after });
    return failing.value ? Promise.reject(new Error('synthetic')) : Promise.resolve([]);
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

const BASIS = 'Synthetic basis: a recorded lawful basis for the list.';

describe('biometric-lists-basis (C97.4, C107.7)', () => {
  it('reads null until set, and is served once set', async () => {
    const { api, token } = await setup();

    expect(expectJson(await api.call('GET', '/settings', { token }), 200)).toMatchObject({
      'biometric-lists-basis': null,
    });
    expectJson(
      await api.call('PATCH', '/settings', { token, payload: { 'biometric-lists-basis': BASIS } }),
      200,
    );
    expect(expectJson(await api.call('GET', '/settings', { token }), 200)).toMatchObject({
      'biometric-lists-basis': BASIS,
    });
  });

  it('needs settings:privacy; settings:write alone gets 403 and nothing changes (F37)', async () => {
    const { api, organization } = await setup();
    const role = await createRole(database.db, organization.id, {
      id: newId('role'),
      name: 'Synthetic Settings Writer 7B',
      permissions: ['settings:read', 'settings:write'],
    });
    const writer = await api.operator(organization, { roles: [], roleIds: [role.id] });
    const token = await api.signIn(writer.email);

    const refused = await api.call('PATCH', '/settings', {
      token,
      payload: { 'biometric-lists-basis': BASIS },
    });

    expect(refused.statusCode).toBe(403);
    expect((await getEnvironment(database.db, organization.sandboxId))?.settings).toEqual({});
  });

  it('refuses a basis over 500 characters, and an empty one (400)', async () => {
    const { api, token } = await setup();
    for (const value of ['x'.repeat(501), '']) {
      const response = await api.call('PATCH', '/settings', {
        token,
        payload: { 'biometric-lists-basis': value },
      });
      expect(response.statusCode).toBe(400);
    }
  });
});

describe('onSettingsChangedInTx (F16)', () => {
  it('sees the settings before and after each change', async () => {
    const { api, organization, token } = await setup();
    expectJson(
      await api.call('PATCH', '/settings', { token, payload: { 'biometric-lists-basis': BASIS } }),
      200,
    );
    expectJson(
      await api.call('PATCH', '/settings', { token, payload: { 'biometric-lists-basis': null } }),
      200,
    );

    expect(calls).toEqual([
      {
        environmentId: organization.sandboxId,
        before: {},
        after: { 'biometric-lists-basis': BASIS },
      },
      {
        environmentId: organization.sandboxId,
        before: { 'biometric-lists-basis': BASIS },
        after: { 'biometric-lists-basis': null },
      },
    ]);
  });

  it('rolls the change back when the hook fails', async () => {
    const { api, organization, token } = await setup();
    failing.value = true;

    const response = await api.call('PATCH', '/settings', {
      token,
      payload: { 'biometric-lists-basis': BASIS },
    });

    expect(response.statusCode).toBe(500);
    expect((await getEnvironment(database.db, organization.sandboxId))?.settings).toEqual({});
  });
});
