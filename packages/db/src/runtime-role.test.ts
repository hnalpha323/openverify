/**
 * C249.3 (Phase 11, Workflow 11B, platform-ops): `grantRuntimeRole`, statement by statement, over a
 * recording connection. What the grants allow and refuse on a real Postgres 17 is
 * `runtime-role.integration.test.ts`'s.
 */
import { describe, expect, it } from 'vitest';
import {
  grantRuntimeRole,
  RUNTIME_APPEND_ONLY_TABLES,
  RUNTIME_FUNCTIONS,
  RUNTIME_MAINTAIN_TABLES,
  RuntimeRoleError,
  type RuntimeGrantConnection,
} from './runtime-role.js';

interface Facts {
  role?: Record<string, unknown> | null;
  failOn?: string;
}

const SAFE_ROLE = {
  superuser: false,
  self: false,
  member_of_self: false,
  owns_database: false,
  owns_schema: false,
  owned_relations: 0,
};

/** A quote and a statement terminator inside a name: refused as a name, never run. */
const QUOTED_NAME = ['x', '"', ';', ' other'].join('');

/** A connection that answers the inspection queries from `facts` and records every statement. */
function connection(facts: Facts = {}) {
  const statements: string[] = [];
  const conn: RuntimeGrantConnection = {
    query: (text) => {
      statements.push(text);
      if (facts.failOn !== undefined && text.startsWith(facts.failOn)) {
        return Promise.reject(new Error('permission denied'));
      }
      if (text.includes('from pg_roles')) {
        const role = facts.role === undefined ? SAFE_ROLE : facts.role;
        return Promise.resolve({ rows: role === null ? [] : [role] });
      }
      if (text.includes("relkind in ('r', 'p', 'v', 'm', 'f')")) {
        return Promise.resolve({ rows: [{ n: 120 }] });
      }
      if (text.includes("relkind = 'S'")) {
        return Promise.resolve({ rows: [{ n: 3 }] });
      }
      if (text.includes('relname = any')) {
        return Promise.resolve({
          rows: [...RUNTIME_APPEND_ONLY_TABLES, ...RUNTIME_MAINTAIN_TABLES].map((relname) => ({
            relname,
          })),
        });
      }
      if (text.includes('from pg_proc')) {
        return Promise.resolve({
          rows: [{ signature: 'openverify_delete_expired_audit_logs(text)' }],
        });
      }
      return Promise.resolve({ rows: [] });
    },
  };
  return { conn, statements };
}

describe('grantRuntimeRole (C249.3)', () => {
  it('grants usage, the four table privileges, the sequences, default privileges, MAINTAIN and EXECUTE in one transaction', async () => {
    const { conn, statements } = connection();

    const summary = await grantRuntimeRole(conn, 'openverify_runtime');

    expect(summary).toEqual({
      tables: 120,
      appendOnlyTables: 2,
      sequences: 3,
      maintainTables: 4,
      functions: 1,
    });
    const writes = statements.filter((text) => !text.startsWith('select'));
    expect(writes).toEqual([
      'begin',
      'grant usage on schema public to "openverify_runtime"',
      'revoke create on schema public from "openverify_runtime"',
      'grant select, insert, update, delete on all tables in schema public to "openverify_runtime"',
      'revoke update, delete, truncate on table public.audit_logs, public.connect_share_policies from "openverify_runtime"',
      'grant usage, select, update on all sequences in schema public to "openverify_runtime"',
      'alter default privileges in schema public grant select, insert, update, delete on tables to "openverify_runtime"',
      'alter default privileges in schema public grant usage, select, update on sequences to "openverify_runtime"',
      'grant maintain on table public.watchlist_entries, public.watchlist_names, public.watchlist_identifiers, public.watchlist_crypto_addresses to "openverify_runtime"',
      'grant execute on function openverify_delete_expired_audit_logs(text) to "openverify_runtime"',
      'commit',
    ]);
    expect(statements.join('\n')).not.toMatch(/grant (all|create)/u);
    expect(RUNTIME_FUNCTIONS).toContain('openverify_gin_clean_pending_lists');
  });

  it.each(['', 'Runtime', 'run-time', QUOTED_NAME, 'a'.repeat(64), '1role'])(
    'refuses the name %j before any statement',
    async (role) => {
      const { conn, statements } = connection();

      await expect(grantRuntimeRole(conn, role)).rejects.toBeInstanceOf(RuntimeRoleError);
      expect(statements).toEqual([]);
    },
  );

  it.each([
    [null, 'does not exist'],
    [{ ...SAFE_ROLE, superuser: true }, 'superuser'],
    [{ ...SAFE_ROLE, self: true }, 'the role running db:grant-runtime'],
    [{ ...SAFE_ROLE, member_of_self: true }, 'member of the role running db:grant-runtime'],
    [{ ...SAFE_ROLE, owns_database: true }, 'owns the database'],
    [{ ...SAFE_ROLE, owns_schema: true }, 'owns the schema public'],
    [{ ...SAFE_ROLE, owned_relations: 2 }, 'owns 2 tables'],
  ])(
    'refuses a role that could run DDL or is missing (%j), granting nothing',
    async (role, words) => {
      const { conn, statements } = connection({ role });

      const refusal = await grantRuntimeRole(conn, 'openverify_runtime').catch(
        (error: unknown) => error,
      );

      expect(refusal).toBeInstanceOf(RuntimeRoleError);
      expect((refusal as Error).message).toContain(words);
      expect(statements.filter((text) => !text.startsWith('select'))).toEqual([]);
    },
  );

  it('rolls the transaction back when a grant fails', async () => {
    const { conn, statements } = connection({ failOn: 'grant maintain' });

    await expect(grantRuntimeRole(conn, 'openverify_runtime')).rejects.toThrow('permission denied');

    expect(statements.at(-1)).toBe('rollback');
    expect(statements).not.toContain('commit');
  });
});
