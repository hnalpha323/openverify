import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { CheckProvenance, CheckStage } from '@openverify/core';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { Db } from '../client.js';
import {
  verificationChecks,
  verifications,
  type CheckRequirement,
  type CheckStatus,
  type CheckType,
  type IdClass,
  type Verification,
  type VerificationCheck,
  type VerificationStatus,
  type VerificationType,
} from '../schema.js';
import { equalsAny, firstOrNull, inserted } from './rows.js';
import { DEFAULT_SWEEP_LIMIT } from './sweeps.js';

export interface NewVerificationInput {
  id: string;
  inquiryId: string;
  type: VerificationType;
  /** ISO 3166-1 alpha-2. */
  country?: string | null;
  idClass?: IdClass | null;
  /** C91.1 (Workflow 7A, V02): the flow session that creates it; `null` for the server. */
  createdBySessionId?: string | null;
}

export type VerificationWithChecks = Verification & { checks: VerificationCheck[] };

export interface VerificationStatusUpdate {
  to: VerificationStatus;
  /** Only update while the status is one of these (optimistic concurrency). */
  from?: VerificationStatus | readonly VerificationStatus[];
  /** Time for `submitted_at` / `completed_at`; defaults to the database clock. */
  at?: Date;
}

/** One check result to store (C2 `checks[]`). */
export interface VerificationCheckInput {
  name: string;
  status: CheckStatus;
  type: CheckType;
  requirement: CheckRequirement;
  /** snake_case reason codes. */
  reasons?: readonly string[];
  /** Scores and flags only: never PII or biometric embeddings. */
  metadata?: Record<string, unknown>;
  /** C29.2: the registry stage the result was written with; `null` when absent. */
  stage?: CheckStage;
  /** C29.2: in [0, 1], or `null`. */
  confidence?: number | null;
  /** C29.2: implementation version, models, provider and thresholds; `null` when absent. */
  provenance?: CheckProvenance;
}

/** Check names are ASCII snake_case; "C" collation gives the same order on every server. */
const byCheckName = sql`${verificationChecks.name} collate "C"`;
const compareNames = (a: VerificationCheck, b: VerificationCheck): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

export async function createVerification(
  db: Db,
  environmentId: string,
  input: NewVerificationInput,
): Promise<Verification> {
  const rows = await db
    .insert(verifications)
    .values({
      id: input.id,
      environmentId,
      inquiryId: input.inquiryId,
      type: input.type,
      country: input.country ?? null,
      idClass: input.idClass ?? null,
      createdBySessionId: input.createdBySessionId ?? null,
    })
    .returning();
  return inserted(rows, 'createVerification');
}

async function checksFor(
  db: Db,
  environmentId: string,
  verificationIds: string[],
): Promise<Map<string, VerificationCheck[]>> {
  const grouped = new Map<string, VerificationCheck[]>(verificationIds.map((id) => [id, []]));
  if (verificationIds.length === 0) {
    return grouped;
  }
  const checks = await db
    .select()
    .from(verificationChecks)
    .where(
      and(
        eq(verificationChecks.environmentId, environmentId),
        inArray(verificationChecks.verificationId, verificationIds),
      ),
    )
    .orderBy(byCheckName);
  for (const check of checks) {
    grouped.get(check.verificationId)?.push(check);
  }
  return grouped;
}

/** A verification with its checks, ordered by check name (C2 `GET /verifications/:id`). */
export async function getVerification(
  db: Db,
  environmentId: string,
  id: string,
): Promise<VerificationWithChecks | null> {
  const verification = firstOrNull(
    await db
      .select()
      .from(verifications)
      .where(and(eq(verifications.id, id), eq(verifications.environmentId, environmentId)))
      .limit(1),
  );
  if (verification === null) {
    return null;
  }
  const checks = await checksFor(db, environmentId, [verification.id]);
  return { ...verification, checks: checks.get(verification.id) ?? [] };
}

/**
 * Sets a government ID's `country` and `id_class` from its extraction (C31.5) where the user
 * chose none: a value already set is kept. `null` leaves a column as it is. Returns the row, or
 * `null` when the verification is not in this environment.
 */
export async function fillVerificationDocument(
  db: Db,
  environmentId: string,
  id: string,
  document: { country: string | null; idClass: IdClass | null },
): Promise<Verification | null> {
  const inEnvironment = and(
    eq(verifications.id, id),
    eq(verifications.environmentId, environmentId),
  );
  const set: PgUpdateSetSource<typeof verifications> = {
    ...(document.country === null
      ? {}
      : { country: sql`coalesce(${verifications.country}, ${document.country})` }),
    ...(document.idClass === null
      ? {}
      : { idClass: sql`coalesce(${verifications.idClass}, ${document.idClass}::id_class)` }),
  };
  if (Object.keys(set).length === 0) {
    return firstOrNull(await db.select().from(verifications).where(inEnvironment));
  }
  return firstOrNull(await db.update(verifications).set(set).where(inEnvironment).returning());
}

/**
 * Locks the verification's row (`SELECT ... FOR UPDATE`) until the caller's transaction ends
 * and returns it, or `null` when it is not in this environment. Uploads take the same lock
 * (`replaceVerificationFile`), so a submit that holds it sees the final set of files. Call it
 * with a transaction; on a plain client the lock ends with the statement.
 */
