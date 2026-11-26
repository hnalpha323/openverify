/**
 * C167.2 (Phase 9, Workflow 9B; `api-access`): role assignments per environment in the roles
 * repository: replacing a user's assignments with their environments, and the last-admin count,
 * which reads organisation-wide admin assignments only (the built-in `admin` is assignable
 * organisation-wide only, decision 49).
 *
 * Every value is synthetic.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEnvironment } from './repositories/organizations.js';
import {
  countActiveUsersWithRole,
  createRole,
  listUserRoleAssignments,
  setUserRoleAssignments,
  syncBuiltinRoles,
} from './repositories/roles.js';
import { createUser } from './repositories/users.js';
import { createTestDatabase, createTestTenant, testId, type TestDatabase } from './testing.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

async function tenant() {
  const { organization, environment } = await createTestTenant(database.db);
  const production = await createEnvironment(database.db, {
    id: testId('env'),
    organizationId: organization.id,
    kind: 'production',
  });
  const [admin] = await syncBuiltinRoles(
    database.db,
    organization.id,
    [{ key: 'admin', name: 'Admin', permissions: ['users:write'] }],
    () => testId('role'),
  );
  const custom = await createRole(database.db, organization.id, {
    id: testId('role'),
    name: `Synthetic ${testId('role')}`,
    permissions: ['inquiries:read'],
  });
  const user = await createUser(database.db, {
    id: testId('usr'),
    organizationId: organization.id,
    email: `${testId('usr').toLowerCase()}@example.test`,
    passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$synthetic$synthetic',
  });
  if (admin === undefined) throw new Error('no admin role');
  return { organization, sandbox: environment, production, admin, custom, user };
}

describe('setUserRoleAssignments (C167.2, C167.3)', () => {
  it('replaces every assignment with its environments, null meaning every environment', async () => {
    const { organization, sandbox, production, admin, custom, user } = await tenant();
    const read = async () =>
      (await listUserRoleAssignments(database.db, organization.id, user.id))
        .map((assignment) => ({
          roleId: assignment.role.id,
          environmentIds: assignment.environmentIds,
        }))
        .sort((a, b) => a.roleId.localeCompare(b.roleId));

    await setUserRoleAssignments(database.db, organization.id, user.id, [
      { roleId: admin.id, environmentIds: null },
      { roleId: custom.id, environmentIds: [sandbox.id, production.id] },
    ]);
    const first = await read();
    await setUserRoleAssignments(database.db, organization.id, user.id, [
      { roleId: custom.id, environmentIds: [production.id] },
    ]);

    expect(first).toEqual(
      [
        { roleId: admin.id, environmentIds: null },
        { roleId: custom.id, environmentIds: [sandbox.id, production.id] },
      ].sort((a, b) => a.roleId.localeCompare(b.roleId)),
    );
    expect(await read()).toEqual([{ roleId: custom.id, environmentIds: [production.id] }]);
  });
});

describe('countActiveUsersWithRole (the last admin, C15 and C167.2)', () => {
  it('counts organisation-wide assignments only, as admin grants nothing narrower', async () => {
    const { organization, sandbox, admin, user } = await tenant();

    await setUserRoleAssignments(database.db, organization.id, user.id, [
      { roleId: admin.id, environmentIds: null },
    ]);
    const wide = await countActiveUsersWithRole(database.db, organization.id, 'admin');
    await setUserRoleAssignments(database.db, organization.id, user.id, [
      { roleId: admin.id, environmentIds: [sandbox.id] },
    ]);
    const narrow = await countActiveUsersWithRole(database.db, organization.id, 'admin');

    expect([wide, narrow]).toEqual([1, 0]);
  });
});
