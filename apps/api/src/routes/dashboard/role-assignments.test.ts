/**
 * C167.2, C167.3 (Phase 9, Workflow 9B; decisions 49 and 70, review P01): roles granted per
 * environment through the dashboard API.
 *
 * - `PUT /users/:id/roles` replaces a user's assignments, each a role and its environments (`null`
 *   for every current and future one); an organisation-level permission or the built-in admin in a
 *   narrower assignment is 422 `role_scope_invalid`; the granting user must hold each permission in
 *   each environment named, and what the user loses in each environment it could grant there.
 * - `PATCH /users/:id`'s `role-ids` and an invitation's roles mean every environment, so they need
 *   the permissions organisation-wide.
 * - Editing a role's permissions needs each added and removed permission in every environment where
 *   the role is assigned.
 * - `GET /roles/grantable` lists, per environment then organisation-wide, what the caller may grant.
 * - Every change is audited in every environment of the organisation, with ids only.
 * - The refusal tests of C167.2: a sandbox-only `roles:write` cannot add a permission to a role
 *   assigned in production, and a sandbox-only `users:write` cannot act on a user at all.
 *
 * Every value is synthetic.
 */
import {
  grantableDocumentSchema,
  newId,
  userRoleAssignmentsDocumentSchema,
  type GrantableDocument,
} from '@openverify/contracts';
import { PERMISSIONS } from '@openverify/core';
import {
  createRole,
  listUserRoleAssignments,
  setUserRoleAssignments,
  type Role,
} from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createDashboardHarness,
  expectJson,
  type DashboardHarness,
  type TestOrganization,
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

interface Setup {
  api: DashboardHarness;
  organization: TestOrganization;
  sandboxId: string;
  productionId: string;
  token: string;
  adminId: string;
}

async function setup(): Promise<Setup> {
  const api = await createDashboardHarness(database);
  harnesses.push(api);
  const organization = await api.organization({ production: true });
  const admin = await api.operator(organization, { roles: ['admin'] });
  return {
    api,
    organization,
    sandboxId: organization.sandboxId,
    productionId: organization.productionId ?? '',
    token: await api.signIn(admin.email),
    adminId: admin.user.id,
  };
}

const role = (organization: TestOrganization, permissions: string[]): Promise<Role> =>
  createRole(database.db, organization.id, {
    id: newId('role'),
    name: `Synthetic ${newId('role')}`,
    permissions,
  });

const put = (api: DashboardHarness, token: string, userId: string, assignments: unknown[]) =>
  api.call('PUT', `/users/${userId}/roles`, { token, payload: { assignments } });

/** An operator signed in with `assignments` (role and environments) only. */
async function signedInWith(
  { api, organization }: Pick<Setup, 'api' | 'organization'>,
  assignments: { role: Role; environmentIds: string[] | null }[],
) {
  const user = await api.operator(organization, { roles: [] });
  await setUserRoleAssignments(
    database.db,
    organization.id,
    user.user.id,
    assignments.map((assignment) => ({
      roleId: assignment.role.id,
      environmentIds: assignment.environmentIds,
    })),
  );
  return { ...user, token: await api.signIn(user.email) };
}

const stored = async (organizationId: string, userId: string) =>
  (await listUserRoleAssignments(database.db, organizationId, userId))
    .map((assignment) => ({
      roleId: assignment.role.id,
      environmentIds: assignment.environmentIds,
    }))
    .sort((a, b) => a.roleId.localeCompare(b.roleId));

