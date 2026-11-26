import {
  dashboardMeDocumentSchema,
  dashboardSwitchEnvironmentResponseSchema,
  newId,
} from '@openverify/contracts';
import { createRole, setUserRoleAssignments } from '@openverify/db';
import { createTestDatabase, createTestInquiry, type TestDatabase } from '@openverify/db/testing';
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

async function setup(roles: Parameters<DashboardHarness['operator']>[1] = {}) {
  const api = await createDashboardHarness(database);
  harnesses.push(api);
  const organization = await api.organization({ production: true });
  const operator = await api.operator(organization, roles);
  const token = await api.signIn(operator.email);
  return { api, organization, operator, token };
}

const switchTo = (api: DashboardHarness, token: string, environmentId: string) =>
  api.call('PUT', '/sessions/current/environment', {
    token,
    payload: { 'environment-id': environmentId },
  });

describe('GET /me environments (Workflow 2C: the switcher learns where it can go)', () => {
  it('lists every environment of the organization, oldest first, and no other organization’s', async () => {
    const { api, organization, token } = await setup({ roles: ['reviewer'] });
    await api.organization({ production: true });

    const me = dashboardMeDocumentSchema.parse(
      expectJson(await api.call('GET', '/me', { token }), 200),
    );

    expect(me.meta?.environments).toEqual([
      { id: organization.sandboxId, kind: 'sandbox' },
      { id: organization.productionId, kind: 'production' },
    ]);
    expect(me.meta?.environment).toEqual({ id: organization.sandboxId, kind: 'sandbox' });
  });

  it('lists the sandbox alone when the organization has no production environment', async () => {
    const api = await createDashboardHarness(database);
    harnesses.push(api);
    const organization = await api.organization();
    const operator = await api.operator(organization);
    const token = await api.signIn(operator.email);

    const me = dashboardMeDocumentSchema.parse(
      expectJson(await api.call('GET', '/me', { token }), 200),
    );

    expect(me.meta?.environments).toEqual([{ id: organization.sandboxId, kind: 'sandbox' }]);
  });
});

