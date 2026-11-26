/**
 * C178.2 (Phase 9, Workflow 9B; C167.2, decisions 49 and 70): environment-scoped permission
 * resolution against Postgres 17 (Testcontainers):
 *
 * - the SQL predicate the Phase 8 resolutions read (`roleAssignmentReaches`) on real `text[]` rows;
 * - a session's permissions are those of the assignments reaching its environment, an
 *   organisation-level permission only organisation-wide;
 * - two concurrent assignment changes that would each remove one of the last two organisation-wide
 *   admins are serialized by the organisation lock, so one admin always stays.
 *
 * Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { newUserSessionToken } from '@openverify/contracts';
import {
  createDatabase,
  createEnvironment,
  createKeyring,
  createRole,
  createUser,
  createUserSession,
  hashSessionToken,
  listUserRoleAssignments,
  roleAssignmentReaches,
  runMigrations,
  setDefaultKeyring,
  setUserRoleAssignments,
  type Database,
} from '@openverify/db';
import {
  createIntegrationPool,
  createTestTenant,
  ifSet,
  startIntegrationPostgres,
  testId,
} from '@openverify/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findUserSessionContext } from '../../operator-auth/session-context.js';
import { createAuditLogger } from '../audit-log.js';
import { syncOrganizationRoles } from '../roles.js';
import { setUserRoleAssignmentsOf } from '../users.js';
import { fixedClock } from '../../test-support/fakes.js';
import { ulidIdGenerator } from '../../ports.js';

const keyring = createKeyring(randomBytes(32));

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 8 });
  db = createDatabase(pool);
  setDefaultKeyring(keyring);
  await runMigrations(db);
}, 180_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(pool)?.end();
  await container?.stop();
});

async function organizationWithProduction() {
  const { organization, environment: sandbox } = await createTestTenant(db);
  const production = await createEnvironment(db, {
    id: testId('env'),
    organizationId: organization.id,
    kind: 'production',
  });
  return { organization, sandbox, production };
}

const user = (organizationId: string) =>
  createUser(db, {
    id: testId('usr'),
    organizationId,
    email: `${testId('usr').toLowerCase()}@example.test`,
    passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$synthetic$synthetic',
  });

describe('environment-scoped permission resolution on Postgres (C167.2, C178.2)', () => {
  it('reaches an environment through null or a named id in SQL, never another', async () => {
    const { organization, sandbox, production } = await organizationWithProduction();
    const operator = await user(organization.id);
    const role = await createRole(db, organization.id, {
      id: testId('role'),
      name: `Synthetic ${testId('role')}`,
      permissions: ['cases:read'],
    });
    const reaches = async (environmentId: string) =>
      (
        await db.execute<{ reaches: boolean }>(
          sql`select exists (select 1 from user_roles ur where ur.user_id = ${operator.id}
                and ${roleAssignmentReaches(sql`ur`, environmentId)}) as reaches`,
        )
      ).rows[0]?.reaches;

    await setUserRoleAssignments(db, organization.id, operator.id, [
      { roleId: role.id, environmentIds: [production.id] },
    ]);
    const named = [await reaches(sandbox.id), await reaches(production.id)];
    await setUserRoleAssignments(db, organization.id, operator.id, [
      { roleId: role.id, environmentIds: null },
    ]);
    const wide = [await reaches(sandbox.id), await reaches(production.id)];

    expect(named).toEqual([false, true]);
    expect(wide).toEqual([true, true]);
  });

  it('gives a session the permissions of the assignments reaching its environment', async () => {
    const { organization, sandbox, production } = await organizationWithProduction();
    const operator = await user(organization.id);
    const narrow = await createRole(db, organization.id, {
      id: testId('role'),
      name: `Synthetic narrow ${testId('role')}`,
      permissions: ['inquiries:read', 'users:write', 'environments:production'],
    });
    await setUserRoleAssignments(db, organization.id, operator.id, [
      { roleId: narrow.id, environmentIds: [production.id] },
    ]);
    const session = async (environmentId: string) => {
      const token = newUserSessionToken();
      await createUserSession(db, {
        id: testId('uss'),
        organizationId: organization.id,
        userId: operator.id,
        environmentId,
        tokenHash: hashSessionToken(token),
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      return findUserSessionContext(db, token, new Date());
    };

    const inProduction = await session(production.id);
    const inSandbox = await session(sandbox.id);

    expect([...(inProduction?.permissions ?? [])].sort()).toEqual([
      'environments:production',
      'inquiries:read',
    ]);
    expect(inSandbox?.permissions.size).toBe(0);
  });

  it('serializes two demotions of the last two organisation-wide admins, keeping one', async () => {
    const { organization, sandbox } = await organizationWithProduction();
    const roles = await syncOrganizationRoles(db, organization.id, ulidIdGenerator);
    const admin = roles.find((role) => role.key === 'admin');
    const viewer = roles.find((role) => role.key === 'viewer');
    if (admin === undefined || viewer === undefined) throw new Error('no built-in roles');
    const [first, second] = [await user(organization.id), await user(organization.id)];
    for (const operator of [first, second]) {
      await setUserRoleAssignments(db, organization.id, operator.id, [
        { roleId: admin.id, environmentIds: null },
      ]);
    }
    const deps = { db, audit: createAuditLogger(), clock: fixedClock(), ids: ulidIdGenerator };
    const demote = (actor: string, target: string) =>
      setUserRoleAssignmentsOf(
        deps,
        {
          ctx: { organizationId: organization.id, environmentId: sandbox.id },
          actor: { type: 'user', id: actor },
          permissions: new Set(admin.permissions as never[]),
        },
        target,
        { assignments: [{ 'role-id': viewer.id, 'environment-ids': null }] },
      ).then(
        () => 'demoted',
        (error: unknown) => (error as { status?: number }).status,
      );

    const outcomes = await Promise.all([demote(first.id, second.id), demote(second.id, first.id)]);

    // One demotion wins; the other is refused, as the last admin (409) or, once its actor was
    // demoted, as a removal beyond its own permissions (403).
    expect(outcomes.filter((outcome) => outcome === 'demoted')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 403 || outcome === 409)).toHaveLength(1);
    const admins = await Promise.all(
      [first, second].map(async (operator) =>
        (await listUserRoleAssignments(db, organization.id, operator.id)).some(
          (assignment) => assignment.role.key === 'admin' && assignment.environmentIds === null,
        ),
      ),
    );
    expect(admins.filter(Boolean)).toHaveLength(1);
  });
});
