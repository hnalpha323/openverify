/**
 * C53.2, C55: the one-time codes sent for a phone or email verification (`otpc_`). The code itself
 * is never stored: only its HMAC (`code_hmac`, cleared when the challenge leaves `sent`), under the
 * key of the KEK named by `code_key_id` (`otpKey`). The destination is sealed to the row
 * (`otp_challenges.destination#<id>`) and indexed by a blind index
 * (`openverify/otp-destination/v1`, `otpDestinationIndex`) for the per-destination limits.
 *
 * Workflow 5A Stage 1b wrote this file, the reads the jobs and attributes use, redaction and the
 * index rebuild; `api-otp` owns it and adds the writes (send, reserve-then-compare, confirm).
 * Never returned here: the code HMAC; the destination only through
 * {@link openOtpChallengeDestination}.
 */
import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import { assertBlindIndexKey, otpDestinationIndex } from '../blind-index.js';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import { openValue, sealValue } from '../sealed.js';
import { otpChallenges, type OtpChallengeRow } from '../schema.js';
import type { RebuildIndexesOptions, RebuildIndexesResult } from './government-id-extractions.js';
import { firstOrNull, inserted } from './rows.js';

/** Rows per rebuild transaction, as the extractions' rebuild. */
const DEFAULT_REBUILD_BATCH_SIZE = 100;

/** C55.10: how a code is delivered. */
export const OTP_CHANNELS = ['sms', 'email'] as const;
export type OtpChannel = (typeof OTP_CHANNELS)[number];

/** C53.2: a challenge's lifecycle; only one per verification is `sent` at a time. */
export const OTP_CHALLENGE_STATUSES = [
  'sent',
  'confirmed',
  'superseded',
  'expired',
  'exhausted',
  'errored',
] as const;
export type OtpChallengeStatus = (typeof OTP_CHALLENGE_STATUSES)[number];

export interface OtpChallenge {
  id: string;
  environmentId: string;
  verificationId: string;
  inquiryId: string;
  channel: OtpChannel;
  status: OtpChallengeStatus;
  /** Wrong tries against this code (0-5, C55.5). */
  failedAttempts: number;
  /** The KEK the code key derives from (`otpKey`); `null` without a code. */
  codeKeyId: string | null;
  provider: string | null;
  providerMessageId: string | null;
  sentAt: Date;
  expiresAt: Date;
  confirmedAt: Date | null;
  errorCode: string | null;
  /** The destination's blind index; `null` once redacted. */
  destinationIndex: string | null;
  /** Whether a sealed destination is stored (`false` once redacted). */
  hasDestination: boolean;
  redactedAt: Date | null;
}

function toChallenge(row: OtpChallengeRow): OtpChallenge {
  return {
    id: row.id,
    environmentId: row.environmentId,
    verificationId: row.verificationId,
    inquiryId: row.inquiryId,
    channel: row.channel,
    status: row.status,
    failedAttempts: row.failedAttempts,
    codeKeyId: row.codeKeyId,
    provider: row.provider,
    providerMessageId: row.providerMessageId,
    sentAt: row.sentAt,
    expiresAt: row.expiresAt,
    confirmedAt: row.confirmedAt,
    errorCode: row.errorCode,
    destinationIndex: row.destinationIndex,
    hasDestination: row.destinationSealed !== null,
    redactedAt: row.redactedAt,
  };
}

const ofChallenge = (environmentId: string, id: string) =>
  and(eq(otpChallenges.environmentId, environmentId), eq(otpChallenges.id, id));

export async function getOtpChallenge(
  db: Db,
  environmentId: string,
  id: string,
): Promise<OtpChallenge | null> {
  const row = firstOrNull(
    await db.select().from(otpChallenges).where(ofChallenge(environmentId, id)),
  );
  return row === null ? null : toChallenge(row);
}

