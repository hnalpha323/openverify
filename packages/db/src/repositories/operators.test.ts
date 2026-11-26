/** C15 operators: users and invitations, roles, sessions, organization and environment settings. */
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { InvalidCursorError } from '../errors.js';
import {
  createdAtClock,
  createTestDatabase,
  createTestTenant,
  testId,
  type TestDatabase,
  wallClockStepsBack,
} from '../testing.js';
import { hashSessionToken } from '../tokens.js';
import {
  acceptInvitation,
  countActiveUsersWithRole,
  createEnvironment,
  createInvitedUser,
  createRole,
  createUser,
  createUserSession,
  deleteRole,
  findActiveUserSessionByTokenHash,
  findInvitedUserByTokenHash,
  getEnvironment,
  getOrganization,
  getRole,
  getRoles,
  listEnvironments,
  listRoles,
  listUserPermissions,
  listUserRoles,
  listUsers,
  listUsersByEmail,
  lockOrganization,
  markUserSessionMfaSatisfied,
  refreshInvitation,
  revokeUserSessionsForUser,
  setOrganizationRequireMfa,
  setUserRoles,
  setUserSessionEnvironment,
  syncBuiltinRoles,
  updateEnvironmentSettings,
  updateRole,
  updateUser,
} from './index.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

const ARGON2 = '$argon2id$v=19$m=19456,t=2,p=1$c3ludGhldGljc2FsdA$c3ludGhldGljaGFzaA';
const hash = (token: string) => hashSessionToken(token);

async function setup() {
  const { organization, environment } = await createTestTenant(database.db);
  const user = (email = `${testId('usr').toLowerCase()}@example.test`) =>
    createUser(database.db, {
      id: testId('usr'),
      organizationId: organization.id,
      email,
      passwordHash: ARGON2,
    });
  return { org: organization.id, env: environment.id, user };
}

const BUILTIN = [
  {
    key: 'admin',
    name: 'Admin',
    permissions: ['inquiries:read', 'inquiries:write', 'users:write'],
  },
  { key: 'viewer', name: 'Viewer', permissions: ['inquiries:read'] },
];

describe('roles (C15)', () => {
  it('syncs built-in roles idempotently, keeping their ids and updating permissions', async () => {
    const { org } = await setup();

    const first = await syncBuiltinRoles(database.db, org, BUILTIN, () => testId('role'));
    const second = await syncBuiltinRoles(
      database.db,
      org,
      [
        { key: 'admin', name: 'Admin', permissions: ['inquiries:read'] },
        { key: 'viewer', name: 'Viewer', permissions: ['inquiries:read'] },
      ],
      () => testId('role'),
    );

    expect(first.map((role) => [role.key, role.builtin])).toEqual([
      ['admin', true],
      ['viewer', true],
    ]);
    expect(second.map((role) => role.id)).toEqual(first.map((role) => role.id));
    expect(second[0]?.permissions).toEqual(['inquiries:read']);
  });

  it('creates, renames and deletes custom roles, but never built-in ones or roles in use', async () => {
    const { org, user } = await setup();
    const [admin] = await syncBuiltinRoles(database.db, org, BUILTIN, () => testId('role'));
    const custom = await createRole(database.db, org, {
      id: testId('role'),
      name: 'Auditor',
      permissions: ['events:read'],
    });
    const holder = await user();
    await setUserRoles(database.db, org, holder.id, [custom.id]);

    const renamed = await updateRole(database.db, org, custom.id, {
      name: 'Auditors',
      permissions: ['events:read', 'api-logs:read'],
    });
    const same = await updateRole(database.db, org, custom.id, {});

    expect(renamed).toMatchObject({
      name: 'Auditors',
      permissions: ['events:read', 'api-logs:read'],
      builtin: false,
      key: null,
    });
    expect(same).toEqual(renamed);
    expect(await updateRole(database.db, org, admin?.id ?? '', { name: 'Root' })).toBeNull();
    expect(await deleteRole(database.db, org, custom.id)).toBe('in_use');
    expect(await deleteRole(database.db, org, admin?.id ?? '')).toBe('builtin');
    await setUserRoles(database.db, org, holder.id, []);
    expect(await deleteRole(database.db, org, custom.id)).toBe('deleted');
    expect(await deleteRole(database.db, org, custom.id)).toBe('not_found');
    expect(await getRole(database.db, org, custom.id)).toBeNull();
  });

  it('lists roles, assigns several, and unions their permissions', async () => {
    onTestFinished(wallClockStepsBack());
    const { org, user } = await setup();
    const roles = await syncBuiltinRoles(database.db, org, BUILTIN, () => testId('role'));
    const custom = await createRole(database.db, org, {
      id: testId('role'),
      name: 'Logs',
      permissions: ['api-logs:read', 'inquiries:read'],
    });
    await createdAtClock(database.db).at('roles', custom.id);
    const member = await user();

    await setUserRoles(database.db, org, member.id, [roles[1]?.id ?? '', custom.id]);

    // Built-in roles are synced in one transaction: same created_at, so their order is by id.
    const names = (await listRoles(database.db, org, {})).items.map((role) => role.name);
    expect(names[0]).toBe('Logs');
    expect(names.slice(1).sort()).toEqual(['Admin', 'Viewer']);
    expect(
      (await listUserRoles(database.db, org, member.id)).map((role) => role.name).sort(),
    ).toEqual(['Logs', 'Viewer']);
    expect((await listUserPermissions(database.db, org, member.id)).sort()).toEqual([
      'api-logs:read',
      'inquiries:read',
    ]);
    expect(
      (await getRoles(database.db, org, [custom.id, testId('role')])).map((r) => r.id),
    ).toEqual([custom.id]);
    expect(await getRoles(database.db, org, [])).toEqual([]);
    expect(
      await getRole(database.db, (await createTestTenant(database.db)).organization.id, custom.id),
    ).toBeNull();
    await expect(listRoles(database.db, org, { after: testId('role') })).rejects.toThrow(
      InvalidCursorError,
    );
  });

  it('counts the active holders of a built-in role, for the last-admin rule', async () => {
    const { org, user } = await setup();
    const [admin] = await syncBuiltinRoles(database.db, org, BUILTIN, () => testId('role'));
    const first = await user();
    const second = await user();
    await setUserRoles(database.db, org, first.id, [admin?.id ?? '']);
    await setUserRoles(database.db, org, second.id, [admin?.id ?? '']);

    await database.db.transaction(async (tx) => {
      await lockOrganization(tx, org);
      expect(await countActiveUsersWithRole(tx, org, 'admin')).toBe(2);
      expect(await countActiveUsersWithRole(tx, org, 'admin', { excludingUserId: first.id })).toBe(
        1,
      );
    });
    await updateUser(database.db, org, second.id, { status: 'deactivated' });
    expect(await countActiveUsersWithRole(database.db, org, 'admin')).toBe(1);
    expect(await lockOrganization(database.db, testId('org'))).toBe(false);
  });
});

