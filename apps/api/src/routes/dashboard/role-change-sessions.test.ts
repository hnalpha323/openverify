/**
 * C245.3 (Phase 11, Workflow 11B, auth-sessions; Stage 1a amendment 4): a role change after which a
 * user holds no role in the environment one of its sessions works in revokes that session in the
 * change's transaction, beside the change's own audit entry; a session where a role remains is
 * kept. Both role writes: `PUT /dashboard/users/:id/roles` and `PATCH /dashboard/users/:id`. Every
 * value is synthetic.
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

async function setUp() {
  const api = await createDashboardHarness(database);
  harnesses.push(api);
  const organization = await api.organization({ production: true });
  const productionId = organization.productionId ?? '';
  const admin = await api.operator(organization, { roles: ['admin'] });
  const adminToken = await api.signIn(admin.email);
  const target = await api.operator(organization, { roles: ['developer'] });
  const sandboxToken = await api.signIn(target.email);
  const productionToken = await api.signIn(target.email);
  expectJson(
    await api.call('PUT', '/sessions/current/environment', {
      token: productionToken,
      payload: { 'environment-id': productionId },
    }),
    200,
  );
  return { api, organization, productionId, adminToken, target, sandboxToken, productionToken };
}

const me = (api: DashboardHarness, token: string) => api.call('GET', '/me', { token });

describe('a role change ends the sessions left without a role (C245.3)', () => {
  it('PUT roles narrowing the only role to the sandbox revokes the production session and keeps the sandbox one', async () => {
    const { api, organization, productionId, adminToken, target, sandboxToken, productionToken } =
      await setUp();

    expectJson(
      await api.call('PUT', `/users/${target.user.id}/roles`, {
        token: adminToken,
        payload: {
          assignments: [
            {
              'role-id': organization.roleIds.developer,
              'environment-ids': [organization.sandboxId],
            },
          ],
        },
      }),
      200,
    );

    expect((await me(api, sandboxToken)).statusCode).toBe(200);
    expect((await me(api, productionToken)).statusCode).toBe(401);
    // Given its role back, the user signs in again: the revoked session stays revoked.
    expectJson(
      await api.call('PUT', `/users/${target.user.id}/roles`, {
        token: adminToken,
        payload: {
          assignments: [{ 'role-id': organization.roleIds.developer, 'environment-ids': null }],
        },
      }),
      200,
    );
    expect((await me(api, productionToken)).statusCode).toBe(401);
    expect(await api.audit(productionId, 'user.roles-assigned')).toHaveLength(2);
  });

  it('PATCH roles that keep a role everywhere ends no session', async () => {
    const { api, organization, adminToken, target, sandboxToken, productionToken } = await setUp();

    expectJson(
      await api.call('PATCH', `/users/${target.user.id}`, {
        token: adminToken,
        payload: { data: { attributes: { 'role-ids': [organization.roleIds.developer] } } },
      }),
      200,
    );

    expect((await me(api, sandboxToken)).statusCode).toBe(200);
    expect((await me(api, productionToken)).statusCode).toBe(200);
  });
});
