/**
 * Workflow 10B Stage 1b: what `foundation-10b` builds in the database (migration `0033_phase10b`).
 *
 * Checkpoint 2, (C): `files.capture_trigger`, whether the shutter (`manual`) or the auto-capture
 * (`auto`) took a photo, as the upload named it (C206.2), held by a CHECK like `capture_method` and
 * `null` when the client did not say. Client-reported, never proven (C206.3).
 *
 * Checkpoint 3, (I): `inquiry_integrity_challenges` (C211.3: the challenge a device's Play Integrity
 * token is bound to, the token sealed for its row until the `integrity-decode` job reads it) and
 * `inquiry_integrity_verdicts` (C211.4: one per inquiry, the verdict's fixed projection sealed for the
 * inquiry's row), their encrypted columns in the KEK rewrap, their deletion with the inquiry's
 * redaction and by the C16 pass. The repository `api-integrity` built is tested beside it
 * (`repositories/inquiry-integrity.test.ts`).
 *
 * Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { FILE_CAPTURE_TRIGGERS, INTEGRITY_VERDICT_PROVIDERS } from '@openverify/core';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKeyring, setDefaultKeyring } from './crypto.js';
import { ENCRYPTED_COLUMNS, SEALED } from './encrypted-columns.js';
import {
  createFile,
  createInquirySession,
  deleteExpiredIntegrityChallenges,
  deleteIntegrityRecordsOfRedactedInquiries,
  INTEGRITY_CHALLENGE_RETENTION_HOURS,
  listVerificationFiles,
  redactInquiryRecords,
  REWRAP_TABLES,
  rewrapTableBatch,
} from './repositories/index.js';
import { openJson, openValue, sealJson, sealValue, type Sealed } from './sealed.js';
import { hashSessionToken } from './tokens.js';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  createTestVerificationOnEarlierSchema,
  testId,
  type TestDatabase,
} from './testing.js';

let database: TestDatabase;

/** The database's own KEK: a rewrap here passes over every row of the table, other tests' included. */
const baseKek = randomBytes(32);

beforeAll(async () => {
  database = await createTestDatabase({ keyring: createKeyring(baseKek) });
}, 120_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await database.close();
});

