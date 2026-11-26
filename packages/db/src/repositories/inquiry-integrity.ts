/**
 * Workflow 10B (C211.3, C211.4): the integrity challenges and verdicts. Owner: `api-integrity`; the
 * names frozen by `foundation-10b` (Stage 1b (I)). The token is sealed for its challenge's row
 * (`SEALED.integrityChallengeToken`) and the verdict's fixed projection for its inquiry's row
 * (`SEALED.integrityVerdict`); nothing else of either is stored. A builder may widen a stub's
 * signature while nothing calls it.
 *
 * The deletes are not stubs: the inquiry's redaction deletes both tables' rows
 * (`redaction.ts`), and the C16 pass deletes expired challenges and the records of redacted
 * inquiries (`retention.ts`).
 */
import type { IntegrityVerdictProvider } from '@openverify/core';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import {
  inquiryIntegrityChallenges,
  inquiryIntegrityVerdicts,
  type InquiryIntegrityChallengeRow,
} from '../schema.js';
import { openJson, openValue, sealJson, sealValue } from '../sealed.js';

/** A challenge as stored, without its sealed token. */
export type InquiryIntegrityChallenge = Omit<InquiryIntegrityChallengeRow, 'tokenSealed'>;

/** C211.3: one challenge for the inquiry's token, taken by the session that asked for it. */
export interface NewInquiryIntegrityChallenge {
  /** `ich_` plus a ULID. */
  id: string;
  inquiryId: string;
  sessionId: string;
  /** base64url (43 characters) of the SHA-256 the device's token is bound to. */
  requestHash: string;
  /** When the challenge was drawn (the API's clock). */
  createdAt: Date;
  expiresAt: Date;
}

const challengeColumns = {
  id: inquiryIntegrityChallenges.id,
  environmentId: inquiryIntegrityChallenges.environmentId,
  inquiryId: inquiryIntegrityChallenges.inquiryId,
  sessionId: inquiryIntegrityChallenges.sessionId,
  requestHash: inquiryIntegrityChallenges.requestHash,
  createdAt: inquiryIntegrityChallenges.createdAt,
  expiresAt: inquiryIntegrityChallenges.expiresAt,
  consumedAt: inquiryIntegrityChallenges.consumedAt,
  // C251.1 (Workflow 11B Stage 1b (P)): when the integrity-decode cap admitted its job.
  admittedAt: inquiryIntegrityChallenges.admittedAt,
};

/** Writes a challenge. */
export async function createInquiryIntegrityChallengeInTx(
  tx: Db,
  environmentId: string,
  challenge: NewInquiryIntegrityChallenge,
): Promise<InquiryIntegrityChallenge> {
  const [row] = await tx
    .insert(inquiryIntegrityChallenges)
    .values({ ...challenge, environmentId })
    .returning(challengeColumns);
  if (row === undefined) {
    throw new Error('The integrity challenge was not written.');
  }
  return row;
}

/**
 * C211.3: takes the session's open challenge `challengeId` for `token` at `now`: sealed for the
 * row and `consumed_at` set, once, and only while no challenge of the inquiry took a token (one per
 * inquiry; the caller holds the inquiry's lock). `invalid` for a challenge that is unknown, another
 * environment's or session's, used or expired (one answer for all, `integrity_challenge_invalid`).
 */
export async function storeInquiryIntegrityTokenInTx(
  tx: Db,
  environmentId: string,
  input: { challengeId: string; sessionId: string; token: string; now: Date },
): Promise<'stored' | 'invalid'> {
  const { challengeId, sessionId, token, now } = input;
  const result = await tx.execute(sql`
    update ${inquiryIntegrityChallenges} as outer_challenge
       set token = ${sealValue(SEALED.integrityChallengeToken, challengeId, token)},
           consumed_at = ${now.toISOString()}
     where outer_challenge.environment_id = ${environmentId}
       and outer_challenge.id = ${challengeId}
       and outer_challenge.session_id = ${sessionId}
       and outer_challenge.consumed_at is null
       and outer_challenge.expires_at > ${now.toISOString()}
       and not exists (
         select 1 from ${inquiryIntegrityChallenges} as taken
          where taken.environment_id = outer_challenge.environment_id
            and taken.inquiry_id = outer_challenge.inquiry_id
            and taken.consumed_at is not null)
    returning outer_challenge.id`);
  return (result as { rows: { id: string }[] }).rows.length === 1 ? 'stored' : 'invalid';
}

/** A posted token as the decode reads it: its challenge's inquiry, session and request hash. */
export interface InquiryIntegrityToken {
  inquiryId: string;
  sessionId: string;
  requestHash: string;
  token: string;
}