/** A verification's challenges, newest first. */
export async function listOtpChallenges(
  db: Db,
  environmentId: string,
  verificationId: string,
): Promise<OtpChallenge[]> {
  const rows = await db
    .select()
    .from(otpChallenges)
    .where(
      and(
        eq(otpChallenges.environmentId, environmentId),
        eq(otpChallenges.verificationId, verificationId),
      ),
    )
    .orderBy(desc(otpChallenges.sentAt), desc(otpChallenges.id));
  return rows.map(toChallenge);
}

/** The verification's open (`sent`) challenge, or `null`. */
export async function getSentOtpChallenge(
  db: Db,
  environmentId: string,
  verificationId: string,
): Promise<OtpChallenge | null> {
  const row = firstOrNull(
    await db
      .select()
      .from(otpChallenges)
      .where(
        and(
          eq(otpChallenges.environmentId, environmentId),
          eq(otpChallenges.verificationId, verificationId),
          eq(otpChallenges.status, 'sent'),
        ),
      ),
  );
  return row === null ? null : toChallenge(row);
}

/** C52.8: the challenge's destination, opened; `null` when redacted or not found. PII. */
export async function openOtpChallengeDestination(
  db: Db,
  environmentId: string,
  id: string,
): Promise<string | null> {
  const row = firstOrNull(
    await db
      .select({ destinationSealed: otpChallenges.destinationSealed })
      .from(otpChallenges)
      .where(ofChallenge(environmentId, id)),
  );
  return row?.destinationSealed == null
    ? null
    : openValue(SEALED.otpChallengeDestination, id, row.destinationSealed);
}

/**
 * C53.6: clears the destination, its index, the code HMAC and the provider's message id of these
 * verifications' challenges, and sets `redacted_at` (kept on a re-run); returns the rows matched.
 */
export async function redactOtpChallenges(
  tx: Db,
  environmentId: string,
  verificationIds: readonly string[],
  at: Date,
): Promise<number> {
  if (verificationIds.length === 0) {
    return 0;
  }
  const rows = await tx
    .update(otpChallenges)
    .set({
      destinationSealed: null,
      destinationIndex: null,
      codeHmac: null,
      providerMessageId: null,
      redactedAt: sql`coalesce(${otpChallenges.redactedAt}, ${at.toISOString()}::timestamptz)`,
    })
    .where(
      and(
        eq(otpChallenges.environmentId, environmentId),
        inArray(otpChallenges.verificationId, [...verificationIds]),
      ),
    )
    .returning({ id: otpChallenges.id });
  return rows.length;
}

// The writes (`api-otp`, C55.4-C55.6). Each runs in the caller's transaction, after the C40.6
// locks (the inquiry, re-checked unredacted, then the verification): this file never locks.

/** A code to store as the verification's open (`sent`) challenge (C55.3, C55.4). */
export interface NewOtpChallenge {
  id: string;
  verificationId: string;
  inquiryId: string;
  channel: OtpChannel;
  /** E.164, or the address as the mailer gets it: sealed to the row. PII. */
  destination: string;
  /** `otpDestinationIndex` of the destination. */
  destinationIndex: string;
  /** HMAC-SHA-256 of the code under `otpKey(keyring, codeKeyId)`: 32 bytes. */
  codeHmac: Uint8Array;
  codeKeyId: string;
  /** The sender's id, such as `sandbox`, `twilio` or `smtp`. */
  provider: string;
  sentAt: Date;
  expiresAt: Date;
}

/** What {@link insertOtpChallenge} wrote. */
export interface InsertedOtpChallenge {
  challenge: OtpChallenge;
  /** The open challenge it superseded, if any. */
  supersededId: string | null;
}

/** A reserved attempt (C55.5): the challenge with its attempt counted, and its code HMAC. */
export interface ReservedOtpAttempt {
  challenge: OtpChallenge;
  /** `null` only for a row written without one, which never matches. */
  codeHmac: Uint8Array | null;
}

/** The statuses a challenge leaves `sent` for without being confirmed or errored. */
export type ClosedOtpChallengeStatus = 'expired' | 'exhausted' | 'superseded';