const refused = async (text: string, params: unknown[]) =>
  database.client.query(text, params).then(
    () => 'accepted',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

async function seededVerification() {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  const verification = await createTestVerificationOnEarlierSchema(database.db, environment.id, {
    inquiryId: inquiry.id,
    type: 'government_id',
  });
  return { environmentId: environment.id, verificationId: verification.id };
}

const fileInput = (verificationId: string) => ({
  id: testId('file'),
  verificationId,
  kind: 'front' as const,
  storageKey: `synthetic/${testId('file')}`,
  mimeType: 'image/png',
  byteSize: 10,
  sha256: '0'.repeat(64),
  wrappedDek: `ov1.${'A'.repeat(11)}.${'B'.repeat(80)}`,
});

describe('files.capture_trigger (C206.2)', () => {
  it('names the two triggers a photo upload may report', () => {
    expect(FILE_CAPTURE_TRIGGERS).toEqual(['auto', 'manual']);
  });

  it('keeps the trigger the client reported beside its method, and null when it did not say', async () => {
    const { environmentId, verificationId } = await seededVerification();

    const auto = await createFile(database.db, environmentId, {
      ...fileInput(verificationId),
      captureMethod: 'camera',
      captureTrigger: 'auto',
    });
    const unsaid = await createFile(database.db, environmentId, {
      ...fileInput(verificationId),
      kind: 'back',
    });

    expect(auto).toMatchObject({ captureMethod: 'camera', captureTrigger: 'auto' });
    expect(unsaid).toMatchObject({ captureMethod: null, captureTrigger: null });
    const listed = await listVerificationFiles(database.db, environmentId, [verificationId]);
    expect(new Map(listed.map((file) => [file.kind, file.captureTrigger]))).toEqual(
      new Map([
        ['front', 'auto'],
        ['back', null],
      ]),
    );
  });

  it('refuses any other trigger', async () => {
    const { environmentId, verificationId } = await seededVerification();
    const file = await createFile(database.db, environmentId, fileInput(verificationId));

    expect(
      await refused(`update files set capture_trigger = 'shutter' where id = $1`, [file.id]),
    ).toContain('files_capture_trigger_valid');
    expect(
      await refused(`update files set capture_trigger = 'manual' where id = $1`, [file.id]),
    ).toBe('accepted');
  });
});

// Checkpoint 3, (I): the integrity challenges and verdicts (C211.3, C211.4, C221.3) --------------

const openEnvelope = /^ov1\./;

/** A well-formed envelope where only the column's shape matters (a later rewrap pass reads it). */
const syntheticEnvelope = () =>
  sealValue(SEALED.integrityChallengeToken, testId('ich'), 'synthetic-integrity-token');

async function seededSession() {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  const session = await createInquirySession(database.db, environment.id, {
    id: testId('iqse'),
    inquiryId: inquiry.id,
    tokenHash: hashSessionToken(`ovs_${testId('iqse')}`),
    expiresAt: new Date(Date.now() + 60_000),
  });
  return { environmentId: environment.id, inquiryId: inquiry.id, sessionId: session.id };
}

/** A challenge with a token taken for it, sealed for its row, expiring `expiresIn` ms from now. */
async function insertChallenge(
  seeded: Awaited<ReturnType<typeof seededSession>>,
  options: { expiresAt?: Date; createdAt?: Date } = {},
) {
  const id = testId('ich');
  await database.db.execute(
    sql`insert into inquiry_integrity_challenges (id, environment_id, inquiry_id, session_id,
          request_hash, token, created_at, expires_at, consumed_at)
        values (${id}, ${seeded.environmentId}, ${seeded.inquiryId}, ${seeded.sessionId},
          ${'A'.repeat(43)}, ${sealValue(SEALED.integrityChallengeToken, id, 'synthetic-integrity-token')},
          ${(options.createdAt ?? new Date()).toISOString()},
          ${(options.expiresAt ?? new Date(Date.now() + 600_000)).toISOString()}, now())`,
  );
  return id;
}

async function insertVerdict(seeded: Awaited<ReturnType<typeof seededSession>>) {
  await database.db.execute(
    sql`insert into inquiry_integrity_verdicts (environment_id, inquiry_id, provider, verdict, decoded_at)
        values (${seeded.environmentId}, ${seeded.inquiryId}, 'sandbox',
          ${sealJson(SEALED.integrityVerdict, seeded.inquiryId, { 'app-recognition': 'unevaluated' })},
          now())`,
  );
}

const countOf = async (table: string, inquiryId: string) =>
  Number(
    (
      await database.client.query<{ count: string }>(
        `select count(*)::text as count from ${table} where inquiry_id = $1`,
        [inquiryId],
      )
    ).rows[0]?.count,
  );

describe('inquiry_integrity_challenges (C211.3, C221.3)', () => {
  it('keeps a challenge for its inquiry and session, its token sealed for its row', async () => {
    const seeded = await seededSession();
    const id = await insertChallenge(seeded);

    const rows = await database.client.query<{ token: string; request_hash: string }>(
      'select token, request_hash from inquiry_integrity_challenges where id = $1',
      [id],
    );
    const token = rows.rows[0]?.token ?? '';
    expect(token).toMatch(openEnvelope);
    expect(token).not.toContain('synthetic-integrity-token');
    expect(openValue(SEALED.integrityChallengeToken, id, token as Sealed)).toBe(
      'synthetic-integrity-token',
    );
    expect(() =>
      openValue(SEALED.integrityChallengeToken, testId('ich'), token as Sealed),
    ).toThrow();
  });

  it('refuses a malformed id or request hash, an expiry before creation, another inquiry session and a token before its use', async () => {
    const seeded = await seededSession();
    const other = await seededSession();
    const insert = (values: {
      id?: string;
      hash?: string;
      sessionId?: string;
      expiresAt?: string;
      sealed?: string | null;
      consumed?: boolean;
    }) =>
      refused(
        `insert into inquiry_integrity_challenges (id, environment_id, inquiry_id, session_id,
           request_hash, token, expires_at, consumed_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          values.id ?? testId('ich'),
          seeded.environmentId,
          seeded.inquiryId,
          values.sessionId ?? seeded.sessionId,
          values.hash ?? 'B'.repeat(43),
          values.sealed ?? null,
          values.expiresAt ?? new Date(Date.now() + 600_000).toISOString(),
          values.consumed === true ? new Date().toISOString() : null,
        ],
      );

    expect(await insert({})).toBe('accepted');
    expect(await insert({ id: testId('chc') })).toContain('inquiry_integrity_challenges_id_format');
    expect(await insert({ hash: 'B'.repeat(42) })).toContain(
      'inquiry_integrity_challenges_request_hash_format',
    );
    expect(await insert({ hash: `${'B'.repeat(42)}=` })).toContain(
      'inquiry_integrity_challenges_request_hash_format',
    );
    expect(await insert({ expiresAt: new Date(Date.now() - 1_000).toISOString() })).toContain(
      'inquiry_integrity_challenges_expires_after_created',
    );
    expect(await insert({ sessionId: other.sessionId })).toContain(
      'inquiry_integrity_challenges_session_fk',
    );
    expect(await insert({ sealed: syntheticEnvelope() })).toContain(
      'inquiry_integrity_challenges_token_consumed',
    );
    expect(await insert({ sealed: syntheticEnvelope(), consumed: true })).toBe('accepted');
  });
});

describe('inquiry_integrity_verdicts (C211.4, C221.3)', () => {
  it('names the two providers that decode a verdict', () => {
    expect(INTEGRITY_VERDICT_PROVIDERS).toEqual(['play-integrity', 'sandbox']);
  });

  it('keeps one verdict per inquiry, sealed for the inquiry, from a known provider', async () => {
    const seeded = await seededSession();
    await insertVerdict(seeded);

    const rows = await database.client.query<{ verdict: string; provider: string }>(
      'select verdict, provider from inquiry_integrity_verdicts where inquiry_id = $1',
      [seeded.inquiryId],
    );
    const verdict = rows.rows[0]?.verdict ?? '';
    expect(rows.rows[0]?.provider).toBe('sandbox');
    expect(verdict).not.toContain('unevaluated');
    expect(openJson(SEALED.integrityVerdict, seeded.inquiryId, verdict as Sealed)).toEqual({
      'app-recognition': 'unevaluated',
    });
    expect(
      await refused(
        `insert into inquiry_integrity_verdicts (environment_id, inquiry_id, provider, verdict, decoded_at)
         values ($1, $2, 'sandbox', 'ov1.synthetic', now())`,
        [seeded.environmentId, seeded.inquiryId],
      ),
    ).toContain('inquiry_integrity_verdicts_pkey');
    const other = await seededSession();
    expect(
      await refused(
        `insert into inquiry_integrity_verdicts (environment_id, inquiry_id, provider, verdict, decoded_at)
         values ($1, $2, 'safetynet', 'ov1.synthetic', now())`,
        [other.environmentId, other.inquiryId],
      ),
    ).toContain('inquiry_integrity_verdicts_provider_valid');
  });

  it('go with their inquiry when it is deleted', async () => {
    const seeded = await seededSession();
    await insertChallenge(seeded);
    await insertVerdict(seeded);

    await database.client.query('delete from inquiry_sessions where inquiry_id = $1', [
      seeded.inquiryId,
    ]);
    await database.client.query('delete from inquiries where id = $1', [seeded.inquiryId]);

    expect(await countOf('inquiry_integrity_challenges', seeded.inquiryId)).toBe(0);
    expect(await countOf('inquiry_integrity_verdicts', seeded.inquiryId)).toBe(0);
  });
});

describe('the integrity records are encrypted, rewrapped, redacted and retained (C16, C221.3)', () => {
  it('lists the token and the verdict as row-bound encrypted columns, each in the KEK rewrap', () => {
    expect(
      ENCRYPTED_COLUMNS.filter((entry) => entry.table.startsWith('inquiry_integrity_')),
    ).toEqual([
      { table: 'inquiry_integrity_challenges', column: 'token', aad: 'row' },
      { table: 'inquiry_integrity_verdicts', column: 'verdict', aad: 'row' },
    ]);
    expect(REWRAP_TABLES).toEqual(
      expect.arrayContaining(['inquiry_integrity_challenges', 'inquiry_integrity_verdicts']),
    );
  });

  it('rewraps the token and the verdict under the new KEK, each still bound to its row', async () => {
    const oldKek = randomBytes(32);
    const newKek = randomBytes(32);
    setDefaultKeyring(createKeyring(oldKek));
    const seeded = await seededSession();
    const id = await insertChallenge(seeded);
    await insertVerdict(seeded);
    const rotating = createKeyring(newKek, [oldKek, baseKek]);

    for (const table of ['inquiry_integrity_challenges', 'inquiry_integrity_verdicts'] as const) {
      let after: string | null = null;
      do {
        after = (await rewrapTableBatch(database.db, table, { keyring: rotating, after })).next;
      } while (after !== null);
    }

    const newOnly = createKeyring(newKek);
    const token = (
      await database.client.query<{ token: string }>(
        'select token from inquiry_integrity_challenges where id = $1',
        [id],
      )
    ).rows[0]?.token as Sealed;
    const verdict = (
      await database.client.query<{ verdict: string }>(
        'select verdict from inquiry_integrity_verdicts where inquiry_id = $1',
        [seeded.inquiryId],
      )
    ).rows[0]?.verdict as Sealed;
    expect(openValue(SEALED.integrityChallengeToken, id, token, newOnly)).toBe(
      'synthetic-integrity-token',
    );
    expect(openJson(SEALED.integrityVerdict, seeded.inquiryId, verdict, newOnly)).toEqual({
      'app-recognition': 'unevaluated',
    });
    setDefaultKeyring(database.keyring);
  });

  it("deletes an inquiry's challenges and verdict with its redaction, and no other inquiry's", async () => {
    const seeded = await seededSession();
    const other = await seededSession();
    for (const target of [seeded, other]) {
      await insertChallenge(target);
      await insertVerdict(target);
    }

    await redactInquiryRecords(database.db, seeded.environmentId, seeded.inquiryId);

    expect(await countOf('inquiry_integrity_challenges', seeded.inquiryId)).toBe(0);
    expect(await countOf('inquiry_integrity_verdicts', seeded.inquiryId)).toBe(0);
    expect(await countOf('inquiry_integrity_challenges', other.inquiryId)).toBe(1);
    expect(await countOf('inquiry_integrity_verdicts', other.inquiryId)).toBe(1);
  });

  it('deletes a challenge a day past its expiry in the C16 pass, and keeps a younger one', async () => {
    const seeded = await seededSession();
    const now = new Date();
    const hour = 3_600_000;
    const old = await insertChallenge(seeded, {
      createdAt: new Date(now.getTime() - 30 * hour),
      expiresAt: new Date(now.getTime() - 25 * hour),
    });
    const recent = await insertChallenge(seeded, {
      createdAt: new Date(now.getTime() - 3 * hour),
      expiresAt: new Date(now.getTime() - 2 * hour),
    });

    const deleted = await deleteExpiredIntegrityChallenges(database.db, { now });

    expect(deleted).toBeGreaterThanOrEqual(1);
    const left = await database.client.query<{ id: string }>(
      'select id from inquiry_integrity_challenges where id = any($1)',
      [[old, recent]],
    );
    expect(left.rows.map((row) => row.id)).toEqual([recent]);
    expect(INTEGRITY_CHALLENGE_RETENTION_HOURS).toBe(24);
  });

  it('cleans the records a redacted inquiry still holds, once', async () => {
    const seeded = await seededSession();
    await redactInquiryRecords(database.db, seeded.environmentId, seeded.inquiryId);
    // Written after the redaction, as a race would.
    await insertChallenge(seeded);
    await insertVerdict(seeded);

    expect(await deleteIntegrityRecordsOfRedactedInquiries(database.db, { limit: 100 })).toBe(1);

    expect(await countOf('inquiry_integrity_challenges', seeded.inquiryId)).toBe(0);
    expect(await countOf('inquiry_integrity_verdicts', seeded.inquiryId)).toBe(0);
    expect(await deleteIntegrityRecordsOfRedactedInquiries(database.db, { limit: 100 })).toBe(0);
  });
});