export async function lockVerification(
  db: Db,
  environmentId: string,
  id: string,
): Promise<Verification | null> {
  return firstOrNull(
    await db
      .select()
      .from(verifications)
      .where(and(eq(verifications.id, id), eq(verifications.environmentId, environmentId)))
      .for('update'),
  );
}

/** An inquiry's verifications, oldest first, with checks (`?include=verifications`). */
export async function listInquiryVerifications(
  db: Db,
  environmentId: string,
  inquiryId: string,
): Promise<VerificationWithChecks[]> {
  const rows = await db
    .select()
    .from(verifications)
    .where(
      and(eq(verifications.environmentId, environmentId), eq(verifications.inquiryId, inquiryId)),
    )
    .orderBy(asc(verifications.createdAt), asc(verifications.id));
  const checks = await checksFor(
    db,
    environmentId,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({ ...row, checks: checks.get(row.id) ?? [] }));
}

/** A verification the repair sweep found left in `submitted` (Workflow 5C review K1). */
export interface SubmittedVerificationRef {
  readonly environmentId: string;
  readonly id: string;
}

/**
 * Verifications of every environment still `submitted` that were submitted before `before`,
 * newest first, at most `limit` (Workflow 5C review K1: the sweep re-enqueues them).
 */
export async function listSubmittedVerificationsBefore(
  db: Db,
  options: { readonly before: Date; readonly limit?: number },
): Promise<SubmittedVerificationRef[]> {
  return db
    .select({ environmentId: verifications.environmentId, id: verifications.id })
    .from(verifications)
    .where(
      and(eq(verifications.status, 'submitted'), lt(verifications.submittedAt, options.before)),
    )
    .orderBy(desc(verifications.submittedAt), desc(verifications.id))
    .limit(options.limit ?? DEFAULT_SWEEP_LIMIT);
}

/**
 * Sets the status, stamping `submitted_at` on `submitted` and `completed_at` on `passed`,
 * `failed`, `needs_review` (C30.4: processing is over, an operator decides) or `skipped` (C50.7,
 * C59.6: the server skipped it, so no processing is left). With `from`, the update only applies
 * while the status is one of those;
 * otherwise, and for a verification that is not here, the result is `null`.
 */
export async function setVerificationStatus(
  db: Db,
  environmentId: string,
  id: string,
  update: VerificationStatusUpdate,
): Promise<Verification | null> {
  const fromFilter = equalsAny(verifications.status, update.from);
  if (fromFilter === null) {
    return null;
  }
  const at = update.at ?? sql`now()`;
  const set: PgUpdateSetSource<typeof verifications> = { status: update.to };
  if (update.to === 'submitted') {
    set.submittedAt = at;
  } else if (
    update.to === 'passed' ||
    update.to === 'failed' ||
    update.to === 'needs_review' ||
    update.to === 'skipped'
  ) {
    set.completedAt = at;
  }
  return firstOrNull(
    await db
      .update(verifications)
      .set(set)
      .where(
        and(eq(verifications.id, id), eq(verifications.environmentId, environmentId), fromFilter),
      )
      .returning(),
  );
}

/**
 * Replaces the verification's check results with `checks`, in one transaction. Returns
 * the stored checks ordered by name, or `null` when the verification is not here.
 */
export async function replaceVerificationChecks(
  db: Db,
  environmentId: string,
  verificationId: string,
  checks: readonly VerificationCheckInput[],
): Promise<VerificationCheck[] | null> {
  return db.transaction(async (tx) => {
    const verification = firstOrNull(
      await tx
        .select({ id: verifications.id })
        .from(verifications)
        .where(
          and(eq(verifications.id, verificationId), eq(verifications.environmentId, environmentId)),
        )
        .for('update'),
    );
    if (verification === null) {
      return null;
    }
    await tx
      .delete(verificationChecks)
      .where(
        and(
          eq(verificationChecks.environmentId, environmentId),
          eq(verificationChecks.verificationId, verificationId),
        ),
      );
    if (checks.length === 0) {
      return [];
    }
    const stored = await tx
      .insert(verificationChecks)
      .values(
        checks.map((check) => ({
          environmentId,
          verificationId,
          name: check.name,
          status: check.status,
          type: check.type,
          requirement: check.requirement,
          reasons: [...(check.reasons ?? [])],
          metadata: check.metadata ?? {},
          stage: check.stage ?? null,
          confidence: check.confidence ?? null,
          provenance: check.provenance ?? null,
        })),
      )
      .returning();
    return stored.sort(compareNames);
  });
}

/**
 * C10 `expire`: the inquiry's `initiated` verifications become `canceled`. Returns them,
 * so the caller can emit `verification.canceled` for each.
 */
export async function cancelInitiatedVerifications(
  db: Db,
  environmentId: string,
  inquiryId: string,
): Promise<Verification[]> {
  return db
    .update(verifications)
    .set({ status: 'canceled' })
    .where(
      and(
        eq(verifications.environmentId, environmentId),
        eq(verifications.inquiryId, inquiryId),
        eq(verifications.status, 'initiated'),
      ),
    )
    .returning();
}
