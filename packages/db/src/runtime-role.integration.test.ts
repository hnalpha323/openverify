/**
 * C249.3 (decision 14; B7-E1; Phase 11, Workflow 11B, platform-ops), against a real Postgres 17
 * migrated by its owner: after `grantRuntimeRole`, the runtime role reads and writes rows but can
 * neither create a table, drop one, disable the audit trigger, nor update or delete audit rows
 * directly (with or without a session setting first); `ANALYZE` of the tables the runtime
 * refreshes raises no `WARNING`, and a table the migration role creates later is the runtime's
 * through the default privileges. Every value is synthetic.
 */
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from './client.js';
import { startIntegrationPostgres } from './integration-postgres.js';
import { runMigrations } from './migrate.js';
import { rebuildWatchlistKeyDf } from './repositories/watchlist-key-df.js';
import { grantRuntimeRole, RuntimeRoleError } from './runtime-role.js';
import { createRuntimeRole } from './testing.js';

const ROLE = 'openverify_runtime';
const PASSWORD = 'change-me-synthetic-runtime';

let container: Awaited<ReturnType<typeof startIntegrationPostgres>>;
let ownerUrl: string;
let runtimeUrl: string;

async function withClient<T>(url: string, work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** The SQLSTATE a statement fails with as the runtime role, or `null` when it succeeds. */
async function asRuntime(statements: readonly string[]): Promise<string | null> {
  return withClient(runtimeUrl, async (client) => {
    try {
      await client.query('begin');
      for (const statement of statements) {
        await client.query(statement);
      }
      await client.query('rollback');
      return null;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      return (error as { code?: string }).code ?? 'unknown';
    }
  });
}

beforeAll(async () => {
  container = await startIntegrationPostgres();
  ownerUrl = container.getConnectionUri();
  const pool = new Pool({ connectionString: ownerUrl, max: 2 });
  try {
    await runMigrations(createDatabase(pool));
  } finally {
    await pool.end();
  }
  await withClient(ownerUrl, async (client) => {
    await client.query(`create role ${ROLE} login password '${PASSWORD}'`);
    await grantRuntimeRole(client, ROLE);
  });
  const url = new URL(ownerUrl);
  url.username = ROLE;
  url.password = PASSWORD;
  runtimeUrl = url.toString();
});

afterAll(async () => {
  await container.stop();
});

describe('the runtime role (C249.3)', () => {
  it('reads and writes ordinary rows', async () => {
    expect(
      await asRuntime([
        "insert into organizations (id, name) values ('org_01JZ0000000000000000000001', 'Runtime row (synthetic)')",
        "update organizations set name = 'Renamed (synthetic)' where id = 'org_01JZ0000000000000000000001'",
        "delete from organizations where id = 'org_01JZ0000000000000000000001'",
        'select count(*) from audit_logs',
      ]),
    ).toBeNull();
  });

  it('cannot create a table', async () => {
    expect(await asRuntime(['create table runtime_made (id int)'])).toBe('42501');
  });

  it('cannot drop or alter a table', async () => {
    expect(await asRuntime(['drop table organizations'])).toBe('42501');
    expect(await asRuntime(['alter table organizations add column extra int'])).toBe('42501');
  });

  it('cannot disable the audit trigger', async () => {
    expect(await asRuntime(['alter table audit_logs disable trigger all'])).toBe('42501');
  });

  it.each([
    [[]],
    [["select set_config('openverify.kek_rewrap', 'on', true)"]],
    [["select set_config('openverify.retention', 'on', true)"]],
  ])('cannot delete or update audit rows directly, after %j', async (settings) => {
    expect(await asRuntime([...settings, 'delete from audit_logs'])).toBe('42501');
    expect(await asRuntime([...settings, "update audit_logs set action = 'x.y'"])).toBe('42501');
    expect(await asRuntime([...settings, 'truncate audit_logs'])).toBe('42501');
  });

  it('cannot change the session_replication_role that would skip triggers', async () => {
    expect(await asRuntime(['set local session_replication_role = replica'])).toBe('42501');
  });

  it('keeps connect_share_policies append-only', async () => {
    expect(await asRuntime(['delete from connect_share_policies'])).toBe('42501');
    expect(await asRuntime(['update connect_share_policies set version = version'])).toBe('42501');
  });

  it('analyzes the tables it refreshes with no WARNING, and only those', async () => {
    const warnings = await withClient(runtimeUrl, async (client) => {
      const seen: string[] = [];
      client.on('notice', (notice) => {
        seen.push(`${notice.severity ?? ''}: ${notice.message ?? ''}`);
      });
      await client.query(
        'analyze watchlist_entries, watchlist_names, watchlist_identifiers, watchlist_crypto_addresses',
      );
      const granted = [...seen];
      await client.query('analyze organizations');
      return { granted, control: seen.slice(granted.length) };
    });

    expect(warnings.granted).toEqual([]);
    expect(warnings.control.join('\n')).toMatch(/WARNING: permission denied to analyze/u);
  });

  it("rebuilds a watchlist source's key frequencies, the sync's and the re-key's last step, with no WARNING", async () => {
    const pool = new Pool({ connectionString: runtimeUrl, max: 1 });
    const seen: string[] = [];
    pool.on('connect', (client) => {
      client.on('notice', (notice) => {
        seen.push(`${notice.severity ?? ''}: ${notice.message ?? ''}`);
      });
    });
    try {
      await rebuildWatchlistKeyDf(createDatabase(pool), 'ofac-sdn');
    } finally {
      await pool.end();
    }
    expect(seen.filter((line) => line.startsWith('WARNING'))).toEqual([]);
  });

  it("may run the migration role's two functions, and nothing else of them", async () => {
    expect(await asRuntime(["select openverify_gin_clean_pending_lists('ofac-sdn')"])).toBeNull();
    expect(
      await asRuntime([
        "select openverify_delete_expired_audit_logs('env_01JZ0000000000000000000001', now(), 10)",
      ]),
    ).toBeNull();
    expect(
      await asRuntime([
        'alter function openverify_gin_clean_pending_lists(text) owner to current_user',
      ]),
    ).toBe('42501');
  });

  it('gets the tables the migration role creates later, through the default privileges', async () => {
    await withClient(ownerUrl, (client) =>
      client.query('create table later_table (id int primary key)'),
    );

    expect(
      await asRuntime(['insert into later_table values (1)', 'select * from later_table']),
    ).toBeNull();
  });

  it('can be granted again, as a deploy runs it', async () => {
    const summary = await withClient(ownerUrl, (client) => grantRuntimeRole(client, ROLE));

    expect(summary.appendOnlyTables).toBe(2);
    expect(summary.maintainTables).toBe(4);
  });

  it('refuses a role that owns a table', async () => {
    const refusal = await withClient(ownerUrl, async (client) => {
      await client.query("create role openverify_owner login password 'change-me-synthetic-owner'");
      await client.query('alter table later_table owner to openverify_owner');
      return grantRuntimeRole(client, 'openverify_owner').catch((error: unknown) => error);
    });

    expect(refusal).toBeInstanceOf(RuntimeRoleError);
    expect((refusal as Error).message).toContain('owns 1 table');
  });
});

describe('createRuntimeRole, for the integration suites (C249.3)', () => {
  it('answers a URI that connects as a granted, non-owner role, and can be called again', async () => {
    const first = await createRuntimeRole(ownerUrl, { role: 'openverify_suite' });
    const again = await createRuntimeRole(ownerUrl, { role: 'openverify_suite' });

    expect(again).toBe(first);
    const seen = await withClient(first, async (client) => {
      const who = await client.query<{ name: string; owner: boolean }>(
        `select current_user as name,
                pg_has_role(current_user, (select pg_get_userbyid(datdba) from pg_database
                                            where datname = current_database()), 'member') as owner`,
      );
      await client.query('select count(*) from organizations');
      return who.rows[0];
    });
    expect(seen).toEqual({ name: 'openverify_suite', owner: false });
  });
});
