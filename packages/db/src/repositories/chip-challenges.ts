/**
 * C53.3, C62.5: the server nonces a chip signs for Active Authentication (`chc_`). Only the
 * nonce's SHA-256 is stored; the Active Authentication response and the device report are sealed
 * to the row (`chip_challenges.<column>#<id>`) and cleared when processing ends.
 *
 * Workflow 5B Stage 1 (`contracts-5b`) wrote this file, the reads the guard, the job and the
 * attributes use, and redaction; `api-nfc` owns it and adds the writes (create, count, supersede,
 * consume by a conditional update, clear the evidence after processing). Callers hold the C40.6
 * lock order: the inquiry (`redacted_at` re-checked), then the verification, then the challenge.
 */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import { openValue, sealValue, type Sealed } from '../sealed.js';
import { chipChallenges, type ChipChallengeRow, type ChipSandboxScenario } from '../schema.js';
import { firstOrNull, inserted } from './rows.js';

/** C53.3: a challenge's lifecycle; only one per verification is `initiated` at a time. */
export const CHIP_CHALLENGE_STATUSES = [
  'initiated',
  'submitted',
  'processed',
  'expired',
  'superseded',
] as const;
export type ChipChallengeStatus = (typeof CHIP_CHALLENGE_STATUSES)[number];

export interface ChipChallenge {
  id: string;
  environmentId: string;
  verificationId: string;
  inquiryId: string;
  /** Lower-case hex SHA-256 of the 8 nonce bytes. */
  nonceSha256: string;
  status: ChipChallengeStatus;
  createdAt: Date;
  expiresAt: Date;
  submittedAt: Date | null;
  redactedAt: Date | null;
  /**
   * C208.1 (Phase 10, Workflow 10C): the sandbox test chip's scenario the server built for this
   * challenge (`sandbox-chip: <scenario>`); `null` for a challenge no sandbox chip was built for.
   */
  sandboxScenario: ChipSandboxScenario | null;
}

/** The sealed values of a challenge, opened. `null` members once cleared, redacted or not sent. */
export interface ChipChallengeEvidence {
  /** The Active Authentication response, as the client sent it (base64), without its nonce. */
  aaResponse: string | null;
  /** The device report (C62.5), as JSON text: operators only, never evidence. */
  deviceReport: string | null;
}

function toChallenge(row: ChipChallengeRow): ChipChallenge {
  return {
    id: row.id,
    environmentId: row.environmentId,
    verificationId: row.verificationId,
    inquiryId: row.inquiryId,
    nonceSha256: row.nonceSha256,
    status: row.status,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    submittedAt: row.submittedAt,
    redactedAt: row.redactedAt,
    sandboxScenario: row.sandboxScenario,
  };
}

const ofChallenge = (environmentId: string, id: string) =>
  and(eq(chipChallenges.environmentId, environmentId), eq(chipChallenges.id, id));

const ofVerification = (environmentId: string, verificationId: string) =>
  and(
    eq(chipChallenges.environmentId, environmentId),
    eq(chipChallenges.verificationId, verificationId),
  );

export async function getChipChallenge(
  db: Db,
  environmentId: string,
  id: string,
): Promise<ChipChallenge | null> {
  const row = firstOrNull(
    await db.select().from(chipChallenges).where(ofChallenge(environmentId, id)),
  );
  return row === null ? null : toChallenge(row);
}

/** A verification's challenges, newest first. */
export async function listChipChallenges(
  db: Db,
  environmentId: string,
  verificationId: string,
): Promise<ChipChallenge[]> {
  const rows = await db
    .select()
    .from(chipChallenges)
    .where(ofVerification(environmentId, verificationId))
    .orderBy(desc(chipChallenges.createdAt), desc(chipChallenges.id));
  return rows.map(toChallenge);
}

/** The job's read (C62.6): the verification's newest `submitted` challenge, or `null`. */
export async function getSubmittedChipChallenge(
  db: Db,
  environmentId: string,
  verificationId: string,
): Promise<ChipChallenge | null> {
  const row = firstOrNull(
    await db
      .select()
      .from(chipChallenges)
      .where(
        and(ofVerification(environmentId, verificationId), eq(chipChallenges.status, 'submitted')),
      )
      .orderBy(desc(chipChallenges.submittedAt), desc(chipChallenges.id))
      .limit(1),
  );
  return row === null ? null : toChallenge(row);
}

