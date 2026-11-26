/**
 * Migration 0033 (Workflow 10B, `foundation-10b`; one migration for the Workflow, extended per
 * Stage 1b checkpoint) on the production server image (Postgres 17): on an empty database, and on one
 * upgraded from 0032 with rows in it.
 * - Checkpoint 2, (C): `files.capture_trigger` (C206.2), `null` on every earlier file, held to
 *   `auto` or `manual` by `files_capture_trigger_valid`.
 * - Checkpoint 3, (I): `inquiry_integrity_challenges` and `inquiry_integrity_verdicts` (C211.3,
 *   C211.4, C221.3): a challenge and a verdict for an inquiry and a session written before the
 *   migration, removed with the inquiry.
 *
 * Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from './client.js';
import { createKeyring, setDefaultKeyring } from './crypto.js';
import { runMigrations } from './migrate.js';
import {
  createIntegrationPool,
  createTestInquiryOnEarlierSchema,
  createTestTenant,
  createTestVerificationOnEarlierSchema,
  startIntegrationPostgres,
  testId,
} from './testing.js';

let container: StartedPostgreSqlContainer | undefined;
const pools: Pool[] = [];

beforeAll(async () => {
  setDefaultKeyring(createKeyring(randomBytes(32)));
  container = await startIntegrationPostgres();
});

afterAll(async () => {
  setDefaultKeyring(undefined);
  await Promise.all(pools.map((pool) => pool.end()));
  await container?.stop();
});

async function freshDatabase(name: string): Promise<Database> {
  if (!container) throw new Error('no container');
  const admin = createIntegrationPool(container.getConnectionUri());
  pools.push(admin);
  await admin.query(`create database ${name}`);
  const url = new URL(container.getConnectionUri());
  url.pathname = `/${name}`;
  const pool = createIntegrationPool(url.toString());
  pools.push(pool);
  return createDatabase(pool);
}

/** A government ID verification with one file, written with the columns every schema since 0030 has. */
async function seedFile(db: Database) {
  const { environment } = await createTestTenant(db);
  const { inquiry } = await createTestInquiryOnEarlierSchema(db, environment.id);
  const verification = await createTestVerificationOnEarlierSchema(db, environment.id, {
    inquiryId: inquiry.id,
    type: 'government_id',
  });
  const fileId = testId('file');
  await db.execute(
    `insert into files (id, environment_id, verification_id, kind, storage_key, mime_type, byte_size,
       sha256, wrapped_dek, capture_method)
     values ('${fileId}', '${environment.id}', '${verification.id}', 'front', 'synthetic/${fileId}',
       'image/png', 10, '${'0'.repeat(64)}', 'ov1.${'A'.repeat(11)}.${'B'.repeat(80)}', 'camera')`,
  );
  return { environmentId: environment.id, inquiryId: inquiry.id, fileId };
}

/** The constraint that refused [statement], or `accepted`; drizzle wraps the driver's error as its cause. */
const refusedBy = async (statement: Promise<unknown>): Promise<string> =>
  statement.then(
    () => 'accepted',
    (error: unknown) => {
      const cause = (error as { cause?: { constraint?: string } }).cause;
      return cause?.constraint ?? String(error);
    },
  );

const triggerOf = async (db: Database, fileId: string) =>
  (await db.execute(`select capture_method, capture_trigger from files where id = '${fileId}'`))
    .rows;

describe('Workflow 10B migration 0033 on Postgres 17', () => {
  it('adds files.capture_trigger on an empty database, held to its two values', async () => {
    const db = await freshDatabase('phase10b_empty');
    await runMigrations(db);
    const { fileId } = await seedFile(db);

    expect(await triggerOf(db, fileId)).toEqual([
      { capture_method: 'camera', capture_trigger: null },
    ]);
    await db.execute(`update files set capture_trigger = 'auto' where id = '${fileId}'`);
    expect(
      await refusedBy(
        db.execute(`update files set capture_trigger = 'burst' where id = '${fileId}'`),
      ),
    ).toBe('files_capture_trigger_valid');
    expect(await triggerOf(db, fileId)).toEqual([
      { capture_method: 'camera', capture_trigger: 'auto' },
    ]);
  });

  it('upgrades a database at 0032 with a file in it: the file keeps its method and has no trigger', async () => {
    const db = await freshDatabase('phase10b_upgrade');
    await runMigrations(db, { upTo: '0032_phase9d' });
    const { fileId } = await seedFile(db);

    await runMigrations(db);

    expect(await triggerOf(db, fileId)).toEqual([
      { capture_method: 'camera', capture_trigger: null },
    ]);
    await db.execute(`update files set capture_trigger = 'manual' where id = '${fileId}'`);
    expect(await triggerOf(db, fileId)).toEqual([
      { capture_method: 'camera', capture_trigger: 'manual' },
    ]);
  });

  it('takes integrity challenges and a verdict for an inquiry and session from before it, and removes them with the inquiry', async () => {
    const db = await freshDatabase('phase10b_integrity');
    await runMigrations(db, { upTo: '0032_phase9d' });
    const { environmentId, inquiryId } = await seedFile(db);
    const sessionId = testId('iqse');
    await db.execute(
      `insert into inquiry_sessions (id, environment_id, inquiry_id, token_hash, expires_at)
       values ('${sessionId}', '${environmentId}', '${inquiryId}', '${'b'.repeat(64)}',
         now() + interval '1 hour')`,
    );

    await runMigrations(db);

    const challengeId = testId('ich');
    await db.execute(
      `insert into inquiry_integrity_challenges (id, environment_id, inquiry_id, session_id,
         request_hash, expires_at)
       values ('${challengeId}', '${environmentId}', '${inquiryId}', '${sessionId}',
         '${'A'.repeat(43)}', now() + interval '10 minutes')`,
    );
    await db.execute(
      `insert into inquiry_integrity_verdicts (environment_id, inquiry_id, provider, verdict, decoded_at)
       values ('${environmentId}', '${inquiryId}', 'sandbox', 'ov1.synthetic', now())`,
    );
    expect(
      await refusedBy(
        db.execute(
          `insert into inquiry_integrity_challenges (id, environment_id, inquiry_id, session_id,
             request_hash, expires_at)
           values ('${testId('ich')}', '${environmentId}', '${inquiryId}', '${sessionId}',
             'not-a-hash', now() + interval '10 minutes')`,
        ),
      ),
    ).toBe('inquiry_integrity_challenges_request_hash_format');

    // The environment goes, and every row of it with the cascade, the integrity records included.
    await db.execute(`DELETE FROM environments WHERE id = '${environmentId}'`);

    for (const table of ['inquiry_integrity_challenges', 'inquiry_integrity_verdicts']) {
      const left = await db.execute(
        `select count(*)::int as count from ${table} where inquiry_id = '${inquiryId}'`,
      );
      expect(left.rows, table).toEqual([{ count: 0 }]);
    }
  });
});