async function tokenRow(db: Db, environmentId: string, challengeId: string, lock: boolean) {
  const query = db
    .select({
      inquiryId: inquiryIntegrityChallenges.inquiryId,
      sessionId: inquiryIntegrityChallenges.sessionId,
      requestHash: inquiryIntegrityChallenges.requestHash,
      sealed: inquiryIntegrityChallenges.tokenSealed,
    })
    .from(inquiryIntegrityChallenges)
    .where(
      and(
        eq(inquiryIntegrityChallenges.environmentId, environmentId),
        eq(inquiryIntegrityChallenges.id, challengeId),
        isNotNull(inquiryIntegrityChallenges.tokenSealed),
      ),
    );
  const [row] = lock ? await query.for('update') : await query;
  if (row?.sealed == null) {
    return null;
  }
  return {
    inquiryId: row.inquiryId,
    sessionId: row.sessionId,
    requestHash: row.requestHash,
    token: openValue(SEALED.integrityChallengeToken, challengeId, row.sealed),
  };
}

/**
 * The `integrity-decode` job's first read: the posted token (opened) with its challenge's facts,
 * left in place so a decode that fails for a while can be retried; `null` when there is none.
 */
export async function readInquiryIntegrityToken(
  db: Db,
  environmentId: string,
  challengeId: string,
): Promise<InquiryIntegrityToken | null> {
  return tokenRow(db, environmentId, challengeId, false);
}

/**
 * The `integrity-decode` job's last read: the challenge's inquiry, request hash and token (opened),
 * and the token nulled in the same statement's transaction, so it is read once; `null` when there is
 * none. The challenge stays used.
 */
export async function takeInquiryIntegrityToken(
  db: Db,
  environmentId: string,
  challengeId: string,
): Promise<{ inquiryId: string; requestHash: string; token: string } | null> {
  return db.transaction(async (tx) => {
    const row = await tokenRow(tx, environmentId, challengeId, true);
    if (row === null) {
      return null;
    }
    await tx
      .update(inquiryIntegrityChallenges)
      .set({ tokenSealed: null })
      .where(
        and(
          eq(inquiryIntegrityChallenges.environmentId, environmentId),
          eq(inquiryIntegrityChallenges.id, challengeId),
        ),
      );
    return { inquiryId: row.inquiryId, requestHash: row.requestHash, token: row.token };
  });
}

/** C211.3: whether a token was ever taken for one of the inquiry's challenges (one per inquiry). */
export async function inquiryIntegrityTokenTaken(
  db: Db,
  environmentId: string,
  inquiryId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: inquiryIntegrityChallenges.id })
    .from(inquiryIntegrityChallenges)
    .where(
      and(
        eq(inquiryIntegrityChallenges.environmentId, environmentId),
        eq(inquiryIntegrityChallenges.inquiryId, inquiryId),
        isNotNull(inquiryIntegrityChallenges.consumedAt),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** C211.4: a verdict's fixed projection, as `api-integrity` defines it; never another member. */
export type InquiryIntegrityVerdictProjection = Readonly<Record<string, unknown>>;

/** A verdict as read: the provider, the projection (opened) and when it was decoded. */
export interface InquiryIntegrityVerdict {
  inquiryId: string;
  provider: IntegrityVerdictProvider;
  verdict: InquiryIntegrityVerdictProjection;
  decodedAt: Date;
}

/** Writes the inquiry's verdict, sealed for its row; one per inquiry (a second is ignored). */
export async function storeInquiryIntegrityVerdict(
  db: Db,
  environmentId: string,
  verdict: InquiryIntegrityVerdict,
): Promise<void> {
  await db
    .insert(inquiryIntegrityVerdicts)
    .values({
      environmentId,
      inquiryId: verdict.inquiryId,
      provider: verdict.provider,
      verdictSealed: sealJson(SEALED.integrityVerdict, verdict.inquiryId, verdict.verdict),
      decodedAt: verdict.decodedAt,
    })
    .onConflictDoNothing({ target: inquiryIntegrityVerdicts.inquiryId });
}

/** The inquiry's verdict, or `null` when none was decoded. */
export async function getInquiryIntegrityVerdict(
  db: Db,
  environmentId: string,
  inquiryId: string,
): Promise<InquiryIntegrityVerdict | null> {
  const [row] = await db
    .select()
    .from(inquiryIntegrityVerdicts)
    .where(
      and(
        eq(inquiryIntegrityVerdicts.environmentId, environmentId),
        eq(inquiryIntegrityVerdicts.inquiryId, inquiryId),
      ),
    );
  if (row === undefined) {
    return null;
  }
  return {
    inquiryId: row.inquiryId,
    provider: row.provider,
    verdict: openJson(
      SEALED.integrityVerdict,
      row.inquiryId,
      row.verdictSealed,
    ) as InquiryIntegrityVerdictProjection,
    decodedAt: row.decodedAt,
  };
}
