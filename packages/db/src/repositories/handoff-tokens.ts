/**
 * C96.2, C96.3, C96.7 (Workflow 7A): the device handoff tokens, the handoff state per inquiry and
 * step, and the phone's session a redemption creates. Owner: `flow-handoff`; `foundation-7a`
 * (Stage 1b (H)) froze the first eight signatures.
 *
 * - A token is stored as its SHA-256 only (`hashSessionToken` of the contracts' `ovh_` token, like
 *   every C1/C9 token), single use, and lives for its method's TTL (never past the inquiry's
 *   `expires-at`, the caller's rule). Issuing a new one revokes the issuing session's live one
 *   first, in the same transaction (`handoff_tokens_live_per_session_key`).
 * - Redeeming, revoking and declining are conditional updates of a live token (neither redeemed,
 *   revoked nor expired), so of two racing calls one wins and the other reads `null`.
 * - A confirmation code is kept only as SHA-256 over the token and the code
 *   (`confirmationCodeHash`); the caller revokes the token at the fifth wrong code (C96.5).
 * - The state of a handoff step is kept per inquiry and step, not per session (V05).
 * - The phone's session carries `device_handoff_method`, `handoff_from_session_id` and
 *   `handoff_redeemed_at` together; a rejection sets `handoff_rejected_at` once, and cancels the
 *   session while it is active (P15, V02).
 *
 * Nothing here holds or logs a token, a code or a destination.
 */