describe('PUT /sessions/current/environment (C15)', () => {
  it('moves the session into production with environments:production, and audits the switch there', async () => {
    const { api, organization, operator, token } = await setup({ roles: ['developer'] });
    const productionId = organization.productionId ?? '';
    const inProduction = await createTestInquiry(database.db, productionId);

    const response = await switchTo(api, token, productionId);

    expect(dashboardSwitchEnvironmentResponseSchema.parse(expectJson(response, 200))).toEqual({
      environment: { id: productionId, kind: 'production' },
    });
    const me = dashboardMeDocumentSchema.parse(
      expectJson(await api.call('GET', '/me', { token }), 200),
    );
    expect(me.meta?.environment).toEqual({ id: productionId, kind: 'production' });
    const list = expectJson<{ data: { id: string }[] }>(
      await api.call('GET', '/inquiries', { token }),
      200,
    );
    expect(list.data.map(({ id }) => id)).toEqual([inProduction.inquiry.id]);
    const [entry] = await api.audit(productionId, 'environment.switched');
    expect(entry).toMatchObject({
      actorType: 'user',
      actorId: operator.user.id,
      resourceType: 'environment',
      resourceId: productionId,
      metadata: { from: organization.sandboxId },
    });
  });

  it('refuses production without environments:production (403 forbidden), but allows sandbox', async () => {
    const { api, organization, token } = await setup({ roles: ['reviewer'] });

    const production = await switchTo(api, token, organization.productionId ?? '');
    const sandbox = await switchTo(api, token, organization.sandboxId);

    expect(production.statusCode).toBe(403);
    expect(production.json()).toMatchObject({ type: 'https://openverify.dev/problems/forbidden' });
    expect(sandbox.statusCode).toBe(200);
  });

  it('answers 404 for another organization’s environment and an unknown one', async () => {
    const { api, token } = await setup();
    const other = await api.organization({ production: true });

    expect((await switchTo(api, token, other.sandboxId)).statusCode).toBe(404);
    expect((await switchTo(api, token, newId('env'))).statusCode).toBe(404);
  });

  it('validates the body and requires a session', async () => {
    const { api, organization, token } = await setup();

    expect(
      (
        await api.call('PUT', '/sessions/current/environment', {
          token,
          payload: { 'environment-id': 'nope' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await api.call('PUT', '/sessions/current/environment', {
          payload: { 'environment-id': organization.sandboxId },
        })
      ).statusCode,
    ).toBe(401);
  });
});

describe('the environment switch needs a role there (C167.2; review F29)', () => {
  /** An operator holding one role in the sandbox only and one in production only. */
  async function perEnvironment(productionPermissions: string[]) {
    const api = await createDashboardHarness(database);
    harnesses.push(api);
    const organization = await api.organization({ production: true });
    const productionId = organization.productionId ?? '';
    const sandboxRole = await createRole(database.db, organization.id, {
      id: newId('role'),
      name: `Synthetic sandbox ${newId('role')}`,
      permissions: ['inquiries:read'],
    });
    const productionRole = await createRole(database.db, organization.id, {
      id: newId('role'),
      name: `Synthetic production ${newId('role')}`,
      permissions: productionPermissions,
    });
    const operator = await api.operator(organization, { roles: [] });
    return { api, organization, productionId, operator, sandboxRole, productionRole };
  }

  it('refuses an environment where the user holds no role with 403 no_environment_role', async () => {
    const { api, organization, productionId, operator, sandboxRole } = await perEnvironment([]);
    await setUserRoleAssignments(database.db, organization.id, operator.user.id, [
      { roleId: sandboxRole.id, environmentIds: [organization.sandboxId] },
    ]);
    const token = await api.signIn(operator.email);

    const response = await switchTo(api, token, productionId);

    expect(response.statusCode, response.body).toBe(403);
    expect(response.json()).toMatchObject({ code: 'no_environment_role' });
    expect(await api.audit(productionId, 'environment.switched')).toEqual([]);
  });

  it('lets a user who holds roles in production only work there, and refuses the sandbox', async () => {
    const { api, organization, productionId, operator, productionRole } = await perEnvironment([
      'inquiries:read',
      'environments:production',
    ]);
    await setUserRoleAssignments(database.db, organization.id, operator.user.id, [
      { roleId: productionRole.id, environmentIds: [productionId] },
    ]);
    const token = await api.signIn(operator.email);

    const me = dashboardMeDocumentSchema.parse(
      expectJson(await api.call('GET', '/me', { token }), 200),
    );
    const sandbox = await switchTo(api, token, organization.sandboxId);

    expect(me.meta?.environment).toEqual({ id: productionId, kind: 'production' });
    expect(sandbox.statusCode, sandbox.body).toBe(403);
    expect(sandbox.json()).toMatchObject({ code: 'no_environment_role' });
  });

  it('still answers 403 forbidden for production held without environments:production there', async () => {
    const { api, organization, productionId, operator, productionRole, sandboxRole } =
      await perEnvironment(['inquiries:read']);
    await setUserRoleAssignments(database.db, organization.id, operator.user.id, [
      { roleId: sandboxRole.id, environmentIds: [organization.sandboxId] },
      { roleId: productionRole.id, environmentIds: [productionId] },
    ]);
    const token = await api.signIn(operator.email);

    const response = await switchTo(api, token, productionId);

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ type: 'https://openverify.dev/problems/forbidden' });
  });

  it('reads environments:production from the target, not from the session’s environment', async () => {
    const { api, organization, productionId, operator, productionRole } = await perEnvironment([
      'inquiries:read',
    ]);
    const sandboxWithRight = await createRole(database.db, organization.id, {
      id: newId('role'),
      name: `Synthetic sandbox right ${newId('role')}`,
      permissions: ['inquiries:read', 'environments:production'],
    });
    await setUserRoleAssignments(database.db, organization.id, operator.user.id, [
      { roleId: sandboxWithRight.id, environmentIds: [organization.sandboxId] },
      { roleId: productionRole.id, environmentIds: [productionId] },
    ]);
    const token = await api.signIn(operator.email);

    const response = await switchTo(api, token, productionId);

    expect(response.statusCode, response.body).toBe(403);
  });
});
