/**
 * C52.3, C53.2: the values a user entered for a database, AAMVA form, business registry or
 * business website verification, or (C59.6) the values a silent AAMVA attempt copied from a
 * government ID. One row per verification, sealed to it (`verification_inputs.values#<id>`).
 *
 * Workflow 5A Stage 1b wrote this file and the reads other agents use: the worker's jobs, the
 * inquiry settlement (`source_verification_id`, C50.5) and redaction. `api-database` owns it and
 * wrote the two writes: {@link putEnteredVerificationInputs} (the inputs route; a body replaces
 * the earlier one while the row is unredacted) and {@link copyVerificationInputs} (the silent
 * AAMVA attempt, once). 5B's KYB jobs reuse it.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import { openJson, sealJson } from '../sealed.js';
import { verificationInputs, type VerificationInputsRow } from '../schema.js';
import { firstOrNull } from './rows.js';

/** Where the values came from: the flow's inputs route, or a government ID's extraction. */
export const VERIFICATION_INPUT_SOURCES = ['flow', 'government_id'] as const;
export type VerificationInputSource = (typeof VERIFICATION_INPUT_SOURCES)[number];

export interface VerificationInputs {
  environmentId: string;
  verificationId: string;
  inquiryId: string;
  /** The values, as the inputs body names them (C52.3); `null` once redacted. PII. */
  values: Readonly<Record<string, unknown>> | null;
  /** The body members received, names only (never values). */
  fieldNames: readonly string[];
  source: VerificationInputSource;
  /** C59.6: the government ID verification a silent AAMVA attempt copied, else `null`. */
  sourceVerificationId: string | null;
  createdAt: Date;
  updatedAt: Date;
  redactedAt: Date | null;
}

function toInputs(row: VerificationInputsRow): VerificationInputs {
  return {
    environmentId: row.environmentId,
    verificationId: row.verificationId,
    inquiryId: row.inquiryId,
    values:
      row.valuesSealed === null
        ? null
        : (openJson(SEALED.verificationInputValues, row.verificationId, row.valuesSealed) as Record<
            string,
            unknown
          >),
    fieldNames: [...row.fieldNames],
    source: row.source,
    sourceVerificationId: row.sourceVerificationId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    redactedAt: row.redactedAt,
  };
}

/** The verification's inputs, opened; `null` when it has none or is in another environment. */
export async function getVerificationInputs(
  db: Db,
  environmentId: string,
  verificationId: string,
): Promise<VerificationInputs | null> {
  const row = firstOrNull(
    await db
      .select()
      .from(verificationInputs)
      .where(
        and(
          eq(verificationInputs.environmentId, environmentId),
          eq(verificationInputs.verificationId, verificationId),
        ),
      ),
  );
  return row === null ? null : toInputs(row);
}

/**
 * C50.5, C59.6: per verification id that has inputs, the government ID verification its values
 * came from (`null` for entered values). Ids without inputs are absent. Reads no values.
 */
export async function listVerificationInputSources(
  db: Db,
  environmentId: string,
  verificationIds: readonly string[],
): Promise<ReadonlyMap<string, string | null>> {
  if (verificationIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      verificationId: verificationInputs.verificationId,
      sourceVerificationId: verificationInputs.sourceVerificationId,
    })
    .from(verificationInputs)
    .where(
      and(
        eq(verificationInputs.environmentId, environmentId),
        inArray(verificationInputs.verificationId, [...verificationIds]),
      ),
    );
  return new Map(rows.map((row) => [row.verificationId, row.sourceVerificationId]));
}

/** C52.3: the values a user entered through the inputs route. */
export interface EnteredVerificationInputs {
  verificationId: string;
  /** The verification's inquiry. */
  inquiryId: string;
  /** The cleaned values, as the inputs body names them (PII, never logged). */
  values: Readonly<Record<string, unknown>>;
  /** The server clock: `created_at` of a first write, `updated_at` of every write. */
  at: Date;
}