describe('users and invitations (C15)', () => {
  it('invites a user, who accepts once with a password and a name', async () => {
    const { org, user } = await setup();
    const inviter = await user();
    const token = `ovi_${testId('usr')}`;

    const invited = await createInvitedUser(database.db, {
      id: testId('usr'),
      organizationId: org,
      email: 'New.Person@Example.TEST',
      invitationTokenHash: hash(token),
      invitationExpiresAt: new Date(Date.now() + 3_600_000),
      invitedBy: inviter.id,
    });
    const found = await findInvitedUserByTokenHash(database.db, hash(token));
    const accepted = await acceptInvitation(database.db, {
      tokenHash: hash(token),
      passwordHash: ARGON2,
      name: 'New Person',
    });
    const twice = await acceptInvitation(database.db, {
      tokenHash: hash(token),
      passwordHash: ARGON2,
      name: 'x',
    });

    expect(invited).toMatchObject({
      status: 'invited',
      passwordHash: null,
      email: 'new.person@example.test',
      invitedBy: inviter.id,
    });
    expect(found?.id).toBe(invited.id);
    expect(accepted).toMatchObject({
      status: 'active',
      name: 'New Person',
      passwordHash: ARGON2,
      invitationTokenHash: null,
      invitationExpiresAt: null,
    });
    expect(twice).toBeNull();
    expect(
      (await listUsersByEmail(database.db, 'new.person@example.test')).map((u) => u.id),
    ).toEqual([invited.id]);
  });

  it('refuses an expired invitation until it is refreshed', async () => {
    const { org } = await setup();
    const old = hash(`ovi_${testId('usr')}`);
    const fresh = hash(`ovi_${testId('usr')}`);
    const invited = await createInvitedUser(database.db, {
      id: testId('usr'),
      organizationId: org,
      email: `${testId('usr').toLowerCase()}@example.test`,
      invitationTokenHash: old,
      invitationExpiresAt: new Date(Date.now() - 1000),
    });

    expect(await findInvitedUserByTokenHash(database.db, old)).toBeNull();
    expect(
      await acceptInvitation(database.db, { tokenHash: old, passwordHash: ARGON2, name: 'x' }),
    ).toBeNull();
    const refreshed = await refreshInvitation(database.db, org, invited.id, {
      invitationTokenHash: fresh,
      invitationExpiresAt: new Date(Date.now() + 3_600_000),
    });
    expect(refreshed?.invitationTokenHash).toBe(fresh);
    expect(
      (await acceptInvitation(database.db, { tokenHash: fresh, passwordHash: ARGON2, name: 'y' }))
        ?.status,
    ).toBe('active');
    expect(
      await refreshInvitation(database.db, org, invited.id, {
        invitationTokenHash: old,
        invitationExpiresAt: new Date(),
      }),
    ).toBeNull();
  });

  it('lists users with a status filter, and keeps deactivated users from logging in', async () => {
    onTestFinished(wallClockStepsBack());
    const { org, env, user } = await setup();
    const clock = createdAtClock(database.db);
    const active = await clock.stamp('users', await user('active.one@example.test'));
    const leaving = await clock.stamp('users', await user('leaving@example.test'));
    const tokenHash = hash(`ovu_${testId('uss')}`);
    await createUserSession(database.db, {
      id: testId('uss'),
      organizationId: org,
      userId: leaving.id,
      environmentId: env,
      tokenHash,
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    const deactivated = await updateUser(database.db, org, leaving.id, {
      status: 'deactivated',
      name: 'Leaving',
    });
    const revoked = await revokeUserSessionsForUser(database.db, org, leaving.id);

    expect(deactivated).toMatchObject({ status: 'deactivated', name: 'Leaving' });
    expect(revoked).toBe(1);
    expect(await findActiveUserSessionByTokenHash(database.db, tokenHash)).toBeNull();
    expect(await listUsersByEmail(database.db, 'leaving@example.test')).toEqual([]);
    expect((await listUsers(database.db, org, {})).items.map((u) => u.id)).toEqual([
      leaving.id,
      active.id,
    ]);
    expect(
      (await listUsers(database.db, org, { status: 'active' })).items.map((u) => u.id),
    ).toEqual([active.id]);
    expect((await listUsers(database.db, org, { status: [] })).items).toEqual([]);
    expect(await updateUser(database.db, testId('org'), active.id, { name: 'x' })).toBeNull();
    expect(await updateUser(database.db, org, active.id, {})).toEqual(active);
  });
});

describe('user sessions (C15)', () => {
  it('switches the environment within the organization and records MFA', async () => {
    const { org, env, user } = await setup();
    const operator = await user();
    const production = await createEnvironment(database.db, {
      id: testId('env'),
      organizationId: org,
      kind: 'production',
    });
    const tokenHash = hash(`ovu_${testId('uss')}`);
    const session = await createUserSession(database.db, {
      id: testId('uss'),
      organizationId: org,
      userId: operator.id,
      environmentId: env,
      tokenHash,
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    const switched = await setUserSessionEnvironment(database.db, session.id, production.id);
    const satisfied = await markUserSessionMfaSatisfied(database.db, session.id);

    expect(session.mfaSatisfied).toBe(false);
    expect(switched?.environmentId).toBe(production.id);
    expect(satisfied?.mfaSatisfied).toBe(true);
    expect(await setUserSessionEnvironment(database.db, testId('uss'), production.id)).toBeNull();
    const foreign = (await createTestTenant(database.db)).environment.id;
    await expect(setUserSessionEnvironment(database.db, session.id, foreign)).rejects.toThrow();
  });
});

describe('organization and environment settings (C15, C16)', () => {
  it('sets require-mfa and merges environment retention settings', async () => {
    const { org, env } = await setup();

    const organization = await setOrganizationRequireMfa(database.db, org, true);
    const first = await updateEnvironmentSettings(database.db, env, {
      'api-log-retention-days': 7,
    });
    const second = await updateEnvironmentSettings(database.db, env, {
      'inquiry-retention-days': null,
    });

    expect(organization?.requireMfa).toBe(true);
    expect((await getOrganization(database.db, org))?.requireMfa).toBe(true);
    expect(first?.settings).toEqual({ 'api-log-retention-days': 7 });
    expect(second?.settings).toEqual({
      'api-log-retention-days': 7,
      'inquiry-retention-days': null,
    });
    expect((await getEnvironment(database.db, env))?.settings).toEqual(second?.settings);
    expect((await listEnvironments(database.db, org)).map((environment) => environment.id)).toEqual(
      [env],
    );
    expect(await setOrganizationRequireMfa(database.db, testId('org'), true)).toBeNull();
    expect(await updateEnvironmentSettings(database.db, testId('env'), {})).toBeNull();
  });
});
