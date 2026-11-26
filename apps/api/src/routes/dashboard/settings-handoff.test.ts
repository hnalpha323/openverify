/**
 * C107.7, C96.1 (Workflow 7A Stage 1b (H); F30, decision 52): `organization-display-name` on the
 * C16 settings route. The phone's handoff context screen shows it to the end user, and publishing
 * a `device_handoff` step needs it (422 `display_name_required`).
 *
 * - `GET /settings` serves it, `null` until set.
 * - `PATCH /settings` sets it on the environment under `settings:write`, audited as every change
 *   is; `null` clears it; it is 1 to 100 characters (400 otherwise).
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
  return { api, organization, admin, token };
}

const NAME = 'Example Verification Ltd';

describe('organization-display-name (C107.7, F30)', () => {
  it('is served as null until set', async () => {
    const { api, token } = await setup();

    const body = expectJson(await api.call('GET', '/settings', { token }), 200);

    expect(body).toMatchObject({ 'organization-display-name': null });
  });

  it('is set on the environment under settings:write, audited, and cleared with null', async () => {
    const { api, organization, admin, token } = await setup();
    const changes = { 'organization-display-name': NAME };

    const body = expectJson(await api.call('PATCH', '/settings', { token, payload: changes }), 200);

    expect(body).toMatchObject(changes);
    expect((await getEnvironment(database.db, organization.sandboxId))?.settings).toEqual(changes);
    const [entry] = await api.audit(organization.sandboxId, 'settings.updated');
    expect(entry).toMatchObject({ actorId: admin.user.id, metadata: changes });
    const cleared = expectJson(
      await api.call('PATCH', '/settings', {
        token,
        payload: { 'organization-display-name': null },
      }),
      200,
    );
    expect(cleared).toMatchObject({ 'organization-display-name': null });
  });

  it.each([
    ['an empty name', ''],
    ['a name over 100 characters', 'x'.repeat(101)],
  ])('refuses %s with 400, storing nothing', async (_label, name) => {
    const { api, organization, token } = await setup();

    const response = await api.call('PATCH', '/settings', {
      token,
      payload: { 'organization-display-name': name },
    });

    expect(response.statusCode).toBe(400);
    expect((await getEnvironment(database.db, organization.sandboxId))?.settings).toEqual({});
  });
});
