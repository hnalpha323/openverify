/**
 * C249.3 (decision 14; B7-E1; Phase 11, Workflow 11B, platform-ops): the runtime role's
 * privileges, granted by `pnpm --filter @openverify/api db:grant-runtime <role>` run as the
 * migration role (`OPENVERIFY_MIGRATION_DATABASE_URL`), and by the integration suite's
 * `createRuntimeRole` so its sync tests run as a non-owner role.
 *
 * - `USAGE` on the schema `public`, never `CREATE`.
 * - `SELECT, INSERT, UPDATE, DELETE` on every table and `USAGE, SELECT, UPDATE` on every sequence,
 *   and the same as default privileges for the tables and sequences the migration role creates
 *   later.
 * - The append-only tables (review P17) keep `SELECT, INSERT` only: their deletes go through
 *   `openverify_delete_expired_audit_logs`, a `SECURITY DEFINER` function the migration role owns.
 * - PostgreSQL 17's `MAINTAIN` on exactly the tables whose statistics the runtime refreshes
 *   (`ANALYZE`, Stage 1a amendment 14), and `EXECUTE` on the migration role's functions.
 *
 * A role that is a superuser, the role running the grant, or the owner of the database, the
 * schema or any of its tables is refused: it could run DDL whatever is granted here.
 */

/** Review P17: `SELECT, INSERT` only. */
export const RUNTIME_APPEND_ONLY_TABLES = Object.freeze(['audit_logs', 'connect_share_policies']);

/** Stage 1a amendment 14: the tables the runtime `ANALYZE`s (inventory 2.9). */
export const RUNTIME_MAINTAIN_TABLES = Object.freeze([
  'watchlist_entries',
  'watchlist_names',
  'watchlist_identifiers',
  'watchlist_crypto_addresses',
]);

/** C249.3: the migration role's `SECURITY DEFINER` functions the runtime calls. */
export const RUNTIME_FUNCTIONS = Object.freeze([
  'openverify_delete_expired_audit_logs',
  'openverify_gin_clean_pending_lists',
]);

/** A role name `db:grant-runtime` accepts: a lowercase SQL identifier, never quoted text. */
export const RUNTIME_ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/u;