describe('PUT /users/:id/roles (C167.3)', () => {
  it('stores each assignment with its environments, answers them, and the session gets only its environment’s', async () => {
    const context = await setup();
    const { api, organization, sandboxId, productionId, token } = context;
    const reader = await role(organization, ['inquiries:read']);
    const writer = await role(organization, ['inquiries:write', 'environments:production']);
    const target = await api.operator(organization, { roles: ['viewer'] });
    const assignments = [
      { 'role-id': reader.id, 'environment-ids': null },
      { 'role-id': writer.id, 'environment-ids': [productionId] },
    ];

    const response = await put(api, token, target.user.id, assignments);
    const targetToken = await api.signIn(target.email);
    const me = expectJson<{ meta: { permissions: string[] } }>(
      await api.call('GET', '/me', { token: targetToken }),
      200,
    );

    const document = userRoleAssignmentsDocumentSchema.parse(expectJson(response, 200));
    expect(document.data).toEqual({
      type: 'user-role-assignments',
      id: target.user.id,
      attributes: { assignments: expect.arrayContaining(assignments) as unknown },
    });
    expect(document.data.attributes.assignments).toHaveLength(2);
    expect(await stored(organization.id, target.user.id)).toEqual(
      [
        { roleId: reader.id, environmentIds: null },
        { roleId: writer.id, environmentIds: [productionId] },
      ].sort((a, b) => a.roleId.localeCompare(b.roleId)),
    );
    // Signed in to the sandbox, where only the organisation-wide reader reaches.
    expect(me.meta.permissions).toEqual(['inquiries:read']);
    expect(sandboxId).not.toBe(productionId);
  });

  it('refuses an organisation-level permission or the admin role in a narrower assignment (422 role_scope_invalid)', async () => {
    const { api, organization, sandboxId, token } = await setup();
    const manager = await role(organization, ['users:read', 'inquiries:read']);
    const target = await api.operator(organization, { roles: ['viewer'] });

    const orgLevel = await put(api, token, target.user.id, [
      { 'role-id': organization.roleIds.viewer, 'environment-ids': null },
      { 'role-id': manager.id, 'environment-ids': [sandboxId] },
    ]);
    const admin = await put(api, token, target.user.id, [
      { 'role-id': organization.roleIds.admin, 'environment-ids': [sandboxId] },
    ]);

    expect(orgLevel.statusCode, orgLevel.body).toBe(422);
    expect(orgLevel.json()).toMatchObject({
      code: 'role_scope_invalid',
      errors: [{ pointer: '/assignments/1/environment-ids' }],
    });
    expect(admin.statusCode, admin.body).toBe(422);
    expect(admin.json()).toMatchObject({
      code: 'role_scope_invalid',
      errors: [{ pointer: '/assignments/0/environment-ids' }],
    });
    expect(await stored(organization.id, target.user.id)).toEqual([
      { roleId: organization.roleIds.viewer, environmentIds: null },
    ]);
  });

  it('refuses an unknown role, an environment of another organisation and an unknown user', async () => {
    const { api, organization, token } = await setup();
    const other = await api.organization();
    const target = await api.operator(organization, { roles: ['viewer'] });

    const unknownRole = await put(api, token, target.user.id, [
      { 'role-id': other.roleIds.viewer, 'environment-ids': null },
    ]);
    const foreignEnvironment = await put(api, token, target.user.id, [
      { 'role-id': organization.roleIds.viewer, 'environment-ids': [other.sandboxId] },
    ]);
    const unknownUser = await put(api, token, newId('usr'), [
      { 'role-id': organization.roleIds.viewer, 'environment-ids': null },
    ]);

    expect(unknownRole.statusCode).toBe(422);
    expect(unknownRole.json()).toMatchObject({ errors: [{ pointer: '/assignments/0/role-id' }] });
    expect(foreignEnvironment.statusCode).toBe(422);
    expect(foreignEnvironment.json()).toMatchObject({
      errors: [{ pointer: '/assignments/0/environment-ids' }],
    });
    expect(unknownUser.statusCode).toBe(404);
  });

  it('needs the granting user to hold each permission in each environment named (403)', async () => {
    const context = await setup();
    const { api, organization, sandboxId, productionId } = context;
    const users = await role(organization, ['users:read', 'users:write', 'roles:read']);
    const exporter = await role(organization, ['inquiries:export']);
    const actor = await signedInWith(context, [
      { role: users, environmentIds: null },
      { role: exporter, environmentIds: [sandboxId] },
    ]);
    const target = await api.operator(organization, { roles: [] });

    const inSandbox = await put(api, actor.token, target.user.id, [
      { 'role-id': exporter.id, 'environment-ids': [sandboxId] },
    ]);
    const inProduction = await put(api, actor.token, target.user.id, [
      { 'role-id': exporter.id, 'environment-ids': [productionId] },
    ]);
    const everywhere = await put(api, actor.token, target.user.id, [
      { 'role-id': exporter.id, 'environment-ids': null },
    ]);

    expect(inSandbox.statusCode, inSandbox.body).toBe(200);
    for (const refused of [inProduction, everywhere]) {
      expect(refused.statusCode, refused.body).toBe(403);
      expect(refused.json<{ detail: string }>().detail).toContain('inquiries:export');
    }
    expect(await stored(organization.id, target.user.id)).toEqual([
      { roleId: exporter.id, environmentIds: [sandboxId] },
    ]);
  });

  it('needs the granting user to hold, in each environment, what the user loses there (403)', async () => {
    const context = await setup();
    const { api, organization, sandboxId, productionId, token } = context;
    const users = await role(organization, ['users:read', 'users:write', 'roles:read']);
    const reader = await role(organization, ['inquiries:read']);
    const exporter = await role(organization, ['inquiries:export']);
    const actor = await signedInWith(context, [
      { role: users, environmentIds: null },
      { role: reader, environmentIds: null },
      { role: exporter, environmentIds: [sandboxId] },
    ]);
    const target = await api.operator(organization, { roles: [] });
    const replace = async (environmentIds: string[]) => {
      expectJson(
        await put(api, token, target.user.id, [
          { 'role-id': exporter.id, 'environment-ids': environmentIds },
        ]),
        200,
      );
      return put(api, actor.token, target.user.id, [
        { 'role-id': reader.id, 'environment-ids': null },
      ]);
    };

    const losesProduction = await replace([sandboxId, productionId]);
    const losesSandbox = await replace([sandboxId]);

    expect(losesProduction.statusCode, losesProduction.body).toBe(403);
    expect(losesProduction.json<{ detail: string }>().detail).toBe(
      `You cannot remove permissions you do not hold in environment ${productionId}: inquiries:export.`,
    );
    expect(losesSandbox.statusCode, losesSandbox.body).toBe(200);
    expect(await stored(organization.id, target.user.id)).toEqual([
      { roleId: reader.id, environmentIds: null },
    ]);
  });

  it('never takes the last organisation-wide admin away (409)', async () => {
    const { api, adminId, organization, sandboxId, token } = await setup();
    const reader = await role(organization, ['inquiries:read']);

    const response = await put(api, token, adminId, [
      { 'role-id': reader.id, 'environment-ids': [sandboxId] },
    ]);

    expect(response.statusCode, response.body).toBe(409);
    expect(await stored(organization.id, adminId)).toEqual([
      { roleId: organization.roleIds.admin, environmentIds: null },
    ]);
  });

  it('audits the change in every environment of the organisation, with ids only (C167.2)', async () => {
    const { api, organization, sandboxId, productionId, token } = await setup();
    const target = await api.operator(organization, { roles: ['viewer'] });
    const assignments = [
      { 'role-id': organization.roleIds.reviewer, 'environment-ids': [productionId] },
    ];

    expectJson(await put(api, token, target.user.id, assignments), 200);

    for (const environmentId of [sandboxId, productionId]) {
      const entries = await api.audit(environmentId, 'user.roles-assigned');
      expect(entries, environmentId).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        resourceType: 'user',
        resourceId: target.user.id,
        metadata: { assignments },
      });
    }
  });

  it('refuses a sandbox-only users:write, which grants nothing (C167.2 refusal test)', async () => {
    const context = await setup();
    const { api, organization, sandboxId } = context;
    const users = await role(organization, ['users:read', 'users:write', 'inquiries:read']);
    // Written past the API, which refuses such an assignment: it must still grant nothing.
    const actor = await signedInWith(context, [{ role: users, environmentIds: [sandboxId] }]);
    const target = await api.operator(organization, { roles: ['viewer'] });

    const response = await put(api, actor.token, target.user.id, [
      { 'role-id': organization.roleIds.viewer, 'environment-ids': [sandboxId] },
    ]);

    expect(response.statusCode, response.body).toBe(403);
  });
});

