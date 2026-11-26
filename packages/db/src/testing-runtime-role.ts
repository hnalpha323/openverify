/**
 * C249.3 (Phase 11, Workflow 11B, platform-ops): integration tests that must run as the runtime
 * role, never as the database's owner (the sync tests, a list sync, the key-frequency rebuild and a
 * re-key: "the integration suite's sync tests run as a non-owner role"). `createRuntimeRole` makes
 * a login role on a migrated test database and grants it what `db:grant-runtime` grants
 * (`grantRuntimeRole`), and answers a connection URI that connects as it. Test support only.
 */

import { Client } from 'pg';
import { grantRuntimeRole, RUNTIME_ROLE_NAME } from './runtime-role.js';

/** The role tests run as, unless they name another; its password is a synthetic canary. */
export const TEST_RUNTIME_ROLE = 'openverify_runtime';

export interface CreateRuntimeRoleOptions {
  /** {@link TEST_RUNTIME_ROLE} by default. */
  role?: string;
}

/** The synthetic password every test runtime role gets. */
const TEST_RUNTIME_PASSWORD = 'change-me-synthetic-runtime-role';

/**
 * Creates (or reuses) the runtime role on the database `ownerUri` names, grants it the runtime's
 * privileges, and answers a URI that connects as it. Run it after the migrations: later tables get
 * the default privileges.
 */
export async function createRuntimeRole(
  ownerUri: string,
  options: CreateRuntimeRoleOptions = {},
): Promise<string> {
  const role = options.role ?? TEST_RUNTIME_ROLE;
  if (!RUNTIME_ROLE_NAME.test(role)) {
    throw new RangeError('createRuntimeRole: the role must be a lowercase SQL name');
  }
  const client = new Client({ connectionString: ownerUri });
  await client.connect();
  try {
    const exists = await client.query('select 1 from pg_roles where rolname = $1', [role]);
    if (exists.rowCount === 0) {
      await client.query(`create role "${role}" login password '${TEST_RUNTIME_PASSWORD}'`);
    }
    await grantRuntimeRole(client, role);
  } finally {
    await client.end();
  }
  const url = new URL(ownerUri);
  url.username = role;
  url.password = TEST_RUNTIME_PASSWORD;
  return url.toString();
}
