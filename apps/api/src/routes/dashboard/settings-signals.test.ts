/**
 * C90.8, C91.7, C107.7 (Workflow 7A Stage 1b (S)): the signal settings on the C16 settings route.
 *
 * - `GET /settings` serves `signal-collection` (session integrity on, device recognition off),
 *   `expose-signals` (true), `signal-component-retention-days` (30), `ip-retention-days` (null:
 *   the inquiry's retention) and `device-retention-days` (365), with their defaults.
 * - `PATCH /settings` sets them on the environment, audited as every change is.
 *   `signal-collection` needs `settings:privacy` too (F37, P10): a principal with `settings:write`
 *   alone gets 403 and nothing changes. `exempt` without a recorded basis answers 422
 *   `basis_required`. The windows keep their bounds (400).
 */
import { newId } from '@openverify/contracts';
import { createRole, getEnvironment } from '@openverify/db';
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
  return { api, organization, admin, token };
}

const SIGNAL_DEFAULTS = {
  'signal-collection': {
    'session-integrity': 'on',
    'device-recognition': 'off',
    'device-recognition-basis': null,
  },
  'expose-signals': true,
  'signal-component-retention-days': 30,
  'ip-retention-days': null,
  'device-retention-days': 365,
};

describe('GET /settings: the signal settings (C90.8, C91.7)', () => {
  it('serves their defaults to a viewer', async () => {
    const { api, organization } = await setup();
    const viewer = await api.operator(organization, { roles: ['viewer'] });
    const token = await api.signIn(viewer.email);

    const body = expectJson(await api.call('GET', '/settings', { token }), 200);

    expect(body).toMatchObject(SIGNAL_DEFAULTS);
  });
});

describe('PATCH /settings: the signal settings (C90.8, C91.7, C107.7)', () => {
  it('sets each of them on the environment and audits the change', async () => {
    const { api, organization, admin, token } = await setup();
    const changes = {
      'signal-collection': {
        'session-integrity': 'on',
        'device-recognition': 'consent',
        'device-recognition-basis': null,
      },
      'expose-signals': false,
      'signal-component-retention-days': 7,
      'ip-retention-days': 90,
      'device-retention-days': 30,
    };

    const body = expectJson(await api.call('PATCH', '/settings', { token, payload: changes }), 200);

    expect(body).toMatchObject(changes);
    expect((await getEnvironment(database.db, organization.sandboxId))?.settings).toEqual(changes);
    const [entry] = await api.audit(organization.sandboxId, 'settings.updated');
    expect(entry).toMatchObject({ actorId: admin.user.id, metadata: changes });
  });

  it('keeps addresses with the inquiry again with a null ip-retention-days', async () => {
    const { api, token } = await setup();
    expectJson(
      await api.call('PATCH', '/settings', { token, payload: { 'ip-retention-days': 30 } }),
      200,
    );

    const body = expectJson(
      await api.call('PATCH', '/settings', { token, payload: { 'ip-retention-days': null } }),
      200,
    );

    expect(body).toMatchObject({ 'ip-retention-days': null });
  });

  it('refuses exempt device recognition without its basis: 422 basis_required, nothing stored', async () => {
    const { api, organization, token } = await setup();

    const response = await api.call('PATCH', '/settings', {
      token,
      payload: {
        'signal-collection': {
          'session-integrity': 'on',
          'device-recognition': 'exempt',
          'device-recognition-basis': null,
        },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'basis_required',
      errors: [{ pointer: '/signal-collection/device-recognition-basis' }],
    });
    expect((await getEnvironment(database.db, organization.sandboxId))?.settings).toEqual({});
  });

  it('takes exempt with a recorded basis', async () => {
    const { api, token } = await setup();
    const collection = {
      'session-integrity': 'off',
      'device-recognition': 'exempt',
      'device-recognition-basis': 'Synthetic documented assessment',
    };

    const body = expectJson(
      await api.call('PATCH', '/settings', { token, payload: { 'signal-collection': collection } }),
      200,
    );

    expect(body).toMatchObject({ 'signal-collection': collection });
  });

  it('needs settings:privacy for signal-collection, and only for it (F37, P10)', async () => {
    const { api, organization } = await setup();
    const role = await createRole(database.db, organization.id, {
      id: newId('role'),
      name: 'Synthetic Settings Writer',
      permissions: ['settings:read', 'settings:write'],
    });
    const writer = await api.operator(organization, { roles: [], roleIds: [role.id] });
    const token = await api.signIn(writer.email);

    const refused = await api.call('PATCH', '/settings', {
      token,
      payload: {
        'signal-collection': SIGNAL_DEFAULTS['signal-collection'],
        'expose-signals': false,
      },
    });

    expect(refused.statusCode).toBe(403);
    expect((await getEnvironment(database.db, organization.sandboxId))?.settings).toEqual({});
    expectJson(
      await api.call('PATCH', '/settings', { token, payload: { 'expose-signals': false } }),
      200,
    );
  });

  it.each([
    ['signal-component-retention-days', 366],
    ['signal-component-retention-days', 0],
    ['ip-retention-days', 3651],
    ['device-retention-days', 1096],
    ['expose-signals', 'no'],
  ])('refuses %s = %s (400)', async (key, value) => {
    const { api, token } = await setup();

    expect(
      (await api.call('PATCH', '/settings', { token, payload: { [key]: value } })).statusCode,
    ).toBe(400);
  });
});