/** The challenge's sealed values, opened; `null` when not found. PII. */
export async function openChipChallengeEvidence(
  db: Db,
  environmentId: string,
  id: string,
): Promise<ChipChallengeEvidence | null> {
  const row = firstOrNull(
    await db
      .select({
        aaResponse: chipChallenges.aaResponseSealed,
        deviceReport: chipChallenges.deviceReportSealed,
      })
      .from(chipChallenges)
      .where(ofChallenge(environmentId, id)),
  );
  if (row === null) {
    return null;
  }
  const open = (column: string, sealed: Sealed | null) =>
    sealed === null ? null : openValue(column, id, sealed);
  const aaResponse = open(SEALED.chipChallengeAaResponse, row.aaResponse);
  return {
    aaResponse: aaResponse === null ? null : openAaEnvelope(aaResponse).response,
    deviceReport: open(SEALED.chipChallengeDeviceReport, row.deviceReport),
  };
}

// The writes (api-nfc, C62.5) -----------------------------------------------------------------

/**
 * The sealed `aa_response` holds the response with the nonce it answers, `{ nonce, response }`
 * (the job needs the nonce bytes to verify it, and the row keeps only their SHA-256). A value
 * that is not such an envelope is read as a bare response without its nonce.
 */
interface AaEnvelope {
  nonce: string | null;
  response: string;
}

function openAaEnvelope(text: string): AaEnvelope {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { response?: unknown }).response === 'string'
    ) {
      const { nonce, response } = parsed as { nonce?: unknown; response: string };
      return { nonce: typeof nonce === 'string' ? nonce : null, response };
    }
  } catch {
    // Not an envelope: a bare response.
  }
  return { nonce: null, response: text };
}

/** A new challenge as the challenge route builds it (C62.5). */
export interface NewChipChallenge {
  id: string;
  verificationId: string;
  inquiryId: string;
  /** Lower-case hex SHA-256 of the 8 nonce bytes; the nonce itself is returned once, never stored. */
  nonceSha256: string;
  createdAt: Date;
  expiresAt: Date;
}

/** C62.5: a new `initiated` challenge. The caller closed the open one first. */
export async function createChipChallenge(
  tx: Db,
  environmentId: string,
  input: NewChipChallenge,
): Promise<ChipChallenge> {
  const row = inserted(
    await tx
      .insert(chipChallenges)
      .values({
        id: input.id,
        environmentId,
        verificationId: input.verificationId,
        inquiryId: input.inquiryId,
        nonceSha256: input.nonceSha256,
        status: 'initiated',
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
      })
      .returning(),
    'createChipChallenge',
  );
  return toChallenge(row);
}

/** C62.5: how many challenges a verification has had (the 11th create cancels it). */
export async function countChipChallenges(
  tx: Db,
  environmentId: string,
  verificationId: string,
): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(chipChallenges)
    .where(ofVerification(environmentId, verificationId));
  return row?.count ?? 0;
}

/**
 * C62.5, C54.1: closes the verification's open (`initiated`) challenge: `expired` when it is past
 * its expiry at `options.now`, `superseded` otherwise (always `superseded` without a `now`).
 * Returns the challenges it closed.
 */
export async function supersedeOpenChipChallenges(
  tx: Db,
  environmentId: string,
  verificationId: string,
  options: { now?: Date } = {},
): Promise<ChipChallenge[]> {
  const status =
    options.now === undefined
      ? sql`'superseded'`
      : sql`case when ${chipChallenges.expiresAt} <= ${options.now.toISOString()}::timestamptz then 'expired' else 'superseded' end`;
  const rows = await tx
    .update(chipChallenges)
    .set({ status })
    .where(
      and(ofVerification(environmentId, verificationId), eq(chipChallenges.status, 'initiated')),
    )
    .returning();
  return rows.map(toChallenge);
}

/**
 * C208.1 (Phase 10, Workflow 10C): records that the server built a sandbox test chip of `scenario`
 * for the verification's open challenge `id`, in `tx` (the caller holds the inquiry's lock). Only an
 * `initiated` challenge of that verification takes it. Returns whether a row was written.
 */
export async function setChipChallengeSandboxScenario(
  tx: Db,
  environmentId: string,
  input: { id: string; verificationId: string; scenario: ChipSandboxScenario },
): Promise<boolean> {
  const rows = await tx
    .update(chipChallenges)
    .set({ sandboxScenario: input.scenario })
    .where(
      and(
        ofChallenge(environmentId, input.id),
        eq(chipChallenges.verificationId, input.verificationId),
        eq(chipChallenges.status, 'initiated'),
      ),
    )
    .returning({ id: chipChallenges.id });
  return rows.length === 1;
}

/** What a submit hands in with a challenge (C62.5). PII. */
export interface ChipChallengeSubmission {
  /** The nonce the client echoed (16 lower-case hex characters); its SHA-256 must match. */
  nonce: string;
  /** The Active Authentication response (base64), or `null` when the client sent none. */
  aaResponse: string | null;
  /** The device report as JSON text, or `null`: shown to operators only, never evidence. */
  deviceReport: string | null;
}

