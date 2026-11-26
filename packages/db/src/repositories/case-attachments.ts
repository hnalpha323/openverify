/**
 * C135.2, C135.5, C139.1 (Workflow 8B, checkpoint (F)): a case's attachments. Owner `api-case-files`;
 * `foundation-8b` froze the names, and the owner adds what else it needs here (the scan job's batch,
 * a redaction's rows). The object's bytes go through `FileStorage`, never this file.
 *
 * - The client's filename is sealed for its row (`SEALED.caseAttachmentFilename`) and opened on read.
 * - A scan or a rendition writes only on an attachment still `pending` and not redacted, so a job
 *   that lost a race with a redaction writes nothing (the caller then deletes what it stored).
 * - A redaction keeps id, type, size and scan status (P34): it nulls the name and the digest, marks
 *   the rendition `deleted` and answers the objects to delete after the commit; the C16 pass retries
 *   what a failed delete left and marks the row deleted.
 */
import { CASE_ATTACHMENT_MEDIA_TYPES } from '@openverify/core';
import { and, asc, count, eq, inArray, isNotNull, isNull, lt, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import { openOptional, sealValue } from '../sealed.js';
import { caseAttachments, type CaseAttachmentRow } from '../tables/case-files.js';
import { DEFAULT_FACE_TEMPLATE_SETTINGS } from './retention.js';
import { firstOrNull, inserted } from './rows.js';

/** An attachment with its filename opened: `null` once redacted (P34). */
export interface CaseAttachment extends Omit<CaseAttachmentRow, 'originalFilenameSealed'> {
  filename: string | null;
}

/** What an upload writes: the object is stored and sealed before the row. */
export interface NewCaseAttachment {
  id: string;
  caseId: string;
  mimeType: string;
  byteSize: number;
  /** The client's filename, sealed for the row (`SEALED.caseAttachmentFilename`). */
  filename: string;
  sha256: string;
  storageKey: string;
  wrappedDek: string;
  uploader: { type: 'user' | 'api-key' | 'workflow-run'; id: string };
  /** `pending` with a scanner bound, `not_scanned` with none (C135.5). */
  scanStatus: 'pending' | 'not_scanned';
  scanProvider: 'sandbox' | 'clamd' | null;
}

/** C135.5: what a scan attempt left: a verdict with its time, or still pending. */
export interface CaseAttachmentScan {
  status: 'pending' | 'clean' | 'infected' | 'error';
  scannedAt: Date | null;
  attempts: number;
}

/** C135.3: what a rendition attempt left. Every attempt is counted. */
export type RenditionOutcome =
  | { status: 'ready'; pageCount: number; truncated: boolean; renderedAt: Date }
  | { status: 'failed'; errorCode: string }
  | { status: 'pending' };

/** An object a redaction or the C16 pass deletes. */
export interface CaseAttachmentObject {
  id: string;
  environmentId: string;
  storageKey: string;
}

function toAttachment(row: CaseAttachmentRow): CaseAttachment {
  const { originalFilenameSealed, ...rest } = row;
  return {
    ...rest,
    filename: openOptional(SEALED.caseAttachmentFilename, row.id, originalFilenameSealed),
  };
}

const attachmentIn = (environmentId: string, id: string) =>
  and(eq(caseAttachments.environmentId, environmentId), eq(caseAttachments.id, id));

/** Still `pending` for this outcome and never redacted: what a job may write on. */
const writable = (
  status: typeof caseAttachments.scanStatus | typeof caseAttachments.renditionStatus,
) => and(eq(status, 'pending'), isNull(caseAttachments.redactedAt));

/** C135.2: writes one attachment of a case, the case's row already locked by the caller. */
export async function createCaseAttachmentRow(
  tx: Db,
  environmentId: string,
  input: NewCaseAttachment,
): Promise<CaseAttachment> {
  return toAttachment(
    inserted(
      await tx
        .insert(caseAttachments)
        .values({
          id: input.id,
          environmentId,
          caseId: input.caseId,
          mimeType: input.mimeType,
          byteSize: input.byteSize,
          originalFilenameSealed: sealValue(
            SEALED.caseAttachmentFilename,
            input.id,
            input.filename,
          ),
          sha256: input.sha256,
          storageKey: input.storageKey,
          wrappedDek: input.wrappedDek,
          uploaderType: input.uploader.type,
          uploaderId: input.uploader.id,
          scanStatus: input.scanStatus,
          scanProvider: input.scanProvider,
        })
        .returning(),
      'createCaseAttachmentRow',
    ),
  );
}

/** One attachment of the environment, or `null`. */
export async function getCaseAttachmentRow(
  db: Db,
  environmentId: string,
  attachmentId: string,
): Promise<CaseAttachment | null> {
  const row = firstOrNull(
    await db.select().from(caseAttachments).where(attachmentIn(environmentId, attachmentId)),
  );
  return row === null ? null : toAttachment(row);
}

/** One attachment `FOR UPDATE`, or `null`: what a job's write and a redaction serialise on. */
export async function lockCaseAttachmentRow(
  tx: Db,
  environmentId: string,
  attachmentId: string,
): Promise<CaseAttachment | null> {
  const row = firstOrNull(
    await tx
      .select()
      .from(caseAttachments)
      .where(attachmentIn(environmentId, attachmentId))
      .for('update'),
  );
  return row === null ? null : toAttachment(row);
}

/** The attachments of the given cases, in upload order (`case_attachments_case_created_at_idx`). */
export async function listCaseAttachments(
  db: Db,
  environmentId: string,
  caseIds: readonly string[],
): Promise<CaseAttachment[]> {
  if (caseIds.length === 0) {
    return [];
  }
  const rows = await db
    .select()
    .from(caseAttachments)
    .where(
      and(
        eq(caseAttachments.environmentId, environmentId),
        inArray(caseAttachments.caseId, [...caseIds]),
      ),
    )
    .orderBy(asc(caseAttachments.caseId), asc(caseAttachments.createdAt), asc(caseAttachments.id));
  return rows.map(toAttachment);
}

/** C135.2: how many attachments a case holds, for the cap of its version's policy. */
export async function countCaseAttachments(
  db: Db,
  environmentId: string,
  caseId: string,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(caseAttachments)
    .where(
      and(eq(caseAttachments.environmentId, environmentId), eq(caseAttachments.caseId, caseId)),
    );
  return row?.n ?? 0;
}

/** C135.5: a scan's outcome on an attachment still `pending` and not redacted; `null` otherwise. */
export async function recordCaseAttachmentScan(
  tx: Db,
  environmentId: string,
  attachmentId: string,
  scan: CaseAttachmentScan,
): Promise<CaseAttachment | null> {
  const row = firstOrNull(
    await tx
      .update(caseAttachments)
      .set({ scanStatus: scan.status, scannedAt: scan.scannedAt, scanAttempts: scan.attempts })
      .where(and(attachmentIn(environmentId, attachmentId), writable(caseAttachments.scanStatus)))
      .returning(),
  );
  return row === null ? null : toAttachment(row);
}

/** C135.3: a rendition's outcome on an attachment still `pending` and not redacted; `null` otherwise. */
export async function recordCaseAttachmentRendition(
  tx: Db,
  environmentId: string,
  attachmentId: string,
  outcome: RenditionOutcome,
): Promise<CaseAttachment | null> {
  const row = firstOrNull(
    await tx
      .update(caseAttachments)
      .set({
        renditionStatus: outcome.status,
        renditionAttempts: sql`${caseAttachments.renditionAttempts} + 1`,
        ...(outcome.status === 'ready'
          ? {
              renditionPageCount: outcome.pageCount,
              renditionTruncated: outcome.truncated,
              renderedAt: outcome.renderedAt,
            }
          : {}),
        ...(outcome.status === 'failed' ? { renditionErrorCode: outcome.errorCode } : {}),
      })
      .where(
        and(attachmentIn(environmentId, attachmentId), writable(caseAttachments.renditionStatus)),
      )
      .returning(),
  );
  return row === null ? null : toAttachment(row);
}

/**
 * C139.1 (P34): redacts the attachments of `caseIds` not redacted yet: their names and digests
 * nulled, their renditions `deleted`; id, type, size and scan status kept. Answers their objects,
 * which the caller deletes after its commit.
 */
export async function redactCaseAttachmentRows(
  tx: Db,
  environmentId: string,
  caseIds: readonly string[],
  at: Date,
): Promise<CaseAttachmentObject[]> {
  if (caseIds.length === 0) {
    return [];
  }
  return redactAttachmentsWhere(
    tx,
    environmentId,
    inArray(caseAttachments.caseId, [...caseIds]),
    at,
  );
}

/**
 * K8-21 (Workflow 8D, P22): the per-attachment form of {@link redactCaseAttachmentRows}, for an
 * attachment that goes alone (a held selfie inquiry's biometric retention).
 */
export async function redactCaseAttachmentRowsById(
  tx: Db,
  environmentId: string,
  attachmentIds: readonly string[],
  at: Date,
): Promise<CaseAttachmentObject[]> {
  if (attachmentIds.length === 0) {
    return [];
  }
  return redactAttachmentsWhere(
    tx,
    environmentId,
    inArray(caseAttachments.id, [...attachmentIds]),
    at,
  );
}

async function redactAttachmentsWhere(
  tx: Db,
  environmentId: string,
  which: SQL,
  at: Date,
): Promise<CaseAttachmentObject[]> {
  const rows = await tx
    .update(caseAttachments)
    .set({
      originalFilenameSealed: null,
      sha256: null,
      renditionStatus: 'deleted',
      renditionPageCount: null,
      redactedAt: at,
    })
    .where(
      and(
        eq(caseAttachments.environmentId, environmentId),
        which,
        isNull(caseAttachments.redactedAt),
      ),
    )
    .returning({
      id: caseAttachments.id,
      environmentId: caseAttachments.environmentId,
      storageKey: caseAttachments.storageKey,
    });
  return rows
    .filter((row): row is CaseAttachmentObject => row.storageKey !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** K8-21 (P22): an image attachment due with the biometric data of the selfie inquiry its case holds. */
export interface BiometricCaseAttachment {
  id: string;
  environmentId: string;
  caseId: string;
  inquiryId: string;
}

/**
 * K8-21 (Workflow 8D; C139.3, P22): the unredacted image attachments (JPEG, PNG, WebP; a PDF is a
 * document, not a picture of a face) of cases holding a selfie inquiry whose biometric data is gone
 * at `now`: the inquiry was redacted, or its selfie was made before the environment's
 * `face-template-retention-days` (default 365), as the face templates it made are deleted by then.
 * One row an attachment (naming the first such inquiry by id), at most `limit`, by attachment id.
 */
export async function listBiometricCaseAttachmentsDue(
  db: Db,
  now: Date,
  limit: number,
): Promise<BiometricCaseAttachment[]> {
  const images = Object.entries(CASE_ATTACHMENT_MEDIA_TYPES)
    .filter(([type]) => type !== 'pdf')
    .map(([, mediaType]) => sql`${mediaType}`);
  const result = await db.execute<{
    id: string;
    environment_id: string;
    case_id: string;
    inquiry_id: string;
  }>(sql`
    select distinct on (a.id) a.id, a.environment_id, a.case_id, i.id as inquiry_id
    from case_attachments a
    join case_inquiries ci on ci.environment_id = a.environment_id and ci.case_id = a.case_id
    join inquiries i on i.environment_id = ci.environment_id and i.id = ci.inquiry_id
    join verifications v on v.environment_id = i.environment_id and v.inquiry_id = i.id
      and v.type = 'selfie'
    join environments e on e.id = a.environment_id
    where a.redacted_at is null
      and a.mime_type in (${sql.join(images, sql`, `)})
      and (i.redacted_at is not null
        or v.created_at < ${now.toISOString()}::timestamptz - make_interval(days => coalesce(
          (e.settings ->> 'face-template-retention-days')::integer,
          ${DEFAULT_FACE_TEMPLATE_SETTINGS['face-template-retention-days']}::integer)))
    order by a.id, i.id
    limit ${limit}`);
  return (
    result as {
      rows: { id: string; environment_id: string; case_id: string; inquiry_id: string }[];
    }
  ).rows.map((row) => ({
    id: row.id,
    environmentId: row.environment_id,
    caseId: row.case_id,
    inquiryId: row.inquiry_id,
  }));
}

/** C16: marks redacted attachments whose objects were deleted; answers how many changed. */
export async function markCaseAttachmentsDeleted(
  db: Db,
  environmentId: string,
  attachmentIds: readonly string[],
  at: Date,
): Promise<number> {
  if (attachmentIds.length === 0) {
    return 0;
  }
  const rows = await db
    .update(caseAttachments)
    .set({ storageKey: null, wrappedDek: null, deletedAt: at })
    .where(
      and(
        eq(caseAttachments.environmentId, environmentId),
        inArray(caseAttachments.id, [...attachmentIds]),
        isNotNull(caseAttachments.redactedAt),
        isNull(caseAttachments.deletedAt),
      ),
    )
    .returning({ id: caseAttachments.id });
  return rows.length;
}

/** C16: redacted attachments whose objects a failed delete left, oldest redaction first. */
export async function listUndeletedRedactedCaseAttachments(
  db: Db,
  limit: number,
): Promise<CaseAttachmentObject[]> {
  const rows = await db
    .select({
      id: caseAttachments.id,
      environmentId: caseAttachments.environmentId,
      storageKey: caseAttachments.storageKey,
    })
    .from(caseAttachments)
    .where(and(isNotNull(caseAttachments.redactedAt), isNull(caseAttachments.deletedAt)))
    .orderBy(asc(caseAttachments.redactedAt), asc(caseAttachments.id))
    .limit(limit);
  return rows.filter((row): row is CaseAttachmentObject => row.storageKey !== null);
}

/**
 * K8-28 (Workflow 8D): the unredacted attachments still waiting for a scan that were stored before
 * `before`, oldest first, across environments, for the sweep to enqueue again.
 */
export async function listPendingCaseAttachmentScans(
  db: Db,
  before: Date,
  limit: number,
): Promise<{ id: string; environmentId: string }[]> {
  return db
    .select({ id: caseAttachments.id, environmentId: caseAttachments.environmentId })
    .from(caseAttachments)
    .where(
      and(
        eq(caseAttachments.scanStatus, 'pending'),
        lt(caseAttachments.createdAt, before),
        isNull(caseAttachments.redactedAt),
      ),
    )
    .orderBy(asc(caseAttachments.createdAt), asc(caseAttachments.id))
    .limit(limit);
}
