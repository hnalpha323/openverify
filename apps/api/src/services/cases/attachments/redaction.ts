/**
 * C139.1 (Workflow 8B (F); P34): a case's attachments in its redaction. Owner `api-case-files`;
 * `foundation-8b` froze the hook, which `api-cases`' `redactCasesInTx` calls in the case's transaction
 * (`services/cases/redaction.ts`). The rows stay with their id, type, size and scan status; the name
 * and digest are nulled, the rendition reads `deleted`, every rendition page is discarded, and the keys
 * it answers are the objects the caller deletes after its commit. The C16 pass
 * (`purgeDiscardedRenditions`) deletes what a failed delete left and marks each row deleted.
 */
import {
  discardRenditionPagesInTx,
  redactCaseAttachmentRows,
  redactCaseAttachmentRowsById,
  type Db,
} from '@openverify/db';

export interface RedactedCaseAttachments {
  /** The originals' and their rendition pages' objects, to delete after the commit. */
  storageKeys: string[];
}

/**
 * `caseIds` redacts every attachment of those cases; `attachmentIds` (K8-21, P22) only those, as a
 * held selfie inquiry's biometric retention does.
 */
export async function redactCaseAttachmentsInTx(
  tx: Db,
  input: { environmentId: string; at: Date } & (
    | { caseIds: readonly string[] }
    | { attachmentIds: readonly string[] }
  ),
): Promise<RedactedCaseAttachments> {
  const originals =
    'caseIds' in input
      ? await redactCaseAttachmentRows(tx, input.environmentId, input.caseIds, input.at)
      : await redactCaseAttachmentRowsById(tx, input.environmentId, input.attachmentIds, input.at);
  const pages = await discardRenditionPagesInTx(
    tx,
    input.environmentId,
    originals.map(({ id }) => id),
  );
  return { storageKeys: [...originals.map(({ storageKey }) => storageKey), ...pages] };
}
