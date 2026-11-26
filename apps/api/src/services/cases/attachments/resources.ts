/**
 * C129.2, C135 (Workflow 8B, `api-case-files`): a case's `attachments` as the case serves them, each
 * built by the contract's builder: the filename (PII, `null` once redacted; the reader's mask nulls it
 * without `pii:view`), the content route as `url`, never a storage URL, the size, the type, the scan
 * and the rendition state. An event's case names no filename (`carriesNoValue`).
 *
 * `services/cases/resources.ts` (`api-cases`) builds the served case; until it reads these (the change
 * for `integration-8b` is in the report), the attachment routes answer the case with them overlaid.
 */
import {
  buildCaseAttachment,
  type CaseAttachment as ServedCaseAttachment,
  type CaseAttachmentRecord,
  type CaseDocument,
} from '@openverify/contracts';
import { getCaseRow, listCaseAttachments, type CaseAttachment, type Db } from '@openverify/db';
import type { PiiMask } from '../../../auth/pii.js';
import { NotFoundError } from '../../../errors.js';
import type { ApiDependencies } from '../../context.js';
import { caseResource } from '../resources.js';
import { attachmentTypeOf } from './store.js';

/** One stored attachment as the contract's record; `filenames: false` for an event. */
export function attachmentRecordOf(
  row: CaseAttachment,
  options: { filenames: boolean },
): CaseAttachmentRecord {
  return {
    id: row.id,
    caseId: row.caseId,
    filename: options.filenames ? row.filename : null,
    byteSize: row.byteSize,
    attachmentType: attachmentTypeOf(row.mimeType) ?? 'pdf',
    scanStatus: row.scanStatus,
    scanProvider: row.scanProvider,
    scannedAt: row.scannedAt,
    renditionStatus: row.renditionStatus,
    pageCount: row.renditionStatus === 'ready' ? row.renditionPageCount : null,
    createdAt: row.createdAt,
  };
}

/** One stored attachment as the contract serves it; `filenames: false` for an event. */
export const servedAttachment = (
  row: CaseAttachment,
  options: { filenames: boolean },
): ServedCaseAttachment => buildCaseAttachment(attachmentRecordOf(row, options));

/**
 * C129.2: a case's attachments as `CaseRecord.attachments` takes them, in upload order, for the
 * served case (`services/cases/resources.ts`): `filenames: false` for an event's case.
 */
export async function caseAttachmentRecordsOf(
  db: Db,
  environmentId: string,
  caseId: string,
  options: { filenames: boolean } = { filenames: true },
): Promise<CaseAttachmentRecord[]> {
  return (await listCaseAttachments(db, environmentId, [caseId])).map((row) =>
    attachmentRecordOf(row, options),
  );
}

/** K8-30: {@link caseAttachmentRecordsOf} for every case of `caseIds`, in one query. */
export async function caseAttachmentRecordsOfCases(
  db: Db,
  environmentId: string,
  caseIds: readonly string[],
  options: { filenames: boolean } = { filenames: true },
): Promise<Map<string, CaseAttachmentRecord[]>> {
  const byCase = new Map<string, CaseAttachmentRecord[]>(caseIds.map((id) => [id, []]));
  for (const row of await listCaseAttachments(db, environmentId, caseIds)) {
    byCase.get(row.caseId)?.push(attachmentRecordOf(row, options));
  }
  return byCase;
}

/** C129.2: a case's attachments in upload order, unmasked; `filenames: false` for an event. */
export async function caseAttachmentsOf(
  db: Db,
  environmentId: string,
  caseId: string,
  options: { filenames: boolean } = { filenames: true },
): Promise<ServedCaseAttachment[]> {
  return (await caseAttachmentRecordsOf(db, environmentId, caseId, options)).map(
    buildCaseAttachment,
  );
}

/** The case under the reader's mask, with its attachments, for the attachment routes' answers. */
export async function caseDocumentWithAttachments(
  deps: Pick<ApiDependencies, 'db'>,
  acting: { ctx: { environmentId: string }; mask: PiiMask },
  caseId: string,
): Promise<CaseDocument> {
  const { environmentId } = acting.ctx;
  const row = await getCaseRow(deps.db, environmentId, caseId);
  if (row === null) {
    throw new NotFoundError(`Case ${caseId} was not found.`);
  }
  const resource = await caseResource(deps.db, environmentId, row, acting.mask);
  const masked = acting.mask.attributes<{ attachments: ServedCaseAttachment[] }>({
    attachments: await caseAttachmentsOf(deps.db, environmentId, caseId),
  });
  return { data: { ...resource, attributes: { ...resource.attributes, ...masked } } };
}