/**
 * C62.5: consumes the challenge once, in the submit transaction: `initiated`, of this
 * verification, with this nonce's SHA-256, unredacted and unexpired at `now` becomes
 * `submitted`, with the AA response (and the nonce it answers, which the job needs to verify it)
 * and the device report sealed to it. `null` when the conditional update matched nothing
 * (unknown, consumed, superseded, expired, another nonce or another verification's).
 */
export async function consumeChipChallenge(
  tx: Db,
  environmentId: string,
  input: {
    id: string;
    verificationId: string;
    nonceSha256: string;
    now: Date;
    submission: ChipChallengeSubmission;
  },
): Promise<ChipChallenge | null> {
  const { id, submission } = input;
  const envelope: AaEnvelope | null =
    submission.aaResponse === null
      ? null
      : { nonce: submission.nonce, response: submission.aaResponse };
  const row = firstOrNull(
    await tx
      .update(chipChallenges)
      .set({
        status: 'submitted',
        submittedAt: input.now,
        aaResponseSealed:
          envelope === null
            ? null
            : sealValue(SEALED.chipChallengeAaResponse, id, JSON.stringify(envelope)),
        deviceReportSealed:
          submission.deviceReport === null
            ? null
            : sealValue(SEALED.chipChallengeDeviceReport, id, submission.deviceReport),
      })
      .where(
        and(
          ofChallenge(environmentId, id),
          eq(chipChallenges.verificationId, input.verificationId),
          eq(chipChallenges.nonceSha256, input.nonceSha256),
          eq(chipChallenges.status, 'initiated'),
          isNull(chipChallenges.redactedAt),
          sql`${chipChallenges.expiresAt} > ${input.now.toISOString()}::timestamptz`,
        ),
      )
      .returning(),
  );
  return row === null ? null : toChallenge(row);
}

/**
 * C62.5, C53.3: `submitted` -> `processed` once the job decided the verification or failed it,
 * clearing the sealed AA response and device report in the same update (decision 43). `null` when
 * the challenge is not `submitted`.
 */
export async function markChipChallengeProcessed(
  tx: Db,
  environmentId: string,
  id: string,
): Promise<ChipChallenge | null> {
  const row = firstOrNull(
    await tx
      .update(chipChallenges)
      .set({ status: 'processed', aaResponseSealed: null, deviceReportSealed: null })
      .where(and(ofChallenge(environmentId, id), eq(chipChallenges.status, 'submitted')))
      .returning(),
  );
  return row === null ? null : toChallenge(row);
}

/** What the job reads from a consumed challenge (C62.6). PII. */
export interface ChipChallengeSubmissionEvidence {
  /** The nonce the AA response answers, 16 lower-case hex characters; `null` without a response. */
  nonce: string | null;
  /** The AA response (base64), `null` when none was sent, or once cleared or redacted. */
  aaResponse: string | null;
  /** The device report (JSON text), `null` when none was sent, or once cleared or redacted. */
  deviceReport: string | null;
}

/** The consumed challenge's sealed submission, opened; `null` when not found. PII. */
export async function openChipChallengeSubmission(
  db: Db,
  environmentId: string,
  id: string,
): Promise<ChipChallengeSubmissionEvidence | null> {
  const row = firstOrNull(
    await db
      .select({
        aaResponse: chipChallenges.aaResponseSealed,
        deviceReport: chipChallenges.deviceReportSealed,
      })
      .from(chipChallenges)
      .where(ofChallenge(environmentId, id)),
  );
  if (row === null) {
    return null;
  }
  const envelope =
    row.aaResponse === null
      ? null
      : openAaEnvelope(openValue(SEALED.chipChallengeAaResponse, id, row.aaResponse));
  return {
    nonce: envelope?.nonce ?? null,
    aaResponse: envelope?.response ?? null,
    deviceReport:
      row.deviceReport === null
        ? null
        : openValue(SEALED.chipChallengeDeviceReport, id, row.deviceReport),
  };
}

/**
 * C53.6: clears every sealed value of these verifications' challenges and sets `redacted_at`
 * (kept on a re-run); returns the rows matched.
 */
export async function redactChipChallenges(
  tx: Db,
  environmentId: string,
  verificationIds: readonly string[],
  at: Date,
): Promise<number> {
  if (verificationIds.length === 0) {
    return 0;
  }
  const rows = await tx
    .update(chipChallenges)
    .set({
      aaResponseSealed: null,
      deviceReportSealed: null,
      redactedAt: sql`coalesce(${chipChallenges.redactedAt}, ${at.toISOString()}::timestamptz)`,
    })
    .where(
      and(
        eq(chipChallenges.environmentId, environmentId),
        inArray(chipChallenges.verificationId, [...verificationIds]),
      ),
    )
    .returning({ id: chipChallenges.id });
  return rows.length;
}
