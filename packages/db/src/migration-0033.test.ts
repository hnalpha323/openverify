/**
 * Migration 0033 (Workflow 10B, `foundation-10b`), upgrading a database at 0032 on PGlite. One
 * migration for the whole Workflow, extended per checkpoint:
 * - checkpoint 2, (C): `files.capture_trigger` (C206.2), a text column held by the CHECK
 *   `files_capture_trigger_valid`, `null` on every file written before it (no client said);
 * - checkpoint 3, (I): `inquiry_integrity_challenges` and `inquiry_integrity_verdicts` (C211.3,
 *   C211.4, C221.3), empty on an upgraded database, taking a challenge and a verdict for an inquiry
 *   and session written before the migration; the verdicts' `updated_at` trigger.
 *
 * Every value is synthetic.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKeyring, setDefaultKeyring } from './crypto.js';
import { migrationTags, runMigrations } from './migrate.js';
import * as schema from './schema.js';
import {
  PGLITE_EXTENSIONS,
  createTestInquiryOnEarlierSchema,
  createTestTenant,
  createTestVerificationOnEarlierSchema,
  testId,
} from './testing.js';

let upgraded: PGlite;
let seeded: {
  environmentId: string;
  inquiryId: string;
  sessionId: string;
  verificationId: string;
  fileId: string;
};

beforeAll(async () => {
  setDefaultKeyring(createKeyring(randomBytes(32)));
  upgraded = new PGlite({ extensions: PGLITE_EXTENSIONS });
  const earlier = drizzle({ client: upgraded, schema });
  await runMigrations(earlier, { upTo: '0032_phase9d' });
  const { environment } = await createTestTenant(earlier);
  const { inquiry } = await createTestInquiryOnEarlierSchema(earlier, environment.id);
  const verification = await createTestVerificationOnEarlierSchema(earlier, environment.id, {
    inquiryId: inquiry.id,
    type: 'government_id',
  });
  const sessionId = testId('iqse');
  await upgraded.query(
    `insert into inquiry_sessions (id, environment_id, inquiry_id, token_hash, expires_at)
     values ($1, $2, $3, $4, now() + interval '1 hour')`,
    [sessionId, environment.id, inquiry.id, 'a'.repeat(64)],
  );
  const fileId = testId('file');
  await upgraded.query(
    `insert into files (id, environment_id, verification_id, kind, storage_key, mime_type, byte_size,
       sha256, wrapped_dek, capture_method)
     values ($1, $2, $3, 'front', $4, 'image/png', 10, $5, $6, 'camera')`,
    [
      fileId,
      environment.id,
      verification.id,
      `synthetic/${fileId}`,
      '0'.repeat(64),
      `ov1.${'A'.repeat(11)}.${'B'.repeat(80)}`,
    ],
  );
  seeded = {
    environmentId: environment.id,
    inquiryId: inquiry.id,
    sessionId,
    verificationId: verification.id,
    fileId,
  };
  await runMigrations(earlier);
}, 120_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await upgraded.close();
});

const definition = async (name: string): Promise<string> => {
  const rows = await upgraded.query<{ def: string }>(
    'select pg_get_constraintdef(oid) as def from pg_constraint where conname = $1',
    [name],
  );
  const [row] = rows.rows;
  if (row === undefined) throw new Error(`no constraint ${name}`);
  return row.def;
};

describe('migration 0033: applies on top of 0032 (Workflow 10B)', () => {
  it('is the migration after 0032_phase9d', () => {
    const tags = migrationTags();
    expect(tags.indexOf('0033_phase10b')).toBe(tags.indexOf('0032_phase9d') + 1);
  });
});

describe('migration 0033, checkpoint 2: files.capture_trigger (C206.2)', () => {
  it('leaves every earlier file without a trigger, and keeps its method', async () => {
    const rows = await upgraded.query<{
      capture_method: string | null;
      capture_trigger: string | null;
    }>('select capture_method, capture_trigger from files where environment_id = $1 and id = $2', [
      seeded.environmentId,
      seeded.fileId,
    ]);
    expect(rows.rows).toEqual([{ capture_method: 'camera', capture_trigger: null }]);
  });

  it('holds the trigger to the two values, null allowed', async () => {
    const check = await definition('files_capture_trigger_valid');
    expect(check).toContain("'auto'");
    expect(check).toContain("'manual'");
    await upgraded.query(`update files set capture_trigger = 'auto' where id = $1`, [
      seeded.fileId,
    ]);
    await expect(
      upgraded.query(`update files set capture_trigger = 'timer' where id = $1`, [seeded.fileId]),
    ).rejects.toThrow(/files_capture_trigger_valid/);
  });
});

describe('migration 0033, checkpoint 3: the integrity tables (C211.3, C211.4, C221.3)', () => {
  it('creates both tables empty, with their constraints and the verdicts updated_at trigger', async () => {
    for (const table of ['inquiry_integrity_challenges', 'inquiry_integrity_verdicts']) {
      const count = await upgraded.query<{ count: string }>(
        `select count(*)::text as count from ${table}`,
      );
      expect(count.rows, table).toEqual([{ count: '0' }]);
    }
    expect(await definition('inquiry_integrity_challenges_request_hash_format')).toContain(
      'A-Za-z0-9_-',
    );
    expect(await definition('inquiry_integrity_verdicts_provider_valid')).toContain(
      "'play-integrity'",
    );
    const triggers = await upgraded.query<{ tgname: string }>(
      `select tgname from pg_trigger where tgrelid = 'inquiry_integrity_verdicts'::regclass
         and not tgisinternal`,
    );
    expect(triggers.rows.map((row) => row.tgname)).toEqual([
      'inquiry_integrity_verdicts_set_updated_at',
    ]);
  });

  it('takes a challenge and a verdict for an inquiry and session written before it', async () => {
    const challengeId = testId('ich');
    await upgraded.query(
      `insert into inquiry_integrity_challenges (id, environment_id, inquiry_id, session_id,
         request_hash, expires_at)
       values ($1, $2, $3, $4, $5, now() + interval '10 minutes')`,
      [challengeId, seeded.environmentId, seeded.inquiryId, seeded.sessionId, 'A'.repeat(43)],
    );
    await upgraded.query(
      `insert into inquiry_integrity_verdicts (environment_id, inquiry_id, provider, verdict,
         decoded_at)
       values ($1, $2, 'play-integrity', 'ov1.synthetic', now())`,
      [seeded.environmentId, seeded.inquiryId],
    );
    const rows = await upgraded.query<{ provider: string }>(
      'select provider from inquiry_integrity_verdicts where inquiry_id = $1',
      [seeded.inquiryId],
    );
    expect(rows.rows).toEqual([{ provider: 'play-integrity' }]);
  });
});
