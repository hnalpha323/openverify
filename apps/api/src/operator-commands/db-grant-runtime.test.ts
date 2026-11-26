/**
 * C249.3 (Phase 11, Workflow 11B, platform-ops): `db:grant-runtime <role>` connects as the
 * migration role, grants through `grantRuntimeRole` and prints counts; it refuses bad arguments
 * and a role that could run DDL, and warns in production when it runs on `DATABASE_URL`. The
 * grants themselves are proved on Postgres 17 by `packages/db/src/runtime-role.integration.test.ts`.
 */
import type { RuntimeGrantConnection } from '@openverify/db';
import { describe, expect, it } from 'vitest';
import { runDbGrantRuntime, type RunDbGrantRuntimeOptions } from './db-grant-runtime.js';

const RUNTIME_URL =
  'postgresql://runtime:change-me-synthetic@db.example.org/openverify?sslmode=verify-full';
const MIGRATION_URL =
  'postgresql://migrator:change-me-synthetic@db.example.org/openverify?sslmode=verify-full';

const SAFE = {
  superuser: false,
  self: false,
  member_of_self: false,
  owns_database: false,
  owns_schema: false,
  owned_relations: 0,
};

function fakeDatabase(role: Record<string, unknown> | null = SAFE) {
  const opened: string[] = [];
  let closed = 0;
  const statements: string[] = [];
  const connection: RuntimeGrantConnection = {
    query: (text) => {
      statements.push(text);
      if (text.includes('from pg_roles')) {
        return Promise.resolve({ rows: role === null ? [] : [role] });
      }
      if (text.includes('count(*)')) {
        return Promise.resolve({ rows: [{ n: 7 }] });
      }
      return Promise.resolve({ rows: [] });
    },
  };
  const connect: RunDbGrantRuntimeOptions['connect'] = (url) => {
    opened.push(url);
    return Promise.resolve({
      connection,
      close: () => {
        closed += 1;
        return Promise.resolve();
      },
    });
  };
  return { connect, opened, statements, closed: () => closed };
}

async function run(argv: readonly string[], env: NodeJS.ProcessEnv, database = fakeDatabase()) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runDbGrantRuntime({
    argv,
    env,
    stdout: { write: (chunk: string) => stdout.push(chunk) },
    stderr: { write: (chunk: string) => stderr.push(chunk) },
    connect: database.connect,
  });
  return { code, stdout: stdout.join(''), stderr: stderr.join(''), database };
}

describe('db:grant-runtime (C249.3)', () => {
  it('grants as the migration role and prints counts only', async () => {
    const result = await run(['openverify_runtime'], {
      DATABASE_URL: RUNTIME_URL,
      OPENVERIFY_MIGRATION_DATABASE_URL: MIGRATION_URL,
      OPENVERIFY_MODE: 'production',
    });

    expect(result.code).toBe(0);
    expect(result.database.opened).toEqual([MIGRATION_URL]);
    expect(result.database.closed()).toBe(1);
    expect(result.database.statements).toContain(
      'grant select, insert, update, delete on all tables in schema public to "openverify_runtime"',
    );
    expect(result.stdout).toBe(
      'db:grant-runtime: granted openverify_runtime 7 tables and views (0 append-only: SELECT and ' +
        'INSERT only), 7 sequences, MAINTAIN on 0 tables, EXECUTE on 0 functions, and the default ' +
        'privileges for later tables and sequences; never CREATE.\n',
    );
    expect(result.stderr).toBe('');
    expect(result.stdout + result.stderr).not.toContain('change-me');
  });

  it('warns in production when it runs on DATABASE_URL', async () => {
    const result = await run(['openverify_runtime'], {
      DATABASE_URL: RUNTIME_URL,
      OPENVERIFY_MODE: 'production',
    });

    expect(result.code).toBe(0);
    expect(result.database.opened).toEqual([RUNTIME_URL]);
    expect(result.stderr).toContain('migration_url_unset');
  });

  it('refuses a role that could run DDL, granting nothing', async () => {
    const database = fakeDatabase({ ...SAFE, owns_database: true });

    const result = await run(['openverify_runtime'], { DATABASE_URL: RUNTIME_URL }, database);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('owns the database');
    expect(database.statements.filter((text) => text.startsWith('grant'))).toEqual([]);
    expect(database.closed()).toBe(1);
  });

  it.each([[[]], [['a', 'b']], [['--role', 'x']]])(
    'prints the usage and exits 2 for %j without connecting',
    async (argv) => {
      const result = await run(argv, { DATABASE_URL: RUNTIME_URL });

      expect(result.code).toBe(2);
      expect(result.stderr).toContain('Usage: pnpm --filter @openverify/api db:grant-runtime');
      expect(result.database.opened).toEqual([]);
    },
  );

  it('refuses a missing database URL, naming the variables and no value', async () => {
    const result = await run(['openverify_runtime'], {
      OPENVERIFY_MIGRATION_DATABASE_URL: 'mysql://canary-synthetic@h/db',
      NODE_ENV: 'test',
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('DATABASE_URL: is required');
    expect(result.stderr).toContain('OPENVERIFY_MIGRATION_DATABASE_URL: must be a postgres:// URL');
    expect(result.stderr).not.toContain('canary');
    expect(result.database.opened).toEqual([]);
  });
});