describe('role-ids and invitations mean every environment (C167.2; contracts B25)', () => {
  it('needs the permissions organisation-wide to PATCH role-ids or invite with them', async () => {
    const context = await setup();
    const { api, organization, sandboxId } = context;
    const users = await role(organization, ['users:read', 'users:write', 'roles:read']);
    const exporter = await role(organization, ['inquiries:export']);
    const actor = await signedInWith(context, [
      { role: users, environmentIds: null },
      { role: exporter, environmentIds: [sandboxId] },
    ]);
    const target = await api.operator(organization, { roles: [] });

    const patched = await api.call('PATCH', `/users/${target.user.id}`, {
      token: actor.token,
      payload: { data: { attributes: { 'role-ids': [exporter.id] } } },
    });
    const invited = await api.call('POST', '/users/invitations', {
      token: actor.token,
      payload: {
        email: `invited-${newId('usr').slice(-6).toLowerCase()}@example.test`,
        'role-ids': [exporter.id],
      },
    });

    for (const response of [patched, invited]) {
      expect(response.statusCode, response.body).toBe(403);
      expect(response.json<{ detail: string }>().detail).toContain('inquiries:export');
    }
  });
});

describe('editing a role where it is assigned (C167.2)', () => {
  it('needs each added or removed permission in every environment where the role is assigned', async () => {
    const context = await setup();
    const { api, organization, sandboxId, productionId, token } = context;
    const roles = await role(organization, ['roles:read', 'roles:write', 'users:read']);
    const exporter = await role(organization, ['inquiries:export', 'inquiries:read']);
    const actor = await signedInWith(context, [
      { role: roles, environmentIds: null },
      { role: exporter, environmentIds: [sandboxId] },
    ]);
    const edited = await role(organization, ['inquiries:read']);
    const holder = await api.operator(organization, { roles: [] });
    expectJson(
      await put(api, token, holder.user.id, [
        { 'role-id': edited.id, 'environment-ids': [productionId] },
      ]),
      200,
    );
    const change = (permissions: string[]) =>
      api.call('PATCH', `/roles/${edited.id}`, {
        token: actor.token,
        payload: { data: { attributes: { permissions } } },
      });

    const added = await change(['inquiries:read', 'inquiries:export']);
    expectJson(
      await put(api, token, holder.user.id, [
        { 'role-id': edited.id, 'environment-ids': [sandboxId] },
      ]),
      200,
    );
    const addedInSandbox = await change(['inquiries:read', 'inquiries:export']);

    expect(added.statusCode, added.body).toBe(403);
    expect(added.json<{ detail: string }>().detail).toContain('inquiries:export');
    expect(addedInSandbox.statusCode, addedInSandbox.body).toBe(200);
  });

  it('refuses an organisation-level permission in a role assigned narrower than every environment (422 role_scope_invalid)', async () => {
    const { api, organization, sandboxId, token } = await setup();
    const edited = await role(organization, ['inquiries:read']);
    const holder = await api.operator(organization, { roles: [] });
    expectJson(
      await put(api, token, holder.user.id, [
        { 'role-id': edited.id, 'environment-ids': [sandboxId] },
      ]),
      200,
    );

    const response = await api.call('PATCH', `/roles/${edited.id}`, {
      token,
      payload: { data: { attributes: { permissions: ['inquiries:read', 'users:write'] } } },
    });

    expect(response.statusCode, response.body).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'role_scope_invalid',
      errors: [{ pointer: '/data/attributes/permissions' }],
    });
  });

  it('refuses a sandbox-only roles:write, which grants nothing (C167.2 refusal test)', async () => {
    const context = await setup();
    const { api, organization, sandboxId, productionId, token } = context;
    const roles = await role(organization, [
      'roles:read',
      'roles:write',
      'inquiries:read',
      'cases:read',
    ]);
    const actor = await signedInWith(context, [{ role: roles, environmentIds: [sandboxId] }]);
    const edited = await role(organization, ['inquiries:read']);
    const holder = await api.operator(organization, { roles: [] });
    expectJson(
      await put(api, token, holder.user.id, [
        { 'role-id': edited.id, 'environment-ids': [productionId] },
      ]),
      200,
    );

    const response = await api.call('PATCH', `/roles/${edited.id}`, {
      token: actor.token,
      payload: { data: { attributes: { permissions: ['inquiries:read', 'cases:read'] } } },
    });

    expect(response.statusCode, response.body).toBe(403);
  });

  it('audits a role change in every environment of the organisation', async () => {
    const { api, sandboxId, productionId, token } = await setup();

    expectJson(
      await api.call('POST', '/roles', {
        token,
        payload: {
          data: {
            attributes: { name: `Synthetic ${newId('role')}`, permissions: ['inquiries:read'] },
          },
        },
      }),
      201,
    );

    for (const environmentId of [sandboxId, productionId]) {
      expect(await api.audit(environmentId, 'role.created'), environmentId).toHaveLength(1);
    }
  });
});

