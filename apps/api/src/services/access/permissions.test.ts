/**
 * C167.2 (Phase 9, Workflow 9B; decisions 49 and 70, reviews P01 and F29): what a user may do in one
 * environment, now that roles are assigned per environment.
 *
 * - An assignment reaches an environment when its `environment-ids` is `null` (every current and
 *   future environment) or names it.
 * - An organisation-level permission (`PERMISSION_LEVEL`: `users:*`, `roles:*`) counts only through
 *   an organisation-wide assignment, and the built-in `admin` grants nothing through a narrower one.
 * - A user's permissions in another environment (a promote's target) come from its stored
 *   assignments; an API key holds at most what its minter holds in the key's environment.
 *
 * Every value is synthetic.
 */
import { PERMISSIONS, type Permission } from '@openverify/core';
import {
  createEnvironment,
  createRole,
  createUser,
  setUserRoleAssignments,
  type Db,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiKeyPrincipal, UserPrincipal } from '../../ports.js';
import {
  assignmentReaches,
  environmentsEntered,
  mintablePermissions,
  permissionsForEnvironment,
  userPermissionsInEnvironment,
} from './permissions.js';

const SANDBOX = 'env_01M5CN00000000000000009B10';
const PRODUCTION = 'env_01M5CN00000000000000009B11';

const role = (...permissions: string[]) => ({ permissions });
const sorted = (set: ReadonlySet<Permission>) => [...set].sort();

describe('assignmentReaches (C167.2)', () => {
  it('reaches every environment when null, and only the named ones otherwise', () => {
    expect(assignmentReaches({ role: role(), environmentIds: null }, SANDBOX)).toBe(true);
    expect(assignmentReaches({ role: role(), environmentIds: [SANDBOX] }, SANDBOX)).toBe(true);
    expect(assignmentReaches({ role: role(), environmentIds: [SANDBOX] }, PRODUCTION)).toBe(false);
  });
});

describe('permissionsForEnvironment (C167.2)', () => {
  it('is the union of the roles assigned for the environment, null reaching every one', () => {
    const assignments = [
      { role: role('inquiries:read'), environmentIds: null },
      { role: role('cases:read'), environmentIds: [SANDBOX] },
      { role: role('environments:production', 'cases:write'), environmentIds: [PRODUCTION] },
    ];

    expect(sorted(permissionsForEnvironment(assignments, SANDBOX))).toEqual([
      'cases:read',
      'inquiries:read',
    ]);
    expect(sorted(permissionsForEnvironment(assignments, PRODUCTION))).toEqual([
      'cases:write',
      'environments:production',
      'inquiries:read',
    ]);
  });

  it('counts an organisation-level permission only through an organisation-wide assignment (P01)', () => {
    const narrow = [
      {
        role: role('users:read', 'users:write', 'roles:write', 'settings:write'),
        environmentIds: [SANDBOX],
      },
    ];
    const wide = [{ role: role('users:write', 'roles:read'), environmentIds: null }];

    expect(sorted(permissionsForEnvironment(narrow, SANDBOX))).toEqual(['settings:write']);
    expect(sorted(permissionsForEnvironment(wide, SANDBOX))).toEqual(['roles:read', 'users:write']);
  });

  it('grants nothing through the built-in admin role assigned narrower than every environment', () => {
    const admin = { key: 'admin', builtin: true, permissions: [...PERMISSIONS] };

    expect(
      permissionsForEnvironment([{ role: admin, environmentIds: [SANDBOX] }], SANDBOX).size,
    ).toBe(0);
    expect(permissionsForEnvironment([{ role: admin, environmentIds: null }], SANDBOX).size).toBe(
      PERMISSIONS.length,
    );
  });

  it('ignores a stored value that is not a permission', () => {
    expect(
      sorted(
        permissionsForEnvironment(
          [{ role: role('inquiries:read', 'not-a-permission'), environmentIds: null }],
          SANDBOX,
        ),
      ),
    ).toEqual(['inquiries:read']);
  });
});

