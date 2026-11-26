/**
 * C53.3, C61.1: the registry record one business verification was judged against: its source and
 * when it was fetched, and the record's non-personal summary sealed to the row
 * (`business_registry_records.record#<verification id>`: record id, legal name, status,
 * jurisdiction, registered address; never officers or PSCs, C53.5). A sole trader's name is
 * personal data, so the whole summary is sealed.
 *
 * Workflow 5B Stage 1 (`contracts-5b`) wrote this file, the reads the attributes use, and
 * redaction; `api-kyb` owns it and adds the write.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import { openJson, sealJson } from '../sealed.js';
import { businessRegistryRecords } from '../schema.js';
import { firstOrNull } from './rows.js';

/** The registry an answer came from (C61.1). */
export type BusinessRegistrySource = 'gleif' | 'companies-house' | 'sec-edgar' | 'sandbox';

export interface BusinessRegistryRecordRow {
  verificationId: string;
  inquiryId: string;
  source: BusinessRegistrySource;
  fetchedAt: Date;
  createdAt: Date;
  redactedAt: Date | null;
}

/** The sealed summary, opened. PII (a sole trader's name). */
export interface BusinessRegistryRecordSummary {
  recordId: string;
  legalName: string;
  /** The source's own status value, such as `ISSUED` or `active` (C61.2). */
  status: string | null;
  jurisdiction: string | null;
  registeredAddress: string | null;
}

const ofVerification = (environmentId: string, verificationId: string) =>
  and(
    eq(businessRegistryRecords.environmentId, environmentId),
    eq(businessRegistryRecords.verificationId, verificationId),
  );

/** The columns of a {@link BusinessRegistryRecordRow}: never the sealed summary. */
const ROW_COLUMNS = {
  verificationId: businessRegistryRecords.verificationId,
  inquiryId: businessRegistryRecords.inquiryId,
  source: businessRegistryRecords.source,
  fetchedAt: businessRegistryRecords.fetchedAt,
  createdAt: businessRegistryRecords.createdAt,
  redactedAt: businessRegistryRecords.redactedAt,
};

export async function getBusinessRegistryRecord(
  db: Db,
  environmentId: string,
  verificationId: string,
): Promise<BusinessRegistryRecordRow | null> {
  return firstOrNull(
    await db
      .select(ROW_COLUMNS)
      .from(businessRegistryRecords)
      .where(ofVerification(environmentId, verificationId)),
  );
}

/** The sealed summary, opened; `null` when not found or redacted. PII. */
export async function openBusinessRegistryRecord(
  db: Db,
  environmentId: string,
  verificationId: string,
): Promise<BusinessRegistryRecordSummary | null> {
  const row = firstOrNull(
    await db
      .select({ record: businessRegistryRecords.recordSealed })
      .from(businessRegistryRecords)
      .where(ofVerification(environmentId, verificationId)),
  );
  if (row?.record == null) {
    return null;
  }
  const record = openJson(SEALED.businessRegistryRecord, verificationId, row.record) as Partial<
    Record<keyof BusinessRegistryRecordSummary, string | null>
  >;
  return {
    recordId: record.recordId ?? '',
    legalName: record.legalName ?? '',
    status: record.status ?? null,
    jurisdiction: record.jurisdiction ?? null,
    registeredAddress: record.registeredAddress ?? null,
  };
}

/** C53.3, C61.1: the registry record a business verification's decision writes. */
export interface BusinessRegistryRecordWrite {
  verificationId: string;
  /** The verification's inquiry. */
  inquiryId: string;
  source: BusinessRegistrySource;
  /** The non-personal summary to seal (never officers or PSCs). PII: a sole trader's name. */
  record: BusinessRegistryRecordSummary;
  /** When the register answered. */
  fetchedAt: Date;
}

/**
 * C53.3, C61.1: writes the registry record a business verification was judged against, its
 * summary sealed to the verification, in the decision transaction (after the inquiry and the
 * verification are locked, C40.6). A re-run replaces it while the row is unredacted.
 * @throws {Error} when the verification is in another environment or its record was redacted.
 */
export async function putBusinessRegistryRecord(
  tx: Db,
  environmentId: string,
  input: BusinessRegistryRecordWrite,
): Promise<BusinessRegistryRecordRow> {
  const written = {
    source: input.source,
    recordSealed: sealJson(SEALED.businessRegistryRecord, input.verificationId, input.record),
    fetchedAt: input.fetchedAt,
  };
  // A verification of another environment fails the composite key; its error, which quotes the
  // query and its sealed parameters, is replaced by one that names the cause alone.
  let rows: BusinessRegistryRecordRow[] = [];
  let foreign = false;
  try {
    rows = await tx
      .insert(businessRegistryRecords)
      .values({
        environmentId,
        verificationId: input.verificationId,
        inquiryId: input.inquiryId,
        ...written,
      })
      .onConflictDoUpdate({
        target: businessRegistryRecords.verificationId,
        set: written,
        // Never over another environment's row or a redacted one (C53.6).
        setWhere: sql`${businessRegistryRecords.environmentId} = ${environmentId}
          and ${businessRegistryRecords.redactedAt} is null`,
      })
      .returning(ROW_COLUMNS);
  } catch (error) {
    if (!isForeignKeyViolation(error)) {
      throw error;
    }
    foreign = true;
  }
  const row = firstOrNull(rows);
  if (row !== null) {
    return row;
  }
  const existing = foreign
    ? null
    : await getBusinessRegistryRecord(tx, environmentId, input.verificationId);
  throw new Error(
    existing === null
      ? 'putBusinessRegistryRecord: the verification is in another environment'
      : 'putBusinessRegistryRecord: the record was redacted',
  );
}

/** Whether `error` (or a cause of it) is Postgres's foreign key violation (`23503`). */
function isForeignKeyViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current);
    if ((current as { code?: unknown }).code === '23503') {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * C53.6: clears these verifications' sealed summaries and sets `redacted_at` (kept on a re-run);
 * returns the rows matched.
 */
export async function redactBusinessRegistryRecords(
  tx: Db,
  environmentId: string,
  verificationIds: readonly string[],
  at: Date,
): Promise<number> {
  if (verificationIds.length === 0) {
    return 0;
  }
  const rows = await tx
    .update(businessRegistryRecords)
    .set({
      recordSealed: null,
      redactedAt: sql`coalesce(${businessRegistryRecords.redactedAt}, ${at.toISOString()}::timestamptz)`,
    })
    .where(
      and(
        eq(businessRegistryRecords.environmentId, environmentId),
        inArray(businessRegistryRecords.verificationId, [...verificationIds]),
      ),
    )
    .returning({ verificationId: businessRegistryRecords.verificationId });
  return rows.length;
}