import { and, desc, eq, gt, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import {
  handoffTokens,
  inquiryHandoffSteps,
  inquirySessions,
  otpChallenges,
  verifications,
  type HANDOFF_STATE_VALUES,
  type HandoffTokenRow,
  type InquiryHandoffStepRow,
  type InquirySession,
} from '../schema.js';
import type { HANDOFF_METHOD_VALUES } from '../tables/inquiries.js';
import { toInquirySession } from './inquiry-sessions.js';
import { firstOrNull, inserted } from './rows.js';

/** `qr`, `email` or `sms` (C96.1). */
export type HandoffMethodValue = (typeof HANDOFF_METHOD_VALUES)[number];
/** The state of an inquiry's handoff step (C96.3, V05). */
export type HandoffStepState = (typeof HANDOFF_STATE_VALUES)[number];

/** A handoff token as the repositories return it: digests only, never the token or the code. */
export type HandoffToken = HandoffTokenRow;

/** What issuing a token writes (C96.3 `POST /flow/handoffs`). */
export interface NewHandoffToken {
  /** `hnd_…`, the row's id, answered to the issuing session. */
  id: string;
  inquiryId: string;
  issuingSessionId: string;
  stepId: string;
  method: HandoffMethodValue;
  /** SHA-256 of the `ovh_` token, lowercase hex. */
  tokenHash: string;
  /** SHA-256 over the token and the code, lowercase hex; `null` without a code. */
  confirmationCodeHash: string | null;
  /** V16: `false` for an email or SMS to a destination the inquiry never confirmed. */
  destinationConfirmed: boolean;
  expiresAt: Date;
  at: Date;
}

/** The redemption of a token by the phone's new session (C96.3 `POST /flow/handoffs/redeem`). */
export interface HandoffRedemption {
  tokenId: string;
  redeemedSessionId: string;
  at: Date;
}

/** One handoff step's state, as `GET /flow/session` `handoff` serves it. */
export interface InquiryHandoffStep {
  stepId: string;
  state: HandoffStepState;
  updatedAt: Date;
}

const ofToken = (environmentId: string, id: string) =>
  and(eq(handoffTokens.environmentId, environmentId), eq(handoffTokens.id, id));

/** Neither redeemed nor revoked, and not past its lifetime at `at`. */
const liveAt = (at: Date) =>
  and(
    isNull(handoffTokens.redeemedAt),
    isNull(handoffTokens.revokedAt),
    gt(handoffTokens.expiresAt, at),
  );

/**
 * Revokes the issuing session's live token, if any, and writes the new one, in `tx` (C96.2). A
 * token past its lifetime is revoked too, so the session keeps one unredeemed, unrevoked row.
 */
export async function issueHandoffToken(
  tx: Db,
  environmentId: string,
  token: NewHandoffToken,
): Promise<HandoffToken> {
  await tx
    .update(handoffTokens)
    .set({ revokedAt: token.at })
    .where(
      and(
        eq(handoffTokens.environmentId, environmentId),
        eq(handoffTokens.issuingSessionId, token.issuingSessionId),
        isNull(handoffTokens.redeemedAt),
        isNull(handoffTokens.revokedAt),
      ),
    );
  const rows = await tx
    .insert(handoffTokens)
    .values({
      id: token.id,
      environmentId,
      inquiryId: token.inquiryId,
      issuingSessionId: token.issuingSessionId,
      stepId: token.stepId,
      method: token.method,
      tokenHash: token.tokenHash,
      confirmationCodeHash: token.confirmationCodeHash,
      destinationConfirmed: token.destinationConfirmed,
      expiresAt: token.expiresAt,
      createdAt: token.at,
    })
    .returning();
  return inserted(rows, 'issueHandoffToken');
}

/**
 * The token of `tokenHash` in any state, across environments, because the unauthenticated preview,
 * decline and redeem learn the environment from it; the caller compares in constant time and
 * answers every failure with the one uniform 410 (P28).
 */
export async function findHandoffTokenByHash(
  db: Db,
  tokenHash: string,
): Promise<HandoffToken | null> {
  return firstOrNull(
    await db.select().from(handoffTokens).where(eq(handoffTokens.tokenHash, tokenHash)).limit(1),
  );
}

/** Takes the token's row lock in `tx`, `null` when it is not here. */
export async function lockHandoffToken(
  tx: Db,
  environmentId: string,
  id: string,
): Promise<HandoffToken | null> {
  return firstOrNull(
    await tx.select().from(handoffTokens).where(ofToken(environmentId, id)).limit(1).for('update'),
  );
}

/** Marks a live token redeemed by the new session; `null` unless it was live (one race wins). */
export async function markHandoffTokenRedeemed(
  tx: Db,
  environmentId: string,
  redemption: HandoffRedemption,
): Promise<HandoffToken | null> {
  return firstOrNull(
    await tx
      .update(handoffTokens)
      .set({ redeemedAt: redemption.at, redeemedSessionId: redemption.redeemedSessionId })
      .where(and(ofToken(environmentId, redemption.tokenId), liveAt(redemption.at)))
      .returning(),
  );
}

/**
 * Revokes a live token: a decline (with `declined`), the fifth wrong code, or a continue-here.
 * `null` unless it was live.
 */
export async function revokeHandoffToken(
  tx: Db,
  environmentId: string,
  id: string,
  options: { at: Date; declined?: boolean },
): Promise<HandoffToken | null> {
  return firstOrNull(
    await tx
      .update(handoffTokens)
      .set({
        revokedAt: options.at,
        ...(options.declined === true ? { declinedAt: options.at } : {}),
      })
      .where(and(ofToken(environmentId, id), liveAt(options.at)))
      .returning(),
  );
}

/** Counts a wrong confirmation code; answers the attempts so far (0 for a token not here). */
export async function recordHandoffCodeAttempt(
  tx: Db,
  environmentId: string,
  id: string,
): Promise<number> {
  const row = firstOrNull(
    await tx
      .update(handoffTokens)
      .set({ codeAttempts: sql`${handoffTokens.codeAttempts} + 1` })
      .where(ofToken(environmentId, id))
      .returning({ codeAttempts: handoffTokens.codeAttempts }),
  );
  return row?.codeAttempts ?? 0;
}

const stepOf = (row: InquiryHandoffStepRow): InquiryHandoffStep => ({
  stepId: row.stepId,
  state: row.state,
  updatedAt: row.updatedAt,
});

/** The handoff steps of an inquiry with a recorded state, by step id (V05). */
export async function listInquiryHandoffSteps(
  db: Db,
  environmentId: string,
  inquiryId: string,
): Promise<InquiryHandoffStep[]> {
  const rows = await db
    .select()
    .from(inquiryHandoffSteps)
    .where(
      and(
        eq(inquiryHandoffSteps.environmentId, environmentId),
        eq(inquiryHandoffSteps.inquiryId, inquiryId),
      ),
    )
    .orderBy(inquiryHandoffSteps.stepId);
  return rows.map(stepOf);
}

/** Sets (or first records) the state of an inquiry's handoff step, in `tx`. */
export async function setInquiryHandoffStepState(
  tx: Db,
  environmentId: string,
  step: { inquiryId: string; stepId: string; state: HandoffStepState; at: Date },
): Promise<InquiryHandoffStep> {
  const rows = await tx
    .insert(inquiryHandoffSteps)
    .values({
      environmentId,
      inquiryId: step.inquiryId,
      stepId: step.stepId,
      state: step.state,
      createdAt: step.at,
      updatedAt: step.at,
    })
    .onConflictDoUpdate({
      target: [
        inquiryHandoffSteps.environmentId,
        inquiryHandoffSteps.inquiryId,
        inquiryHandoffSteps.stepId,
      ],
      set: { state: step.state, updatedAt: step.at },
    })
    .returning();
  return stepOf(inserted(rows, 'setInquiryHandoffStepState'));
}

/** The phone's new session a redemption writes (C96.3, C96.4). */
export interface NewHandoffSession {
  id: string;
  inquiryId: string;
  /** `hashSessionToken(token)` of the new `ovs_` token. */
  tokenHash: string;
  expiresAt: Date;
  method: HandoffMethodValue;
  /** The issuing (desktop) session. */
  fromSessionId: string;
  redeemedAt: Date;
}

/** Creates the phone's session with its three handoff fields set together (C96.3), in `tx`. */
export async function createHandoffSession(
  tx: Db,
  environmentId: string,
  session: NewHandoffSession,
): Promise<InquirySession> {
  const rows = await tx
    .insert(inquirySessions)
    .values({
      id: session.id,
      environmentId,
      inquiryId: session.inquiryId,
      tokenHash: session.tokenHash,
      expiresAt: session.expiresAt,
      deviceHandoffMethod: session.method,
      handoffFromSessionId: session.fromSessionId,
      handoffRedeemedAt: session.redeemedAt,
    })
    .returning();
  return toInquirySession(inserted(rows, 'createHandoffSession'));
}

/**
 * F13: the session a redemption created from `issuingSessionId` that is still active at `now`
 * (not ended, revoked, past its TTL or rejected), newest redemption first; `null` without one.
 */
export async function findActiveHandoffSession(
  db: Db,
  environmentId: string,
  issuingSessionId: string,
  now: Date,
): Promise<InquirySession | null> {
  const row = firstOrNull(
    await db
      .select()
      .from(inquirySessions)
      .where(
        and(
          eq(inquirySessions.environmentId, environmentId),
          eq(inquirySessions.handoffFromSessionId, issuingSessionId),
          eq(inquirySessions.status, 'active'),
          isNull(inquirySessions.revokedAt),
          isNull(inquirySessions.handoffRejectedAt),
          gt(inquirySessions.expiresAt, now),
        ),
      )
      .orderBy(desc(inquirySessions.handoffRedeemedAt), desc(inquirySessions.id))
      .limit(1),
  );
  return row === null ? null : toInquirySession(row);
}

/** The newest token of an inquiry's handoff step, in any state. */
export async function latestHandoffToken(
  db: Db,
  environmentId: string,
  step: { inquiryId: string; stepId: string },
): Promise<HandoffToken | null> {
  return firstOrNull(
    await db
      .select()
      .from(handoffTokens)
      .where(
        and(
          eq(handoffTokens.environmentId, environmentId),
          eq(handoffTokens.inquiryId, step.inquiryId),
          eq(handoffTokens.stepId, step.stepId),
        ),
      )
      .orderBy(desc(handoffTokens.createdAt), desc(handoffTokens.id))
      .limit(1),
  );
}

/** What a rejection did to the phone's session (C96.3, V02). */
export interface RejectedHandoffSession {
  session: InquirySession;
  /** Whether the session was active and is now `canceled` (its `inquiry-session.canceled`). */
  canceled: boolean;
}

/**
 * C96.3 (P15, V02): marks a handoff session rejected (`handoff_rejected_at`) and, when it is still
 * active, cancels it, in `tx`; `null` for a session no handoff created or one already rejected.
 */
export async function rejectHandoffSession(
  tx: Db,
  environmentId: string,
  sessionId: string,
  at: Date,
): Promise<RejectedHandoffSession | null> {
  const before = firstOrNull(
    await tx
      .select({ status: inquirySessions.status })
      .from(inquirySessions)
      .where(
        and(
          eq(inquirySessions.environmentId, environmentId),
          eq(inquirySessions.id, sessionId),
          isNotNull(inquirySessions.handoffFromSessionId),
          isNull(inquirySessions.handoffRejectedAt),
        ),
      )
      .limit(1)
      .for('update'),
  );
  if (before === null) {
    return null;
  }
  const canceled = before.status === 'active';
  const rows = await tx
    .update(inquirySessions)
    .set(
      canceled
        ? { handoffRejectedAt: at, status: 'canceled', canceledAt: at, revokedAt: at }
        : { handoffRejectedAt: at },
    )
    .where(and(eq(inquirySessions.environmentId, environmentId), eq(inquirySessions.id, sessionId)))
    .returning();
  return { session: toInquirySession(inserted(rows, 'rejectHandoffSession')), canceled };
}

/** C96.3 (V02): marks the given verifications `from_rejected_handoff`; answers the ids it marked. */
export async function markVerificationsFromRejectedHandoff(
  tx: Db,
  environmentId: string,
  verificationIds: readonly string[],
): Promise<string[]> {
  if (verificationIds.length === 0) {
    return [];
  }
  const rows = await tx
    .update(verifications)
    .set({ fromRejectedHandoff: true })
    .where(
      and(
        eq(verifications.environmentId, environmentId),
        inArray(verifications.id, [...verificationIds]),
      ),
    )
    .returning({ id: verifications.id });
  return rows.map((row) => row.id);
}

/** C96.3 (V02): whether any verification of the inquiry came from a rejected handoff. */
export async function hasRejectedHandoffVerifications(
  db: Db,
  environmentId: string,
  inquiryId: string,
): Promise<boolean> {
  const row = firstOrNull(
    await db
      .select({ id: verifications.id })
      .from(verifications)
      .where(
        and(
          eq(verifications.environmentId, environmentId),
          eq(verifications.inquiryId, inquiryId),
          eq(verifications.fromRejectedHandoff, true),
        ),
      )
      .limit(1),
  );
  return row !== null;
}

/**
 * C96.1, C96.3 (P02): whether the inquiry confirmed, by a one-time code, the destination of
 * `destinationIndex` (`otpDestinationIndex`) on `channel`.
 */
export async function hasConfirmedOtpDestination(
  db: Db,
  environmentId: string,
  destination: { inquiryId: string; channel: 'sms' | 'email'; destinationIndex: string },
): Promise<boolean> {
  const row = firstOrNull(
    await db
      .select({ id: otpChallenges.id })
      .from(otpChallenges)
      .where(
        and(
          eq(otpChallenges.environmentId, environmentId),
          eq(otpChallenges.inquiryId, destination.inquiryId),
          eq(otpChallenges.channel, destination.channel),
          eq(otpChallenges.destinationIndex, destination.destinationIndex),
          eq(otpChallenges.status, 'confirmed'),
        ),
      )
      .limit(1),
  );
  return row !== null;
}

/** C96.7: the R-tier distance facts of a handoff session against its issuing session. */
export interface HandoffDistanceFactsWrite {
  distanceMeters: number | null;
  countryChanged: boolean | null;
  asnChanged: boolean | null;
}

/** C96.7: writes a handoff session's distance facts. */
export async function recordHandoffDistanceFacts(
  db: Db,
  environmentId: string,
  sessionId: string,
  facts: HandoffDistanceFactsWrite,
): Promise<void> {
  await db
    .update(inquirySessions)
    .set({
      handoffDistanceMeters: facts.distanceMeters,
      handoffCountryChanged: facts.countryChanged,
      handoffAsnChanged: facts.asnChanged,
    })
    .where(
      and(
        eq(inquirySessions.environmentId, environmentId),
        eq(inquirySessions.id, sessionId),
        isNotNull(inquirySessions.handoffFromSessionId),
      ),
    );
}
