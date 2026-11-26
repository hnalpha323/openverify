import { newId, roleDocumentSchema, roleListDocumentSchema } from '@openverify/contracts';
import { createRole, getRole } from '@openverify/db';
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

async function setup(roles: Parameters<DashboardHarness['operator']>[1] = { roles: ['admin'] }) {
  const api = await createDashboardHarness(database);
  harnesses.push(api);
  const organization = await api.organization();
  const operator = await api.operator(organization, roles);
  const token = await api.signIn(operator.email);
  return { api, organization, operator, token };
}

const roleBody = (attributes: Record<string, unknown>) => ({ data: { type: 'role', attributes } });

describe('GET /roles', () => {
  it('lists the built-in and custom roles of the organization only', async () => {
    const { api, organization, token } = await setup({ roles: ['viewer'] });
    const custom = await createRole(database.db, organization.id, {
      id: newId('role'),
      name: 'Synthetic Auditor',
      permissions: ['audit-logs:read'],
    });
    await api.organization();

    const body = roleListDocumentSchema.parse(
      expectJson(await api.call('GET', '/roles?page[size]=100', { token }), 200),
    );

    expect(body.data.map(({ id }) => id).sort()).toEqual(
      [...Object.values(organization.roleIds), custom.id].sort(),
    );
    expect(body.data.find(({ id }) => id === custom.id)?.attributes).toMatchObject({
      key: null,
      builtin: false,
      permissions: ['audit-logs:read'],
    });
  });

  it('needs roles:read', async () => {
    const { api, token } = await setup({ roles: ['reviewer'] });

    expect((await api.call('GET', '/roles', { token })).statusCode).toBe(403);
  });
});

describe('GET /roles/:id (C25.2, Workflow 2E)', () => {
  it('answers a built-in role and a custom role of the organization', async () => {
    const { api, organization, token } = await setup({ roles: ['viewer'] });
    const custom = await createRole(database.db, organization.id, {
      id: newId('role'),
      name: 'Synthetic Auditor',
      permissions: ['audit-logs:read'],
    });

    const builtin = roleDocumentSchema.parse(
      expectJson(await api.call('GET', `/roles/${organization.roleIds.reviewer}`, { token }), 200),
    );
    const own = roleDocumentSchema.parse(
      expectJson(await api.call('GET', `/roles/${custom.id}`, { token }), 200),
    );

    expect(builtin.data).toMatchObject({
      type: 'role',
      id: organization.roleIds.reviewer,
      attributes: { key: 'reviewer', builtin: true },
    });
    expect(own.data).toMatchObject({
      id: custom.id,
      attributes: {
        name: 'Synthetic Auditor',
        key: null,
        builtin: false,
        permissions: ['audit-logs:read'],
      },
    });
  });

  it('answers 404 for an unknown role or a role of another organization', async () => {
    const { api, token } = await setup({ roles: ['viewer'] });
    const other = await api.organization();
    const foreign = await createRole(database.db, other.id, {
      id: newId('role'),
      name: 'Synthetic Foreign',
      permissions: ['inquiries:read'],
    });

    for (const id of [newId('role'), foreign.id, other.roleIds.admin]) {
      const response = await api.call('GET', `/roles/${id}`, { token });
      expect(response.statusCode, id).toBe(404);
      expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    }
  });

  it('answers 403 without roles:read and 400 for a malformed id', async () => {
    const { api, organization, token } = await setup({ roles: ['reviewer'] });
    const viewer = await api.operator(organization, { roles: ['viewer'] });
    const viewerToken = await api.signIn(viewer.email);

    expect(
      (await api.call('GET', `/roles/${organization.roleIds.admin}`, { token })).statusCode,
    ).toBe(403);
    expect((await api.call('GET', '/roles/not-a-role', { token: viewerToken })).statusCode).toBe(
      400,
    );
  });
});

