/**
 * C53.2, C55.5, C55.6: per phone or email verification, its accepted sends, its wrong entries
 * across every code, and whether a limit refused the user (after which submit is allowed and the
 * check answers `otp_delivery_unavailable`). No PII: counts and a reason.
 *
 * Workflow 5A Stage 1b wrote this file and the read the jobs use; `api-otp` owns it and adds the
 * writes (counted under the C53.6 lock order).
 */
import { and, eq, lt, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { otpVerificationStates, type OtpVerificationStateRow } from '../schema.js';
import { firstOrNull, inserted } from './rows.js';

/** C55.6: what refused the user. */
export const OTP_LIMITED_REASONS = [
  'destination',
  'inquiry',
  'guess',
  'environment',
  'store_unavailable',
] as const;
export type OtpLimitedReason = (typeof OTP_LIMITED_REASONS)[number];

export interface OtpVerificationState {
  environmentId: string;
  verificationId: string;
  inquiryId: string;
  /** Accepted sends; an errored send does not count (C55.6). */
  sends: number;
  /** Wrong entries across the verification's codes (C55.5). */
  wrongEntries: number;
  limitedAt: Date | null;
  limitedReason: OtpLimitedReason | null;
  updatedAt: Date;
}

/** The verification and inquiry a state row belongs to. */
export interface OtpStateOwner {
  verificationId: string;
  inquiryId: string;
}

const ofVerification = (environmentId: string, verificationId: string) =>
  and(
    eq(otpVerificationStates.environmentId, environmentId),
    eq(otpVerificationStates.verificationId, verificationId),
  );

function toState(row: OtpVerificationStateRow): OtpVerificationState {
  return {
    environmentId: row.environmentId,
    verificationId: row.verificationId,
    inquiryId: row.inquiryId,
    sends: row.sends,
    wrongEntries: row.wrongEntries,
    limitedAt: row.limitedAt,
    limitedReason: row.limitedReason ?? null,
    updatedAt: row.updatedAt,
  };
}

/**
 * C55.6: counts one send before delivery, creating the row with the first; `null` when
 * `maxSends` were already counted. Call under the C40.6 locks.
 */
export async function reserveOtpSend(
  tx: Db,
  environmentId: string,
  owner: OtpStateOwner,
  maxSends: number,
): Promise<OtpVerificationState | null> {
  const row = firstOrNull(
    await tx
      .insert(otpVerificationStates)
      .values({ environmentId, ...owner, sends: 1 })
      .onConflictDoUpdate({
        target: otpVerificationStates.verificationId,
        set: { sends: sql`${otpVerificationStates.sends} + 1` },
        setWhere: lt(otpVerificationStates.sends, maxSends),
      })
      .returning(),
  );
  return row === null ? null : toState(row);
}

/**
 * C55.6: an errored send does not count, so the send {@link reserveOtpSend} counted for it is
 * released (never below zero); `null` when the verification has no state.
 */
export async function releaseOtpSend(
  tx: Db,
  environmentId: string,
  verificationId: string,
): Promise<OtpVerificationState | null> {
  const row = firstOrNull(
    await tx
      .update(otpVerificationStates)
      .set({ sends: sql`greatest(${otpVerificationStates.sends} - 1, 0)` })
      .where(ofVerification(environmentId, verificationId))
      .returning(),
  );
  return row === null ? null : toState(row);
}

/**
 * C55.5: counts one wrong entry across the verification's codes, at most `maxWrongEntries` (a
 * new code never resets it); returns the state.
 */
export async function recordOtpWrongEntry(
  tx: Db,
  environmentId: string,
  owner: OtpStateOwner,
  maxWrongEntries: number,
): Promise<OtpVerificationState> {
  const rows = await tx
    .insert(otpVerificationStates)
    .values({ environmentId, ...owner, wrongEntries: 1 })
    .onConflictDoUpdate({
      target: otpVerificationStates.verificationId,
      set: {
        wrongEntries: sql`least(${otpVerificationStates.wrongEntries} + 1, ${maxWrongEntries})`,
      },
    })
    .returning();
  return toState(inserted(rows, 'recordOtpWrongEntry'));
}

/**
 * C55.6: a limit (or its store) refused the user at `at`, for `reason`; the latest refusal is
 * kept. From then on the user may submit, and the check answers `otp_delivery_unavailable`.
 */
export async function recordOtpLimited(
  tx: Db,
  environmentId: string,
  owner: OtpStateOwner,
  reason: OtpLimitedReason,
  at: Date,
): Promise<OtpVerificationState> {
  const rows = await tx
    .insert(otpVerificationStates)
    .values({ environmentId, ...owner, limitedAt: at, limitedReason: reason })
    .onConflictDoUpdate({
      target: otpVerificationStates.verificationId,
      set: { limitedAt: at, limitedReason: reason },
    })
    .returning();
  return toState(inserted(rows, 'recordOtpLimited'));
}

/**
 * C55.7: serializes the environment's SMS budget trip record for the rest of `tx` (a transaction
 * advisory lock), so at most one `environment.otp-sms-budget-tripped` entry is written per hour
 * across API instances.
 */
export async function lockOtpSmsBudget(tx: Db, environmentId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`openverify/otp-sms-budget/${environmentId}`}, 0))`,
  );
}

/** The verification's OTP state; `null` before its first send or in another environment. */
export async function getOtpVerificationState(
  db: Db,
  environmentId: string,
  verificationId: string,
): Promise<OtpVerificationState | null> {
  const row = firstOrNull(
    await db
      .select()
      .from(otpVerificationStates)
      .where(ofVerification(environmentId, verificationId)),
  );
  return row === null ? null : toState(row);
}
