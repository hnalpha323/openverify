/**
 * C211.3, C211.4 (Workflow 10B, `api-integrity`): the integrity repository.
 *
 * - A challenge is written for its inquiry and session; it is read back without any token.
 * - A token is taken once, for the session that asked, before the challenge expires, and only while no
 *   other challenge of the inquiry took one (one token per inquiry); any other case is `invalid`, one
 *   answer for all. The token is sealed for its challenge's row, never stored in clear.
 * - The decode reads the token (left in place for a retry) and takes it (nulled) once it is done.
 * - One verdict per inquiry, sealed for the inquiry's row: a second one is ignored.
 *
 * Every token and verdict is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKeyring, setDefaultKeyring } from '../crypto.js';
import { SEALED } from '../encrypted-columns.js';
import { openJson, type Sealed } from '../sealed.js';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
} from '../testing.js';
import { hashSessionToken } from '../tokens.js';
import { createInquirySession } from './inquiry-sessions.js';
import {
  createInquiryIntegrityChallengeInTx,
  getInquiryIntegrityVerdict,
  inquiryIntegrityTokenTaken,
  readInquiryIntegrityToken,
  storeInquiryIntegrityTokenInTx,
  storeInquiryIntegrityVerdict,
  takeInquiryIntegrityToken,
} from './inquiry-integrity.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase({ keyring: createKeyring(randomBytes(32)) });
}, 120_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await database.close();
});

const NOW = new Date('2026-11-09T12:00:00.000Z');
const HASH = 'A'.repeat(43);
const TOKEN = 'synthetic-integrity-token-0001';

async function seededSession(environmentId?: string, inquiryId?: string) {
  const tenant = environmentId === undefined ? await createTestTenant(database.db) : null;
  const envId = environmentId ?? tenant?.environment.id ?? '';
  const inquiry = inquiryId ?? (await createTestInquiry(database.db, envId)).inquiry.id;
  const session = await createInquirySession(database.db, envId, {
    id: testId('iqse'),
    inquiryId: inquiry,
    tokenHash: hashSessionToken(`ovs_${testId('iqse')}`),
    expiresAt: new Date(NOW.getTime() + 3_600_000),
  });
  return { environmentId: envId, inquiryId: inquiry, sessionId: session.id };
}

async function challenge(
  seeded: Awaited<ReturnType<typeof seededSession>>,
  expiresAt = new Date(NOW.getTime() + 600_000),
) {
  return createInquiryIntegrityChallengeInTx(database.db, seeded.environmentId, {
    id: testId('ich'),
    inquiryId: seeded.inquiryId,
    sessionId: seeded.sessionId,
    requestHash: HASH,
    createdAt: NOW,
    expiresAt,
  });
}

const store = (
  seeded: Awaited<ReturnType<typeof seededSession>>,
  challengeId: string,
  overrides: { sessionId?: string; now?: Date; token?: string } = {},
) =>
  storeInquiryIntegrityTokenInTx(database.db, seeded.environmentId, {
    challengeId,
    sessionId: overrides.sessionId ?? seeded.sessionId,
    token: overrides.token ?? TOKEN,
    now: overrides.now ?? NOW,
  });

describe('the integrity challenges (C211.3)', () => {
  it('writes a challenge for its inquiry and session, without a token', async () => {
    const seeded = await seededSession();

    const written = await challenge(seeded);

    expect(written).toMatchObject({
      environmentId: seeded.environmentId,
      inquiryId: seeded.inquiryId,
      sessionId: seeded.sessionId,
      requestHash: HASH,
      consumedAt: null,
    });
    expect(written.id).toMatch(/^ich_/);
    expect(written).not.toHaveProperty('tokenSealed');
    expect(
      await inquiryIntegrityTokenTaken(database.db, seeded.environmentId, seeded.inquiryId),
    ).toBe(false);
  });

  it('takes a token once, sealed for its row, for the session that asked, before the expiry', async () => {
    const seeded = await seededSession();
    const other = await seededSession(seeded.environmentId, seeded.inquiryId);
    const { id } = await challenge(seeded);

    expect(await store(seeded, id, { sessionId: other.sessionId })).toBe('invalid');
    expect(await store(seeded, id, { now: new Date(NOW.getTime() + 600_000) })).toBe('invalid');
    expect(await store(seeded, testId('ich'))).toBe('invalid');
    expect(await store(seeded, id)).toBe('stored');
    expect(await store(seeded, id)).toBe('invalid');

    const row = await database.client.query<{ token: string; consumed_at: Date | null }>(
      'select token, consumed_at from inquiry_integrity_challenges where id = $1',
      [id],
    );
    expect(row.rows[0]?.token).toMatch(/^ov1\./);
    expect(row.rows[0]?.token).not.toContain(TOKEN);
    expect(row.rows[0]?.consumed_at).not.toBeNull();
    expect(
      await inquiryIntegrityTokenTaken(database.db, seeded.environmentId, seeded.inquiryId),
    ).toBe(true);
  });

  it('takes one token per inquiry, whichever challenge it comes for', async () => {
    const seeded = await seededSession();
    const first = await challenge(seeded);
    const second = await challenge(seeded);

    expect(await store(seeded, first.id)).toBe('stored');
    expect(await store(seeded, second.id)).toBe('invalid');
  });

  it("never takes a token for another environment's challenge", async () => {
    const seeded = await seededSession();
    const elsewhere = await seededSession();
    const { id } = await challenge(seeded);

    expect(
      await storeInquiryIntegrityTokenInTx(database.db, elsewhere.environmentId, {
        challengeId: id,
        sessionId: seeded.sessionId,
        token: TOKEN,
        now: NOW,
      }),
    ).toBe('invalid');
  });
});

describe('the decode reads (C211.4)', () => {
  it('reads the posted token in place, then takes it once', async () => {
    const seeded = await seededSession();
    const { id } = await challenge(seeded);
    expect(await readInquiryIntegrityToken(database.db, seeded.environmentId, id)).toBeNull();
    await store(seeded, id);

    const expected = {
      inquiryId: seeded.inquiryId,
      sessionId: seeded.sessionId,
      requestHash: HASH,
      token: TOKEN,
    };
    expect(await readInquiryIntegrityToken(database.db, seeded.environmentId, id)).toEqual(
      expected,
    );
    expect(await readInquiryIntegrityToken(database.db, seeded.environmentId, id)).toEqual(
      expected,
    );
    expect(await takeInquiryIntegrityToken(database.db, seeded.environmentId, id)).toEqual({
      inquiryId: seeded.inquiryId,
      requestHash: HASH,
      token: TOKEN,
    });
    expect(await takeInquiryIntegrityToken(database.db, seeded.environmentId, id)).toBeNull();
    expect(await readInquiryIntegrityToken(database.db, seeded.environmentId, id)).toBeNull();
    // The challenge stays used, so no second token is taken for the inquiry.
    expect(
      await inquiryIntegrityTokenTaken(database.db, seeded.environmentId, seeded.inquiryId),
    ).toBe(true);
  });

  it('reads nothing for an unknown challenge or another environment', async () => {
    const seeded = await seededSession();
    const elsewhere = await seededSession();
    const { id } = await challenge(seeded);
    await store(seeded, id);

    expect(
      await readInquiryIntegrityToken(database.db, seeded.environmentId, testId('ich')),
    ).toBeNull();
    expect(await readInquiryIntegrityToken(database.db, elsewhere.environmentId, id)).toBeNull();
    expect(await takeInquiryIntegrityToken(database.db, elsewhere.environmentId, id)).toBeNull();
  });
});

describe('the verdicts (C211.4)', () => {
  const projection = { outcome: 'decoded', 'device-recognition': ['MEETS_BASIC_INTEGRITY'] };

  it('keeps one verdict per inquiry, sealed for its row; a second is ignored', async () => {
    const seeded = await seededSession();
    expect(
      await getInquiryIntegrityVerdict(database.db, seeded.environmentId, seeded.inquiryId),
    ).toBeNull();

    await storeInquiryIntegrityVerdict(database.db, seeded.environmentId, {
      inquiryId: seeded.inquiryId,
      provider: 'sandbox',
      verdict: projection,
      decodedAt: NOW,
    });
    await storeInquiryIntegrityVerdict(database.db, seeded.environmentId, {
      inquiryId: seeded.inquiryId,
      provider: 'play-integrity',
      verdict: { outcome: 'failed' },
      decodedAt: new Date(NOW.getTime() + 1_000),
    });

    expect(
      await getInquiryIntegrityVerdict(database.db, seeded.environmentId, seeded.inquiryId),
    ).toEqual({
      inquiryId: seeded.inquiryId,
      provider: 'sandbox',
      verdict: projection,
      decodedAt: NOW,
    });
    const row = await database.client.query<{ verdict: string }>(
      'select verdict from inquiry_integrity_verdicts where inquiry_id = $1',
      [seeded.inquiryId],
    );
    const sealed = row.rows[0]?.verdict ?? '';
    expect(sealed).not.toContain('MEETS_BASIC_INTEGRITY');
    expect(openJson(SEALED.integrityVerdict, seeded.inquiryId, sealed as Sealed)).toEqual(
      projection,
    );
  });

  it("reads no other environment's verdict", async () => {
    const seeded = await seededSession();
    const elsewhere = await seededSession();
    await storeInquiryIntegrityVerdict(database.db, seeded.environmentId, {
      inquiryId: seeded.inquiryId,
      provider: 'sandbox',
      verdict: projection,
      decodedAt: NOW,
    });

    expect(
      await getInquiryIntegrityVerdict(database.db, elsewhere.environmentId, seeded.inquiryId),
    ).toBeNull();
  });
});