describe('POST /roles', () => {
  it('creates a custom role and audits it', async () => {
    const { api, organization, operator, token } = await setup();

    const response = await api.call('POST', '/roles', {
      token,
      payload: roleBody({ name: 'Synthetic Support', permissions: ['inquiries:read', 'pii:view'] }),
    });

    const body = roleDocumentSchema.parse(expectJson(response, 201));
    expect(body.data.attributes).toMatchObject({
      name: 'Synthetic Support',
      key: null,
      builtin: false,
      permissions: ['inquiries:read', 'pii:view'],
    });
    const [entry] = await api.audit(organization.sandboxId, 'role.created');
    expect(entry).toMatchObject({
      actorId: operator.user.id,
      resourceType: 'role',
      resourceId: body.data.id,
    });
  });

  it('answers 409 for a name in use, 400 for unknown permissions, 403 without roles:write or beyond the actor’s permissions', async () => {
    const { api, organization, token } = await setup();
    const manager = await createRole(database.db, organization.id, {
      id: newId('role'),
      name: 'Synthetic Role Manager',
      permissions: ['roles:read', 'roles:write', 'inquiries:read'],
    });
    const managerUser = await api.operator(organization, { roles: [], roleIds: [manager.id] });
    const managerToken = await api.signIn(managerUser.email);
    const viewer = await api.operator(organization, { roles: ['viewer'] });
    const viewerToken = await api.signIn(viewer.email);
    const create = (by: string, attributes: Record<string, unknown>) =>
      api.call('POST', '/roles', { token: by, payload: roleBody(attributes) });

    expect(
      (await create(token, { name: 'admin', permissions: ['inquiries:read'] })).statusCode,
    ).toBe(409);
    expect(
      (await create(token, { name: 'Bogus', permissions: ['not:a-permission'] })).statusCode,
    ).toBe(400);
    expect(
      (await create(managerToken, { name: 'Too much', permissions: ['pii:view'] })).statusCode,
    ).toBe(403);
    expect(
      (await create(managerToken, { name: 'Within', permissions: ['inquiries:read'] })).statusCode,
    ).toBe(201);
    expect(
      (await create(viewerToken, { name: 'Nope', permissions: ['inquiries:read'] })).statusCode,
    ).toBe(403);
  });
});

describe('PATCH /roles/:id', () => {
  it('renames and re-scopes a custom role', async () => {
    const { api, organization, token } = await setup();
    const custom = await createRole(database.db, organization.id, {
      id: newId('role'),
      name: 'Synthetic Before',
      permissions: ['inquiries:read'],
    });

    const response = await api.call('PATCH', `/roles/${custom.id}`, {
      token,
      payload: roleBody({ name: 'Synthetic After', permissions: ['events:read'] }),
    });

    expect(roleDocumentSchema.parse(expectJson(response, 200)).data.attributes).toMatchObject({
      name: 'Synthetic After',
      permissions: ['events:read'],
    });
    expect(await api.audit(organization.sandboxId, 'role.updated')).toHaveLength(1);
  });

  it('answers 409 for a built-in role and 404 for another organization’s role', async () => {
    const { api, organization, token } = await setup();
    const other = await api.organization();
    const patch = (id: string) =>
      api.call('PATCH', `/roles/${id}`, { token, payload: roleBody({ name: 'Renamed' }) });

    expect((await patch(organization.roleIds.viewer)).statusCode).toBe(409);
    expect((await patch(other.roleIds.viewer)).statusCode).toBe(404);
    expect((await patch(newId('role'))).statusCode).toBe(404);
  });
});

describe('PATCH /roles/:id permissions', () => {
  it('needs roles:write', async () => {
    const { api, organization, token } = await setup({ roles: ['viewer'] });
    const custom = await createRole(database.db, organization.id, {
      id: newId('role'),
      name: 'Synthetic Untouchable',
      permissions: ['inquiries:read'],
    });

    const response = await api.call('PATCH', `/roles/${custom.id}`, {
      token,
      payload: roleBody({ name: 'Renamed' }),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ type: 'https://openverify.dev/problems/forbidden' });
  });
});

