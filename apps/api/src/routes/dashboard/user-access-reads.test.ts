/**
 * K9-22 (Workflow 9D, DS8; C167.2, C167.3): the two reads the console's assignments dialog and the
 * `/users` page need.
 *
 * - `GET /users/:id/roles` (`users:read`) answers the user's assignments as `PUT` stored them: each a
 *   role and its environments, or `null` for every current and future one.
 * - `GET /users/:id/permissions` (`users:read`) answers what those assignments give: the
 *   organisation-level permissions (`users:*`, `roles:*`) once, organisation-wide, since they count
 *   only through an organisation-wide assignment (review P01); per environment the environment-level
 *   ones and whether the user may enter it (a role there and, in production,
 *   `environments:production` held there). The built-in admin in a narrower assignment gives nothing.
 *
 * Every value is synthetic.
 */
import { newId } from '@openverify/contracts';
import { PERMISSIONS, permissionLevel } from '@openverify/core';
import { createRole, setUserRoleAssignments, type Role } from '@openverify/db';
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

async function setup() {
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
  };
}

const role = (organization: TestOrganization, permissions: string[]): Promise<Role> =>
  createRole(database.db, organization.id, {
    id: newId('role'),
    name: `Synthetic ${newId('role')}`,
    permissions,
  });

/** A user, never signed in, holding exactly `assignments`. */
async function userWith(
  api: DashboardHarness,
  organization: TestOrganization,
  assignments: { roleId: string; environmentIds: string[] | null }[],
) {
  const user = await api.operator(organization, { roles: [] });
  await setUserRoleAssignments(database.db, organization.id, user.user.id, assignments);
  return user.user.id;
}

interface EffectivePermissions {
  data: {
    type: string;
    id: string;
    attributes: {
      organization: string[];
      environments: { 'environment-id': string; 'may-enter': boolean; permissions: string[] }[];
    };
  };
}

describe('GET /users/:id/roles (K9-22)', () => {
  it('answers the user’s assignments as stored, each role with its environments or null', async () => {
    const { api, organization, productionId, token } = await setup();
    const reader = await role(organization, ['inquiries:read']);
    const writer = await role(organization, ['inquiries:write', 'environments:production']);
    const userId = await userWith(api, organization, [
      { roleId: reader.id, environmentIds: null },
      { roleId: writer.id, environmentIds: [productionId] },
    ]);

    const document = expectJson<{
      data: { type: string; id: string; attributes: { assignments: unknown[] } };
    }>(await api.call('GET', `/users/${userId}/roles`, { token }), 200);

    expect(document.data.type).toBe('user-role-assignments');
    expect(document.data.id).toBe(userId);
    expect(document.data.attributes.assignments).toEqual(
      expect.arrayContaining([
        { 'role-id': reader.id, 'environment-ids': null },
        { 'role-id': writer.id, 'environment-ids': [productionId] },
      ]),
    );
    expect(document.data.attributes.assignments).toHaveLength(2);
  });

  it('needs users:read (403) and a session (401), and is 404 for another organization’s user', async () => {
    const { api, organization, token } = await setup();
    const other = await api.organization();
    const foreign = await api.operator(other, { roles: ['viewer'] });
    const developer = await api.operator(organization, { roles: ['developer'] });
    const developerToken = await api.signIn(developer.email);
    const viewer = await api.operator(organization, { roles: ['viewer'] });
    const viewerToken = await api.signIn(viewer.email);

    expect((await api.call('GET', `/users/${foreign.user.id}/roles`, { token })).statusCode).toBe(
      404,
    );
    expect(
      (await api.call('GET', `/users/${developer.user.id}/roles`, { token: developerToken }))
        .statusCode,
    ).toBe(403);
    expect(
      (await api.call('GET', `/users/${developer.user.id}/roles`, { token: viewerToken }))
        .statusCode,
    ).toBe(200);
    expect((await api.call('GET', `/users/${developer.user.id}/roles`)).statusCode).toBe(401);
  });
});

describe('GET /users/:id/permissions (K9-22)', () => {
  it('names the organisation-level permissions once and the environment-level ones per environment', async () => {
    const { api, organization, sandboxId, productionId, token } = await setup();
    const manager = await role(organization, ['users:read', 'inquiries:read']);
    const writer = await role(organization, ['inquiries:write', 'environments:production']);
    const userId = await userWith(api, organization, [
      { roleId: manager.id, environmentIds: null },
      { roleId: writer.id, environmentIds: [productionId] },
    ]);

    const document = expectJson<EffectivePermissions>(
      await api.call('GET', `/users/${userId}/permissions`, { token }),
      200,
    );

    expect(document.data).toEqual({
      type: 'user-effective-permissions',
      id: userId,
      attributes: {
        organization: ['users:read'],
        environments: expect.arrayContaining([
          { 'environment-id': sandboxId, 'may-enter': true, permissions: ['inquiries:read'] },
          {
            'environment-id': productionId,
            'may-enter': true,
            permissions: PERMISSIONS.filter((permission) =>
              ['inquiries:read', 'inquiries:write', 'environments:production'].includes(permission),
            ),
          },
        ]) as unknown,
      },
    });
    expect(document.data.attributes.environments).toHaveLength(2);
  });

  it('says a production environment cannot be entered without environments:production there, and a narrower admin gives nothing', async () => {
    const { api, organization, sandboxId, productionId, token } = await setup();
    const reader = await role(organization, ['inquiries:read']);
    const userId = await userWith(api, organization, [
      { roleId: reader.id, environmentIds: [productionId] },
      { roleId: organization.roleIds.admin, environmentIds: [sandboxId] },
    ]);

    const { attributes } = expectJson<EffectivePermissions>(
      await api.call('GET', `/users/${userId}/permissions`, { token }),
      200,
    ).data;

    expect(attributes.organization).toEqual([]);
    expect(attributes.environments).toEqual(
      expect.arrayContaining([
        { 'environment-id': sandboxId, 'may-enter': false, permissions: [] },
        { 'environment-id': productionId, 'may-enter': false, permissions: ['inquiries:read'] },
      ]),
    );
  });

  it('gives an organisation-wide admin every permission, each at its own level', async () => {
    const { api, organization, sandboxId, token } = await setup();
    const userId = await userWith(api, organization, [
      { roleId: organization.roleIds.admin, environmentIds: null },
    ]);

    const { attributes } = expectJson<EffectivePermissions>(
      await api.call('GET', `/users/${userId}/permissions`, { token }),
      200,
    ).data;

    expect(attributes.organization).toEqual(
      PERMISSIONS.filter((permission) => permissionLevel(permission) === 'organization'),
    );
    expect(attributes.environments.find((entry) => entry['environment-id'] === sandboxId)).toEqual({
      'environment-id': sandboxId,
      'may-enter': true,
      permissions: PERMISSIONS.filter(
        (permission) => permissionLevel(permission) === 'environment',
      ),
    });
  });

  it('needs users:read (403) and a session (401), and is 404 for another organization’s user', async () => {
    const { api, organization, token } = await setup();
    const other = await api.organization();
    const foreign = await api.operator(other, { roles: ['viewer'] });
    const developer = await api.operator(organization, { roles: ['developer'] });
    const developerToken = await api.signIn(developer.email);

    expect(
      (await api.call('GET', `/users/${foreign.user.id}/permissions`, { token })).statusCode,
    ).toBe(404);
    expect(
      (await api.call('GET', `/users/${developer.user.id}/permissions`, { token: developerToken }))
        .statusCode,
    ).toBe(403);
    expect((await api.call('GET', `/users/${developer.user.id}/permissions`)).statusCode).toBe(401);
  });
});