/** One connection (node-postgres' `Client` or `PoolClient`); the grant runs in its transaction. */
export interface RuntimeGrantConnection {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/** The grant was refused; the message says why and names no secret. */
export class RuntimeRoleError extends Error {
  override name = 'RuntimeRoleError';
}

/** What a grant did, in counts. */
export interface RuntimeGrantSummary {
  tables: number;
  appendOnlyTables: number;
  sequences: number;
  maintainTables: number;
  functions: number;
}

interface RoleFacts {
  superuser: boolean;
  self: boolean;
  member_of_self: boolean;
  owns_database: boolean;
  owns_schema: boolean;
  owned_relations: number;
}

/** Why `role` may not be the runtime role, or `null`. */
function refusalOf(role: string, facts: RoleFacts | undefined): string | null {
  const ddl = 'so it could run DDL whatever db:grant-runtime grants';
  if (facts === undefined) {
    return `db:grant-runtime: the role ${role} does not exist; create it first (CREATE ROLE ${role} LOGIN PASSWORD ...).`;
  }
  if (facts.superuser) {
    return `db:grant-runtime: the role ${role} is a superuser, ${ddl}.`;
  }
  if (facts.self) {
    return `db:grant-runtime: the role ${role} is the role running db:grant-runtime; the runtime role must be another one.`;
  }
  if (facts.member_of_self) {
    return `db:grant-runtime: the role ${role} is a member of the role running db:grant-runtime, ${ddl}.`;
  }
  if (facts.owns_database) {
    return `db:grant-runtime: the role ${role} owns the database, ${ddl}; give the database to the migration role first.`;
  }
  if (facts.owns_schema) {
    return `db:grant-runtime: the role ${role} owns the schema public, ${ddl}; give the schema to the migration role first.`;
  }
  if (facts.owned_relations > 0) {
    const tables =
      facts.owned_relations === 1 ? '1 table' : `${String(facts.owned_relations)} tables`;
    return `db:grant-runtime: the role ${role} owns ${tables} in the schema public, ${ddl}; give them to the migration role first.`;
  }
  return null;
}

const quoted = (role: string): string => `"${role}"`;
const tableList = (names: readonly string[]): string =>
  names.map((name) => `public.${name}`).join(', ');

/**
 * Grants `role` the runtime's privileges on the connection's database, in one transaction.
 * @throws {RuntimeRoleError} for a bad name, a missing role, or a role that could run DDL.
 */
export async function grantRuntimeRole(
  connection: RuntimeGrantConnection,
  role: string,
): Promise<RuntimeGrantSummary> {
  if (!RUNTIME_ROLE_NAME.test(role)) {
    throw new RuntimeRoleError(
      'db:grant-runtime: the role must be a lowercase SQL name (a-z, 0-9 and _, at most 63, not starting with a digit).',
    );
  }
  const facts = (
    await connection.query(
      `select r.rolsuper as superuser,
              r.rolname = current_user as self,
              pg_has_role(r.rolname, current_user, 'member') as member_of_self,
              pg_get_userbyid(d.datdba) = r.rolname as owns_database,
              pg_get_userbyid(n.nspowner) = r.rolname as owns_schema,
              (select count(*)::int from pg_class c
                where c.relnamespace = n.oid and c.relowner = r.oid
                  and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')) as owned_relations
         from pg_roles r, pg_database d, pg_namespace n
        where r.rolname = $1 and d.datname = current_database() and n.nspname = 'public'`,
      [role],
    )
  ).rows[0] as RoleFacts | undefined;
  const refusal = refusalOf(role, facts);
  if (refusal !== null) {
    throw new RuntimeRoleError(refusal);
  }
  const count = async (text: string): Promise<number> =>
    Number((await connection.query(text)).rows[0]?.n ?? 0);
  const tables = await count(
    `select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')`,
  );
  const sequences = await count(
    `select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'S'`,
  );
  const present = new Set(
    (
      await connection.query(
        `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = any($1::text[])`,
        [[...RUNTIME_APPEND_ONLY_TABLES, ...RUNTIME_MAINTAIN_TABLES]],
      )
    ).rows.map((row) => String(row.relname)),
  );
  const appendOnly = RUNTIME_APPEND_ONLY_TABLES.filter((name) => present.has(name));
  const maintain = RUNTIME_MAINTAIN_TABLES.filter((name) => present.has(name));
  const functions = (
    await connection.query(
      `select p.oid::regprocedure::text as signature from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = any($1::text[]) order by 1`,
      [[...RUNTIME_FUNCTIONS]],
    )
  ).rows.map((row) => String(row.signature));

  const to = quoted(role);
  const statements = [
    `grant usage on schema public to ${to}`,
    `revoke create on schema public from ${to}`,
    `grant select, insert, update, delete on all tables in schema public to ${to}`,
    ...(appendOnly.length === 0
      ? []
      : [`revoke update, delete, truncate on table ${tableList(appendOnly)} from ${to}`]),
    `grant usage, select, update on all sequences in schema public to ${to}`,
    `alter default privileges in schema public grant select, insert, update, delete on tables to ${to}`,
    `alter default privileges in schema public grant usage, select, update on sequences to ${to}`,
    ...(maintain.length === 0 ? [] : [`grant maintain on table ${tableList(maintain)} to ${to}`]),
    ...functions.map((signature) => `grant execute on function ${signature} to ${to}`),
  ];
  await connection.query('begin');
  try {
    for (const statement of statements) {
      await connection.query(statement);
    }
    await connection.query('commit');
  } catch (error) {
    await connection.query('rollback');
    throw error;
  }
  return {
    tables,
    appendOnlyTables: appendOnly.length,
    sequences,
    maintainTables: maintain.length,
    functions: functions.length,
  };
}