describe('DELETE /roles/:id', () => {
  it('deletes an unused custom role; 409 for a role in use or built-in; 404 elsewhere', async () => {
    const { api, organization, token } = await setup();
    const other = await api.organization();
    const unused = await createRole(database.db, organization.id, {
      id: newId('role'),
      name: 'Synthetic Unused',
      permissions: ['inquiries:read'],
    });
    const held = await createRole(database.db, organization.id, {
      id: newId('role'),
      name: 'Synthetic Held',
      permissions: ['inquiries:read'],
    });
    await api.operator(organization, { roles: [], roleIds: [held.id] });

    expect((await api.call('DELETE', `/roles/${held.id}`, { token })).statusCode).toBe(409);
    expect(
      (await api.call('DELETE', `/roles/${organization.roleIds.admin}`, { token })).statusCode,
    ).toBe(409);
    expect((await api.call('DELETE', `/roles/${other.roleIds.viewer}`, { token })).statusCode).toBe(
      404,
    );
    const deleted = await api.call('DELETE', `/roles/${unused.id}`, { token });

    expect(deleted.statusCode).toBe(204);
    expect(await getRole(database.db, organization.id, unused.id)).toBeNull();
    expect(await api.audit(organization.sandboxId, 'role.deleted')).toHaveLength(1);
  });

  it('needs roles:write', async () => {
    const { api, organization, token } = await setup({ roles: ['viewer'] });
    const custom = await createRole(database.db, organization.id, {
      id: newId('role'),
      name: 'Synthetic Protected',
      permissions: ['inquiries:read'],
    });

    expect((await api.call('DELETE', `/roles/${custom.id}`, { token })).statusCode).toBe(403);
  });
});

describe('PATCH and DELETE /roles/:id change only access the operator holds (Workflow 2D K002)', () => {
  const FORBIDDEN = 'https://openverify.dev/problems/forbidden';

  /** An operator who manages roles and reads inquiries, without pii:view. */
  async function roleManager() {
    const { api, organization } = await setup();
    const manager = await createRole(database.db, organization.id, {
      id: newId('role'),
      name: 'Synthetic Role Manager',
      permissions: ['roles:read', 'roles:write', 'inquiries:read'],
    });
    const user = await api.operator(organization, { roles: [], roleIds: [manager.id] });
    const beyond = await createRole(database.db, organization.id, {
      id: newId('role'),
      name: 'Synthetic PII Reader',
      permissions: ['inquiries:read', 'pii:view'],
    });
    return { api, organization, beyond, token: await api.signIn(user.email) };
  }

  it('refuses to remove a permission the operator does not hold (403), and keeps it', async () => {
    const { api, organization, beyond, token } = await roleManager();

    const response = await api.call('PATCH', `/roles/${beyond.id}`, {
      token,
      payload: roleBody({ permissions: ['inquiries:read'] }),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      type: FORBIDDEN,
      detail: 'You cannot remove permissions you do not hold: pii:view.',
    });
    expect((await getRole(database.db, organization.id, beyond.id))?.permissions).toEqual([
      'inquiries:read',
      'pii:view',
    ]);
  });

  it('refuses to delete a role with a permission the operator does not hold (403), and keeps it', async () => {
    const { api, organization, beyond, token } = await roleManager();

    const response = await api.call('DELETE', `/roles/${beyond.id}`, { token });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      type: FORBIDDEN,
      detail: 'You cannot delete a role with permissions you do not hold: pii:view.',
    });
    expect(await getRole(database.db, organization.id, beyond.id)).not.toBeNull();
  });

  it('still renames such a role, which changes no access', async () => {
    const { api, beyond, token } = await roleManager();

    const response = await api.call('PATCH', `/roles/${beyond.id}`, {
      token,
      payload: roleBody({ name: 'Synthetic Renamed' }),
    });

    expect(roleDocumentSchema.parse(expectJson(response, 200)).data.attributes.name).toBe(
      'Synthetic Renamed',
    );
  });
});
