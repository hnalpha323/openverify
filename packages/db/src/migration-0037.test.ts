/**
 * Migration 0037 (Workflow 11F, `0037_phase11f_session_amr`), upgrading a database at 0036 on
 * PGlite: KP11-26 (C248.6), `user_sessions.provider_amr`, the identity provider's `amr` an SSO
 * sign-in kept for the console's display; `null` on every session before it and on every session
 * that did not come from a provider naming one. Every value is synthetic.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKeyring, setDefaultKeyring } from './crypto.js';
import { migrationTags, runMigrations } from './migrate.js';
import * as schema from './schema.js';
import { PGLITE_EXTENSIONS, createTestTenant, testId } from './testing.js';

let upgraded: PGlite;
let earlierSessionId: string;
let organizationId: string;
let environmentId: string;
let userId: string;

beforeAll(async () => {
  setDefaultKeyring(createKeyring(randomBytes(32)));
  upgraded = new PGlite({ extensions: PGLITE_EXTENSIONS });
  const db = drizzle({ client: upgraded, schema });
  await runMigrations(db, { upTo: '0036_phase11_hardening' });
  const tenant = await createTestTenant(db, { organizationName: 'Example Amr Org' });
  organizationId = tenant.organization.id;
  environmentId = tenant.environment.id;
  userId = testId('usr');
  earlierSessionId = testId('uss');
  // Written in SQL: the drizzle schema already names the column 0036 does not have.
  await upgraded.query(
    `insert into users (id, organization_id, email, password_hash, status)
     values ($1, $2, 'amr@example.com', '$argon2id$v=19$synthetic', 'active')`,
    [userId, organizationId],
  );
  await upgraded.query(
    `insert into user_sessions (id, organization_id, user_id, environment_id, token_hash, expires_at)
     values ($1, $2, $3, $4, $5, now() + interval '1 hour')`,
    [earlierSessionId, organizationId, userId, environmentId, 'a'.repeat(64)],
  );
  await runMigrations(db);
});

afterAll(async () => {
  await upgraded.close();
});

describe('0037_phase11f_session_amr (KP11-26)', () => {
  it('is the newest migration', () => {
    expect(migrationTags().at(-1)).toBe('0037_phase11f_session_amr');
  });

  it('adds user_sessions.provider_amr, a nullable text array, null on the sessions before it', async () => {
    const column = await upgraded.query<{ data_type: string; is_nullable: string }>(
      `select data_type, is_nullable from information_schema.columns
       where table_name = 'user_sessions' and column_name = 'provider_amr'`,
    );
    expect(column.rows).toEqual([{ data_type: 'ARRAY', is_nullable: 'YES' }]);
    const earlier = await upgraded.query<{ provider_amr: string[] | null }>(
      'select provider_amr from user_sessions where id = $1',
      [earlierSessionId],
    );
    expect(earlier.rows).toEqual([{ provider_amr: null }]);
  });

  it('holds at most ten values', async () => {
    const write = (values: string[]) =>
      upgraded.query(
        `insert into user_sessions
           (id, organization_id, user_id, environment_id, token_hash, expires_at, provider_amr)
         values ($1, $2, $3, $4, $5, now() + interval '1 hour', $6)`,
        [
          testId('uss'),
          organizationId,
          userId,
          environmentId,
          randomBytes(32).toString('hex'),
          values,
        ],
      );
    await expect(write(['pwd', 'mfa'])).resolves.toBeDefined();
    await expect(
      write(Array.from({ length: 11 }, (_, index) => `m${String(index)}`)),
    ).rejects.toThrow(/user_sessions_provider_amr_limit/u);
  });
});
