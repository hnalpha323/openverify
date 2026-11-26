/**
 * C53.3, C60: the extraction of one document verification: the class the checks established, its
 * confidence, the page count and media type, and the extracted values sealed to the row
 * (`document_extractions.fields#<verification id>`).
 *
 * Workflow 5B Stage 1 (`contracts-5b`) wrote this file, the reads the attributes and the console
 * use, and redaction; `api-document` owns it and adds the write (the job's upsert in the decision
 * transaction, C54.1). Callers hold the C40.6 lock order.
 */
import type { DocumentType } from '@openverify/core';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import { openJson, sealJson } from '../sealed.js';
import { documentExtractions, type DocumentExtractionRow } from '../schema.js';
import { firstOrNull } from './rows.js';

/** C60.5: a document class, or what the classifier answers when none is established. */
export type DocumentClassification = DocumentType | 'other' | 'unknown';

/** The media types a document may be (C52.4). */
export type DocumentMimeType = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

/** A document extraction without its sealed values. Not PII. */
export interface DocumentExtraction {
  verificationId: string;
  inquiryId: string;
  documentType: DocumentClassification;
  /** The top class probability, uncalibrated (C60.6); `null` when not classified. */
  typeConfidence: number | null;
  pageCount: number;
  mimeType: DocumentMimeType;
  createdAt: Date;
  redactedAt: Date | null;
}

/**
 * The extracted values (C52.8 `fields`, the attribute names), PII. A member the extraction did
 * not find is absent or `null`.
 */
export type DocumentExtractionFields = Readonly<Record<string, string | null>>;

function toExtraction(row: DocumentExtractionRow): DocumentExtraction {
  return {
    verificationId: row.verificationId,
    inquiryId: row.inquiryId,
    documentType: row.documentType,
    typeConfidence: row.typeConfidence,
    pageCount: row.pageCount,
    mimeType: row.mimeType,
    createdAt: row.createdAt,
    redactedAt: row.redactedAt,
  };
}

const ofVerification = (environmentId: string, verificationId: string) =>
  and(
    eq(documentExtractions.environmentId, environmentId),
    eq(documentExtractions.verificationId, verificationId),
  );

/** The extraction of `verificationId`, or `null` when it has none in this environment. */
export async function getDocumentExtraction(
  db: Db,
  environmentId: string,
  verificationId: string,
): Promise<DocumentExtraction | null> {
  const row = firstOrNull(
    await db
      .select()
      .from(documentExtractions)
      .where(ofVerification(environmentId, verificationId)),
  );
  return row === null ? null : toExtraction(row);
}

/** The extracted values, opened; `null` when not found or redacted. PII. */
export async function openDocumentExtractionFields(
  db: Db,
  environmentId: string,
  verificationId: string,
): Promise<DocumentExtractionFields | null> {
  const row = firstOrNull(
    await db
      .select({ fields: documentExtractions.fieldsSealed })
      .from(documentExtractions)
      .where(ofVerification(environmentId, verificationId)),
  );
  if (row?.fields == null) {
    return null;
  }
  return openJson(
    SEALED.documentExtractionFields,
    verificationId,
    row.fields,
  ) as DocumentExtractionFields;
}

/** What the document job writes for one verification (C53.3). */
export interface DocumentExtractionInput {
  verificationId: string;
  inquiryId: string;
  documentType: DocumentClassification;
  /** The top class probability, uncalibrated (C60.6); `null` when not classified. */
  typeConfidence: number | null;
  /** The C52.8 `fields` (PII), sealed to the row: each a string, or `null` when not read. */
  fields: DocumentExtractionFields;
  /** 1 to 50 (C60.1). */
  pageCount: number;
  mimeType: DocumentMimeType;
}

/**
 * C53.3, C54.1: writes the extraction of a document verification in the job's decision
 * transaction, the values sealed to the row; a re-run of the job replaces it, a redacted one is
 * never written again.
 * @throws {RangeError} for a member of `fields` that is neither a string nor `null`.
 * @throws {Error} when the verification is in another environment or its extraction was redacted.
 */
export async function putDocumentExtraction(
  db: Db,
  environmentId: string,
  input: DocumentExtractionInput,
): Promise<DocumentExtraction> {
  for (const [name, value] of Object.entries(input.fields)) {
    if (value !== null && typeof value !== 'string') {
      throw new RangeError(`putDocumentExtraction: the ${name} member is not text`);
    }
  }
  const written = {
    documentType: input.documentType,
    typeConfidence: input.typeConfidence,
    fieldsSealed: sealJson(SEALED.documentExtractionFields, input.verificationId, input.fields),
    pageCount: input.pageCount,
    mimeType: input.mimeType,
  };
  const row = firstOrNull(
    await db
      .insert(documentExtractions)
      .values({
        environmentId,
        verificationId: input.verificationId,
        inquiryId: input.inquiryId,
        ...written,
      })
      .onConflictDoUpdate({
        target: documentExtractions.verificationId,
        set: written,
        setWhere: sql`${documentExtractions.environmentId} = ${environmentId}
          and ${documentExtractions.redactedAt} is null`,
      })
      .returning(),
  );
  if (row === null) {
    throw new Error(
      'putDocumentExtraction: the verification is in another environment or redacted',
    );
  }
  return toExtraction(row);
}

/**
 * C53.6: clears these verifications' extracted values and sets `redacted_at` (kept on a re-run);
 * returns the rows matched.
 */
export async function redactDocumentExtractions(
  tx: Db,
  environmentId: string,
  verificationIds: readonly string[],
  at: Date,
): Promise<number> {
  if (verificationIds.length === 0) {
    return 0;
  }
  const rows = await tx
    .update(documentExtractions)
    .set({
      fieldsSealed: null,
      redactedAt: sql`coalesce(${documentExtractions.redactedAt}, ${at.toISOString()}::timestamptz)`,
    })
    .where(
      and(
        eq(documentExtractions.environmentId, environmentId),
        inArray(documentExtractions.verificationId, [...verificationIds]),
      ),
    )
    .returning({ verificationId: documentExtractions.verificationId });
  return rows.length;
}