/** C55.5: wrong tries that exhaust one code; equals `OTP_MAX_ATTEMPTS_PER_CODE` in contracts. */
export const OTP_CHALLENGE_MAX_ATTEMPTS = 5;

const isOpen = eq(otpChallenges.status, 'sent');

/**
 * C55.4: supersedes the verification's open challenge (its code HMAC cleared) and stores `input`
 * as `sent`, its destination sealed to the new row.
 */
export async function insertOtpChallenge(
  tx: Db,
  environmentId: string,
  input: NewOtpChallenge,
): Promise<InsertedOtpChallenge> {
  const superseded = await tx
    .update(otpChallenges)
    .set({ status: 'superseded', codeHmac: null })
    .where(
      and(
        eq(otpChallenges.environmentId, environmentId),
        eq(otpChallenges.verificationId, input.verificationId),
        isOpen,
      ),
    )
    .returning({ id: otpChallenges.id });
  const rows = await tx
    .insert(otpChallenges)
    .values({
      id: input.id,
      environmentId,
      verificationId: input.verificationId,
      inquiryId: input.inquiryId,
      channel: input.channel,
      destinationSealed: sealValue(SEALED.otpChallengeDestination, input.id, input.destination),
      destinationIndex: input.destinationIndex,
      codeHmac: Buffer.from(input.codeHmac),
      codeKeyId: input.codeKeyId,
      status: 'sent',
      failedAttempts: 0,
      provider: input.provider,
      sentAt: input.sentAt,
      expiresAt: input.expiresAt,
    })
    .returning();
  return {
    challenge: toChallenge(inserted(rows, 'insertOtpChallenge')),
    supersededId: superseded[0]?.id ?? null,
  };
}

/**
 * C55.5 (P09): counts one attempt against the open challenge `id` before its code is compared,
 * unless it is no longer `sent`, already took {@link OTP_CHALLENGE_MAX_ATTEMPTS} or expired at
 * `now`; `null` then. A match releases the attempt ({@link confirmOtpChallenge}).
 */
export async function reserveOtpChallengeAttempt(
  tx: Db,
  environmentId: string,
  id: string,
  now: Date,
): Promise<ReservedOtpAttempt | null> {
  const row = firstOrNull(
    await tx
      .update(otpChallenges)
      .set({ failedAttempts: sql`${otpChallenges.failedAttempts} + 1` })
      .where(
        and(
          ofChallenge(environmentId, id),
          isOpen,
          lt(otpChallenges.failedAttempts, OTP_CHALLENGE_MAX_ATTEMPTS),
          gt(otpChallenges.expiresAt, now),
        ),
      )
      .returning(),
  );
  return row === null
    ? null
    : {
        challenge: toChallenge(row),
        // `pg` reads a `bytea` as a Buffer, PGlite as a Uint8Array: hand back plain bytes.
        codeHmac: row.codeHmac === null ? null : new Uint8Array(row.codeHmac),
      };
}

/**
 * C55.5: a matching code confirms its open challenge at `at`, releases the attempt its compare
 * reserved and clears the code HMAC (C53.5); `null` when it is no longer open.
 */
export async function confirmOtpChallenge(
  tx: Db,
  environmentId: string,
  id: string,
  at: Date,
): Promise<OtpChallenge | null> {
  const row = firstOrNull(
    await tx
      .update(otpChallenges)
      .set({
        status: 'confirmed',
        confirmedAt: at,
        codeHmac: null,
        failedAttempts: sql`greatest(${otpChallenges.failedAttempts} - 1, 0)`,
      })
      .where(and(ofChallenge(environmentId, id), isOpen))
      .returning(),
  );
  return row === null ? null : toChallenge(row);
}

/**
 * Moves the open challenge `id` to `status`, its code HMAC cleared (C53.5); `null` when it is no
 * longer open.
 */