/**
 * C52.3: writes the values a user entered (source `flow`), sealed to the verification, and
 * replaces earlier ones, field names included. Call it under the verification's lock (C40.6).
 * @throws {Error} when the verification is in another environment, its inputs were redacted
 *   (C53.6), or they were copied from a government ID (C59.6).
 */
export async function putEnteredVerificationInputs(
  db: Db,
  environmentId: string,
  input: EnteredVerificationInputs,
): Promise<VerificationInputs> {
  const written = {
    valuesSealed: sealJson(SEALED.verificationInputValues, input.verificationId, input.values),
    fieldNames: Object.keys(input.values),
    updatedAt: input.at,
  };
  const row = firstOrNull(
    await db
      .insert(verificationInputs)
      .values({
        environmentId,
        verificationId: input.verificationId,
        inquiryId: input.inquiryId,
        source: 'flow',
        sourceVerificationId: null,
        createdAt: input.at,
        ...written,
      })
      .onConflictDoUpdate({
        target: verificationInputs.verificationId,
        set: written,
        // Never over another environment's row, a government ID's copy or a redacted row.
        setWhere: sql`${verificationInputs.environmentId} = ${environmentId}
          and ${verificationInputs.source} = 'flow'
          and ${verificationInputs.redactedAt} is null`,
      })
      .returning(),
  );
  if (row !== null) {
    return toInputs(row);
  }
  const existing = await getVerificationInputs(db, environmentId, input.verificationId);
  throw new Error(
    existing === null
      ? 'putEnteredVerificationInputs: the verification is in another environment'
      : existing.redactedAt === null
        ? 'putEnteredVerificationInputs: the inputs were copied from a government ID'
        : 'putEnteredVerificationInputs: the inputs were redacted',
  );
}

/** C59.6: the values a silent AAMVA attempt copied from a government ID verification. */
export interface CopiedVerificationInputs {
  verificationId: string;
  inquiryId: string;
  /** The copied values, as the AAMVA body names them (PII); empty for a skipped attempt. */
  values: Readonly<Record<string, unknown>>;
  /** The government ID verification they came from. */
  sourceVerificationId: string;
  at: Date;
}

/**
 * C59.6: writes the values a server-created AAMVA attempt copied (source `government_id`),
 * re-sealed to the new verification and bound to the ID verification they came from.
 * @throws {Error} when the verification already has inputs or is in another environment.
 */
export async function copyVerificationInputs(
  db: Db,
  environmentId: string,
  input: CopiedVerificationInputs,
): Promise<VerificationInputs> {
  const row = firstOrNull(
    await db
      .insert(verificationInputs)
      .values({
        environmentId,
        verificationId: input.verificationId,
        inquiryId: input.inquiryId,
        valuesSealed: sealJson(SEALED.verificationInputValues, input.verificationId, input.values),
        fieldNames: Object.keys(input.values),
        source: 'government_id',
        sourceVerificationId: input.sourceVerificationId,
        createdAt: input.at,
        updatedAt: input.at,
      })
      .returning(),
  );
  if (row === null) {
    throw new Error('copyVerificationInputs: the row was not written');
  }
  return toInputs(row);
}

/**
 * C53.6: nulls the values of these verifications' inputs and sets `redacted_at` (kept on a
 * re-run); the field names and the source stay. Returns the rows it matched.
 */
export async function redactVerificationInputs(
  tx: Db,
  environmentId: string,
  verificationIds: readonly string[],
  at: Date,
): Promise<number> {
  if (verificationIds.length === 0) {
    return 0;
  }
  const rows = await tx
    .update(verificationInputs)
    .set({
      valuesSealed: null,
      redactedAt: sql`coalesce(${verificationInputs.redactedAt}, ${at.toISOString()}::timestamptz)`,
    })
    .where(
      and(
        eq(verificationInputs.environmentId, environmentId),
        inArray(verificationInputs.verificationId, [...verificationIds]),
      ),
    )
    .returning({ verificationId: verificationInputs.verificationId });
  return rows.length;
}
