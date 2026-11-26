/**
 * C249.3 (Workflow 11B Stage 1b (P); verification V05) on Postgres 17, with a runtime role that is
 * not the migration role (the owner of every table and of the two functions):
 *
 * - `audit_logs` and `connect_share_policies` refuse every delete the runtime role makes itself,
 *   whatever session setting it sets first; the migration role may delete, and so may the
 *   environment's cascade (`pg_trigger_depth() > 1`).
 * - `openverify_delete_expired_audit_logs(environment, now, limit)`, `SECURITY DEFINER` and owned by
 *   the migration role, deletes for the runtime only the entries older than the environment's
 *   `audit-log-retention-days`, never under its 30-day minimum, with their address index rows.
 *
 * Synthetic values only.
 */
import { randomBytes } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from './client.js';
import { createKeyring, setDefaultKeyring } from './crypto.js';
import { runMigrations } from './migrate.js';
import {
  createIntegrationPool,
  createTestTenant,
  ifSet,
  startIntegrationPostgres,
  testId,
} from './testing.js';

const RUNTIME = 'openverify_runtime_synthetic';
const RUNTIME_PASSWORD = 'synthetic-runtime-password';

let container: StartedPostgreSqlContainer | undefined;
let owner: Pool;
let runtime: Pool;
let db: Database;
let environmentId: string;
let policyId: string;

async function refusal(
  pool: Pool,
  statements: readonly string[],
  params: unknown[],
): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const [index, statement] of statements.entries()) {
      await client.query(statement, index === statements.length - 1 ? params : []);
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    return `${(error as { code?: string }).code ?? ''} ${(error as Error).message}`;
  } finally {
    client.release();
  }
  throw new Error(`expected a refusal: ${statements.join('; ')}`);
}

const auditCount = async (where: string) =>
  (
    await owner.query<{ n: number }>(
      `select count(*)::int as n from audit_logs where environment_id = $1 and ${where}`,
      [environmentId],
    )
  ).rows[0]?.n;

beforeAll(async () => {
  setDefaultKeyring(createKeyring(randomBytes(32)));
  container = await startIntegrationPostgres();
  owner = createIntegrationPool(container.getConnectionUri(), { max: 2 });
  db = createDatabase(owner);
  await runMigrations(db);
  await owner.query(`create role ${RUNTIME} login password '${RUNTIME_PASSWORD}'`);
  await owner.query(`grant usage on schema public to ${RUNTIME}`);
  await owner.query(
    `grant select, insert, update, delete on all tables in schema public to ${RUNTIME}`,
  );
  await owner.query(`grant usage, select on all sequences in schema public to ${RUNTIME}`);
  const uri = new URL(container.getConnectionUri());
  uri.username = RUNTIME;
  uri.password = RUNTIME_PASSWORD;
  runtime = new Pool({ connectionString: uri.toString(), max: 2 });

  const tenant = await createTestTenant(db);
  environmentId = tenant.environment.id;
  await owner.query(
    `update environments set settings = settings || '{"audit-log-retention-days": 30}'::jsonb
      where id = $1`,
    [environmentId],
  );
  for (const createdAt of [
    '2026-01-01T00:00:00Z',
    '2026-01-02T00:00:00Z',
    '2026-03-25T00:00:00Z',
  ]) {
    await owner.query(
      `insert into audit_logs (public_id, environment_id, actor_type, action, created_at)
       values ($1, $2, 'system', 'inquiry.viewed', $3)`,
      [testId('aud'), environmentId, createdAt],
    );
  }
  const other = await createTestTenant(db);
  const connectionId = testId('cxn');
  policyId = testId('cxnp');
  await owner.query(
    `insert into connect_connections (id, source_organization_id, destination_organization_id,
       status, creator_type, creator_id)
     values ($1, $2, $3, 'pending', 'api-key', $4)`,
    [connectionId, tenant.organization.id, other.organization.id, testId('key')],
  );
  await owner.query(
    `insert into connect_share_policies (id, connection_id, version, body, created_by_type,
       created_by_id)
     values ($1, $2, 1, '{}'::jsonb, 'api-key', $3)`,
    [policyId, connectionId, testId('key')],
  );
}, 180_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(runtime)?.end();
  await ifSet(owner)?.end();
  await container?.stop();
});

describe('the delete guards and the retention function (C249.3, V05)', () => {
  it('refuses the runtime role’s own deletes of audit entries and share policies, whatever it sets', async () => {
    for (const setting of [
      [],
      [`select set_config('openverify.environment_deletion', 'on', true)`],
      [`select set_config('openverify.retention', 'on', true)`],
      [`set local session_replication_role = 'replica'`],
    ]) {
      const audit = await refusal(
        runtime,
        [...setting, 'delete from audit_logs where environment_id = $1'],
        [environmentId],
      );
      const policies = await refusal(
        runtime,
        [...setting, 'delete from connect_share_policies where id = $1'],
        [policyId],
      );
      // 42501: insufficient privilege (the guard), or a setting the role may not make.
      expect(audit.slice(0, 5), audit).toBe('42501');
      expect(policies.slice(0, 5), policies).toBe('42501');
    }
    expect(await auditCount('true')).toBe(3);
  });

  it('deletes for the runtime, through the function, only what the setting allows, never under 30 days', async () => {
    const run = async (now: string) =>
      (
        await runtime.query<{ deleted: number }>(
          'select openverify_delete_expired_audit_logs($1, $2, 100) as deleted',
          [environmentId, now],
        )
      ).rows[0]?.deleted;
    expect(await run('2026-01-30T00:00:00Z')).toBe(0);
    expect(await run('2026-02-01T12:00:00Z')).toBe(2);
    expect(await auditCount('true')).toBe(1);
    await owner.query(
      `update environments set settings = settings || '{"audit-log-retention-days": 1}'::jsonb
        where id = $1`,
      [environmentId],
    );
    expect(await run('2026-04-20T00:00:00Z')).toBe(0);
    expect(await auditCount('true')).toBe(1);
  });

  it('lets the migration role delete, and the environment’s cascade', async () => {
    await owner.query('delete from connect_share_policies where id = $1', [policyId]);
    const client = await runtime.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('openverify.environment_deletion', 'on', true)`);
      await client.query('delete from environments where id = $1', [environmentId]);
      await client.query('commit');
    } finally {
      client.release();
    }
    expect(await auditCount('true')).toBe(0);
  });
});
