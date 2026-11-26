/**
 * Workflow 9B Stage 1b, checkpoint (U): what `foundation-9b` builds in the database for access
 * (C167.2, C168.1, C168.2, C168.6), frozen for `api-access`:
 *
 * - `user_roles.environment_ids`: `NULL` (every current and future environment, the value every
 *   existing assignment keeps) or 1 to 20 `env_` ids;
 * - `user_sessions.mfa_verified_at`, `NULL` until a factor is checked on the session;
 * - `organizations.require_mfa` defaults to `true` for an organisation created from now on, and
 *   `createOrganization` takes the value explicitly; the test tenant keeps `false`, as every suite
 *   that signs an operator in relied on;
 * - `audit_log_ip_index (audit_log_id, environment_id, ip_hmac)`, deleted with its audit row and its
 *   environment, while `audit_logs` stays append-only outside the KEK rewrap (review P23);
 * - the assignments read with their environments, and the stub predicate `api-access` builds.
 *
 * Every value is synthetic; addresses are from the documentation ranges.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IDENTIFIER_KEY_LABELS } from './blind-index.js';
import { appendAuditLog } from './repositories/audit-logs.js';
import { createOrganization } from './repositories/organizations.js';
import {
  createRole,
  listUserRoleAssignments,
  roleAssignmentReaches,
  setUserRoles,
} from './repositories/roles.js';
import { createUser, createUserSession } from './repositories/users.js';
import { createTestDatabase, createTestTenant, testId, type TestDatabase } from './testing.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

const query = <Row extends object>(text: string, params: unknown[] = []) =>
  database.client.query<Row>(text, params);

const refused = async (text: string, params: unknown[] = []) =>
  query(text, params).then(
    () => 'accepted',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

const HEX = 'a'.repeat(64);

async function columnsOf(table: string) {
  const { rows } = await query<{ column_name: string; data_type: string; is_nullable: string }>(
    `select column_name, data_type, is_nullable from information_schema.columns
      where table_name = $1 order by column_name`,
    [table],
  );
  return rows;
}

async function assignment() {
  const { organization, environment } = await createTestTenant(database.db);
  const user = await createUser(database.db, {
    id: testId('usr'),
    organizationId: organization.id,
    email: `${testId('usr').toLowerCase()}@example.test`,
    passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$synthetic$synthetic',
  });
  const role = await createRole(database.db, organization.id, {
    id: testId('role'),
    name: `Synthetic ${testId('role')}`,
    permissions: ['inquiries:read'],
  });
  await setUserRoles(database.db, organization.id, user.id, [role.id]);
  return { organization, environment, user, role };
}

describe('user_roles.environment_ids (C167.2, decision 49)', () => {
  it('is a nullable text array, NULL for an assignment that names none', async () => {
    const { user } = await assignment();

    expect(
      (await columnsOf('user_roles')).find((column) => column.column_name === 'environment_ids'),
    ).toEqual({ column_name: 'environment_ids', data_type: 'ARRAY', is_nullable: 'YES' });
    const { rows } = await query<{ environment_ids: string[] | null }>(
      'select environment_ids from user_roles where user_id = $1',
      [user.id],
    );
    expect(rows).toEqual([{ environment_ids: null }]);
  });

  it('holds 1 to 20 env_ ids, never an empty list, a null element or another prefix', async () => {
    const { user, environment } = await assignment();
    const set = (ids: string) =>
      refused(`update user_roles set environment_ids = ${ids} where user_id = $1`, [user.id]);
    const twenty = Array.from({ length: 20 }, () => `'${testId('env')}'`).join(', ');
    const twentyOne = `${twenty}, '${testId('env')}'`;

    expect(await set(`array['${environment.id}']`)).toBe('accepted');
    expect(await set(`array[${twenty}]`)).toBe('accepted');
    expect(await set('null')).toBe('accepted');
    expect(await set(`'{}'::text[]`)).toContain('user_roles_environment_ids_valid');
    expect(await set(`array[${twentyOne}]`)).toContain('user_roles_environment_ids_valid');
    expect(await set(`array['${environment.id}', null]`)).toContain(
      'user_roles_environment_ids_valid',
    );
    expect(await set(`array['${testId('org')}']`)).toContain('user_roles_environment_ids_valid');
    expect(await set(`array['env_synthetic']`)).toContain('user_roles_environment_ids_valid');
  });

  it('is read with each assignment, NULL meaning every environment', async () => {
    const { organization, environment, user, role } = await assignment();

    const read = async () =>
      (await listUserRoleAssignments(database.db, organization.id, user.id)).map((assignment) => ({
        roleId: assignment.role.id,
        environmentIds: assignment.environmentIds,
      }));
    expect(await read()).toEqual([{ roleId: role.id, environmentIds: null }]);
    await query('update user_roles set environment_ids = array[$2] where user_id = $1', [
      user.id,
      environment.id,
    ]);
    expect(await read()).toEqual([{ roleId: role.id, environmentIds: [environment.id] }]);
  });

  it('reaches an environment through an organisation-wide assignment or one that names it, never another (C167.2, built by api-access)', async () => {
    const { organization, environment, user } = await assignment();
    const other = testId('env');
    const reaches = async (environmentId: string) => {
      const rows = await database.db.execute<{ reaches: boolean }>(
        sql`select exists (select 1 from user_roles ur
              where ur.organization_id = ${organization.id} and ur.user_id = ${user.id}
                and ${roleAssignmentReaches(sql`ur`, environmentId)}) as reaches`,
      );
      return rows.rows[0]?.reaches;
    };
    const set = (ids: string[]) =>
      query('update user_roles set environment_ids = $2 where user_id = $1', [user.id, ids]);

    expect([await reaches(environment.id), await reaches(other)]).toEqual([true, true]);
    await set([environment.id]);
    expect([await reaches(environment.id), await reaches(other)]).toEqual([true, false]);
    await set([other]);
    expect([await reaches(environment.id), await reaches(other)]).toEqual([false, true]);
  });
});

describe('user_sessions.mfa_verified_at (C168.1)', () => {
  it('is a nullable timestamptz, NULL on a new session', async () => {
    const { organization, environment, user } = await assignment();
    const session = await createUserSession(database.db, {
      id: testId('uss'),
      organizationId: organization.id,
      userId: user.id,
      environmentId: environment.id,
      tokenHash: HEX,
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    expect(
      (await columnsOf('user_sessions')).find((column) => column.column_name === 'mfa_verified_at'),
    ).toEqual({
      column_name: 'mfa_verified_at',
      data_type: 'timestamp with time zone',
      is_nullable: 'YES',
    });
    expect(session.mfaVerifiedAt).toBeNull();
  });
});

describe('organizations.require_mfa defaults to true (C168.2, decision 45)', () => {
  it('starts an organisation created from now on with require-mfa', async () => {
    const id = testId('org');
    await query(`insert into organizations (id, name) values ($1, 'Example Synthetic Org')`, [id]);

    const { rows } = await query<{ require_mfa: boolean }>(
      'select require_mfa from organizations where id = $1',
      [id],
    );
    expect(rows).toEqual([{ require_mfa: true }]);
    expect(
      (await createOrganization(database.db, { id: testId('org'), name: 'Example Org' }))
        .requireMfa,
    ).toBe(true);
  });

  it('takes the value explicitly, and the test tenant keeps the old false', async () => {
    const off = await createOrganization(database.db, {
      id: testId('org'),
      name: 'Example Org',
      requireMfa: false,
    });
    const { organization } = await createTestTenant(database.db);
    const { organization: enforced } = await createTestTenant(database.db, { requireMfa: true });

    expect(off.requireMfa).toBe(false);
    expect(organization.requireMfa).toBe(false);
    expect(enforced.requireMfa).toBe(true);
  });
});

describe('audit_log_ip_index (C168.6, review P23)', () => {
  async function entry() {
    const { environment } = await createTestTenant(database.db);
    const audit = await appendAuditLog(database.db, environment.id, {
      actorType: 'system',
      action: 'inquiry.approved',
      ip: '198.51.100.7',
    });
    return { environment, id: audit.id };
  }

  it('has exactly the audit entry, its environment and the HMAC, keyed by the entry', async () => {
    expect((await columnsOf('audit_log_ip_index')).map((column) => column.column_name)).toEqual([
      'audit_log_id',
      'environment_id',
      'ip_hmac',
    ]);
    const { rows } = await query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes where tablename = 'audit_log_ip_index'
        order by indexname`,
    );
    expect(rows.map((row) => row.indexname)).toEqual([
      'audit_log_ip_index_lookup_idx',
      'audit_log_ip_index_pkey',
    ]);
    expect(rows[0]?.indexdef).toContain('(environment_id, ip_hmac, audit_log_id)');
  });

  it('holds one 64-hex HMAC per audit entry', async () => {
    const { environment, id } = await entry();
    const insert =
      'insert into audit_log_ip_index (audit_log_id, environment_id, ip_hmac) values ($1, $2, $3)';

    expect(await refused(insert, [id, environment.id, 'not-hex'])).toContain(
      'audit_log_ip_index_ip_hmac_hex',
    );
    expect(await refused(insert, [id, environment.id, HEX])).toBe('accepted');
    expect(await refused(insert, [id, environment.id, HEX])).toContain('audit_log_ip_index_pkey');
    expect(await refused(insert, [id + 1_000_000, environment.id, HEX])).toContain(
      'audit_log_ip_index_audit_log_fk',
    );
  });

  it('is deleted with its audit row, as the retention pass deletes one', async () => {
    const { environment, id } = await entry();
    await query(
      'insert into audit_log_ip_index (audit_log_id, environment_id, ip_hmac) values ($1, $2, $3)',
      [id, environment.id, HEX],
    );

    await query('delete from audit_logs where id = $1', [id]);

    const { rows } = await query<{ count: number }>(
      'select count(*)::int as count from audit_log_ip_index where audit_log_id = $1',
      [id],
    );
    expect(rows).toEqual([{ count: 0 }]);
  });

  it('leaves audit_logs append-only: every update but the KEK rewrap of its encrypted columns is refused', async () => {
    const { environment, id } = await entry();
    await query(
      'insert into audit_log_ip_index (audit_log_id, environment_id, ip_hmac) values ($1, $2, $3)',
      [id, environment.id, HEX],
    );

    for (const change of [
      `action = 'inquiry.declined'`,
      `actor_id = null`,
      `resource_type = 'inquiry'`,
      `metadata = '{"synthetic": true}'::jsonb`,
      `ip = null`,
      `created_at = now()`,
    ]) {
      expect(
        await refused(`update audit_logs set ${change} where id = $1`, [id]),
        change,
      ).toContain('audit_logs is append-only');
    }
    const rewrapped = await database.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('openverify.kek_rewrap', 'on', true)`);
      await tx.execute(sql`update audit_logs set ip = ip where id = ${id}`);
      return tx
        .transaction((inner) =>
          inner.execute(sql`update audit_logs set action = 'inquiry.declined' where id = ${id}`),
        )
        .then(
          () => 'accepted',
          // Drizzle wraps the database's error: its message is in the cause.
          (error: unknown) =>
            error instanceof Error ? `${error.message} ${String(error.cause)}` : String(error),
        );
    });
    expect(rewrapped).toContain('audit_logs is append-only');
  });

  it('is labelled by the audit IP index label under the blind-index subkey', () => {
    expect(IDENTIFIER_KEY_LABELS['audit-ip']).toBe('openverify/audit-ip/v1');
  });
});