describe('environmentsEntered (C167.2: entering an environment needs a role there)', () => {
  const environments = [
    { id: SANDBOX, kind: 'sandbox' as const },
    { id: PRODUCTION, kind: 'production' as const },
  ];

  it('lists the environments with a role, production only with environments:production there', () => {
    expect(
      environmentsEntered(
        [
          { role: role('inquiries:read'), environmentIds: [SANDBOX] },
          { role: role('inquiries:read'), environmentIds: [PRODUCTION] },
        ],
        environments,
      ).map(({ id }) => id),
    ).toEqual([SANDBOX]);
    expect(
      environmentsEntered(
        [{ role: role('inquiries:read', 'environments:production'), environmentIds: [PRODUCTION] }],
        environments,
      ).map(({ id }) => id),
    ).toEqual([PRODUCTION]);
    expect(environmentsEntered([], environments)).toEqual([]);
  });

  it('counts an organisation-wide role whatever it grants, as it reaches every environment', () => {
    expect(
      environmentsEntered([{ role: role('users:read'), environmentIds: null }], environments).map(
        ({ id }) => id,
      ),
    ).toEqual([SANDBOX]);
  });

  it('does not count a narrower role whose only permissions are organisation-level as a role there', () => {
    expect(
      environmentsEntered([{ role: role('users:read'), environmentIds: [SANDBOX] }], environments),
    ).toEqual([]);
  });
});

describe('mintablePermissions (C167.2: a key holds at most what its minter holds there)', () => {
  it('is a user session’s permissions, which are already its environment’s, and a key’s own', () => {
    const user: UserPrincipal = {
      kind: 'user',
      userId: testId('usr'),
      userSessionId: testId('uss'),
      organizationId: testId('org'),
      environmentId: SANDBOX,
      environmentKind: 'sandbox',
      permissions: new Set<Permission>(['inquiries:read']),
      mfaSatisfied: true,
    };
    const key = {
      kind: 'api-key',
      permissions: new Set<Permission>(['inquiries:write']),
    } as unknown as ApiKeyPrincipal;

    expect(sorted(mintablePermissions(user))).toEqual(['inquiries:read']);
    expect(sorted(mintablePermissions(key))).toEqual(['inquiries:write']);
  });
});

describe('userPermissionsInEnvironment (C167.2: a promote’s target)', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  afterAll(async () => {
    await database.close();
  });

  async function userWith(db: Db) {
    const { organization, environment } = await createTestTenant(db);
    const production = await createEnvironment(db, {
      id: testId('env'),
      organizationId: organization.id,
      kind: 'production',
    });
    const user = await createUser(db, {
      id: testId('usr'),
      organizationId: organization.id,
      email: `${testId('usr').toLowerCase()}@example.test`,
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$synthetic$synthetic',
    });
    const sandboxRole = await createRole(db, organization.id, {
      id: testId('role'),
      name: `Synthetic sandbox ${testId('role')}`,
      permissions: ['workflows:write', 'environments:production'],
    });
    const everywhere = await createRole(db, organization.id, {
      id: testId('role'),
      name: `Synthetic everywhere ${testId('role')}`,
      permissions: ['inquiries:read'],
    });
    await setUserRoleAssignments(db, organization.id, user.id, [
      { roleId: sandboxRole.id, environmentIds: [environment.id] },
      { roleId: everywhere.id, environmentIds: null },
    ]);
    const principal: UserPrincipal = {
      kind: 'user',
      userId: user.id,
      userSessionId: testId('uss'),
      organizationId: organization.id,
      environmentId: environment.id,
      environmentKind: 'sandbox',
      permissions: new Set<Permission>([
        'workflows:write',
        'environments:production',
        'inquiries:read',
      ]),
      mfaSatisfied: true,
    };
    return { principal, sandbox: environment, production };
  }

  it('reads the user’s stored assignments for the other environment, not the session’s permissions', async () => {
    const { principal, production, sandbox } = await userWith(database.db);

    expect(
      sorted(await userPermissionsInEnvironment(database.db, principal, production.id)),
    ).toEqual(['inquiries:read']);
    expect(sorted(await userPermissionsInEnvironment(database.db, principal, sandbox.id))).toEqual([
      'environments:production',
      'inquiries:read',
      'workflows:write',
    ]);
  });

  it('answers nothing for an environment of another organisation', async () => {
    const { principal } = await userWith(database.db);
    const elsewhere = await createTestTenant(database.db);

    expect(
      (await userPermissionsInEnvironment(database.db, principal, elsewhere.environment.id)).size,
    ).toBe(0);
  });
});