export async function closeOtpChallenge(
  tx: Db,
  environmentId: string,
  id: string,
  status: ClosedOtpChallengeStatus,
): Promise<OtpChallenge | null> {
  const row = firstOrNull(
    await tx
      .update(otpChallenges)
      .set({ status, codeHmac: null })
      .where(and(ofChallenge(environmentId, id), isOpen))
      .returning(),
  );
  return row === null ? null : toChallenge(row);
}

/**
 * Closes the verification's open challenge, if any, as `status` (a cancel or a submit, C54.1);
 * returns how many it closed.
 */
export async function closeOpenOtpChallenges(
  tx: Db,
  environmentId: string,
  verificationId: string,
  status: ClosedOtpChallengeStatus,
): Promise<number> {
  const rows = await tx
    .update(otpChallenges)
    .set({ status, codeHmac: null })
    .where(
      and(
        eq(otpChallenges.environmentId, environmentId),
        eq(otpChallenges.verificationId, verificationId),
        isOpen,
      ),
    )
    .returning({ id: otpChallenges.id });
  return rows.length;
}

/**
 * C55.6: records the provider's message id of a delivered challenge that is still open and
 * unredacted; false when it was superseded, confirmed or redacted meanwhile.
 */
export async function recordOtpDelivery(
  tx: Db,
  environmentId: string,
  id: string,
  providerMessageId: string | null,
): Promise<boolean> {
  const rows = await tx
    .update(otpChallenges)
    .set({ providerMessageId })
    .where(and(ofChallenge(environmentId, id), isOpen, isNull(otpChallenges.redactedAt)))
    .returning({ id: otpChallenges.id });
  return rows.length > 0;
}

/**
 * C55.6: a delivery that failed moves its still open challenge to `errored` with `errorCode` (a
 * code, never a provider body), its code HMAC cleared; false when it is no longer open.
 */
export async function markOtpChallengeErrored(
  tx: Db,
  environmentId: string,
  id: string,
  errorCode: string,
): Promise<boolean> {
  const rows = await tx
    .update(otpChallenges)
    .set({ status: 'errored', errorCode, codeHmac: null })
    .where(and(ofChallenge(environmentId, id), isOpen))
    .returning({ id: otpChallenges.id });
  return rows.length > 0;
}

/**
 * C53.4 `blind-index:rebuild`: recomputes the destination index of every unredacted challenge, in
 * every environment, under `key`, from its sealed destination. Each batch runs in its own
 * transaction and locks its rows. Neither destinations nor indexes are logged or returned.
 * @throws {BlindIndexKeyError} when the key is not 32 bytes, before anything is read.
 */
export async function rebuildOtpDestinationIndexes(
  db: Db,
  key: Uint8Array,
  options: RebuildIndexesOptions = {},
): Promise<RebuildIndexesResult> {
  assertBlindIndexKey(key);
  const batchSize = options.batchSize ?? DEFAULT_REBUILD_BATCH_SIZE;
  const t = otpChallenges;
  let after = '';
  let scanned = 0;
  let updated = 0;
  for (;;) {
    const batch = await db.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: t.id,
          environmentId: t.environmentId,
          channel: t.channel,
          destinationSealed: t.destinationSealed,
          destinationIndex: t.destinationIndex,
        })
        .from(t)
        .where(and(isNull(t.redactedAt), gt(t.id, after)))
        .orderBy(asc(t.id))
        .limit(batchSize)
        .for('update');
      let changed = 0;
      for (const row of rows) {
        if (row.destinationSealed === null) {
          continue;
        }
        const index = otpDestinationIndex(key, {
          environmentId: row.environmentId,
          channel: row.channel,
          destination: openValue(SEALED.otpChallengeDestination, row.id, row.destinationSealed),
        });
        if (index !== row.destinationIndex) {
          await tx.update(t).set({ destinationIndex: index }).where(eq(t.id, row.id));
          changed += 1;
        }
      }
      return { count: rows.length, changed, last: rows.at(-1)?.id };
    });
    scanned += batch.count;
    updated += batch.changed;
    if (batch.last === undefined || batch.count < batchSize) {
      return { scanned, updated };
    }
    after = batch.last;
  }
}