describe('GET /roles/grantable (C167.3)', () => {
  const scope = (document: GrantableDocument, environmentId: string | null) =>
    document.data.attributes.scopes.find((entry) => entry['environment-id'] === environmentId);
  const permission = (
    entry: ReturnType<typeof scope>,
    name: string,
  ): { grantable: boolean; reason: string | null } | undefined =>
    entry?.permissions.find((candidate) => candidate.permission === name);

  it('lists every environment, then organisation-wide, with each permission and role and why one is refused', async () => {
    const context = await setup();
    const { api, organization, sandboxId, productionId } = context;
    const users = await role(organization, ['users:read', 'roles:read']);
    const exporter = await role(organization, ['inquiries:export']);
    const actor = await signedInWith(context, [
      { role: users, environmentIds: null },
      { role: exporter, environmentIds: [sandboxId] },
    ]);

    const document = grantableDocumentSchema.parse(
      expectJson(await api.call('GET', '/roles/grantable', { token: actor.token }), 200),
    );

    expect(document.data.id).toBe(actor.user.id);
    expect(document.data.attributes.scopes.map((entry) => entry['environment-id'])).toEqual([
      sandboxId,
      productionId,
      null,
    ]);
    for (const entry of document.data.attributes.scopes) {
      expect(entry.permissions.map((candidate) => candidate.permission)).toEqual([...PERMISSIONS]);
    }
    expect(permission(scope(document, sandboxId), 'inquiries:export')).toEqual({
      permission: 'inquiries:export',
      grantable: true,
      reason: null,
    });
    expect(permission(scope(document, productionId), 'inquiries:export')).toMatchObject({
      grantable: false,
      reason: 'not-held',
    });
    expect(permission(scope(document, null), 'inquiries:export')).toMatchObject({
      grantable: false,
      reason: 'not-held',
    });
    expect(permission(scope(document, sandboxId), 'users:read')).toMatchObject({
      grantable: false,
      reason: 'organization-level',
    });
    expect(permission(scope(document, null), 'users:read')).toMatchObject({
      grantable: true,
      reason: null,
    });
    const roleIn = (environmentId: string | null, roleId: string) =>
      scope(document, environmentId)?.roles.find((entry) => entry['role-id'] === roleId);
    expect(roleIn(sandboxId, exporter.id)).toMatchObject({ grantable: true, reason: null });
    expect(roleIn(productionId, exporter.id)).toMatchObject({
      grantable: false,
      reason: 'not-held',
    });
    expect(roleIn(sandboxId, users.id)).toMatchObject({
      grantable: false,
      reason: 'organization-level',
    });
    expect(roleIn(null, users.id)).toMatchObject({ grantable: true, reason: null });
    expect(roleIn(sandboxId, organization.roleIds.admin)).toMatchObject({
      grantable: false,
      reason: 'admin-organization-wide',
    });
    expect(roleIn(null, organization.roleIds.admin)).toMatchObject({
      grantable: false,
      reason: 'not-held',
    });
  });

  it('needs roles:read', async () => {
    const context = await setup();
    const viewerless = await role(context.organization, ['inquiries:read']);
    const actor = await signedInWith(context, [{ role: viewerless, environmentIds: null }]);

    expect(
      (await context.api.call('GET', '/roles/grantable', { token: actor.token })).statusCode,
    ).toBe(403);
  });
});
