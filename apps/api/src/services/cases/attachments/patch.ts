/**
 * C135.1 (F15; Workflow 8B): the public upload, `PATCH /cases/:id` with
 * `data.attributes.attachments[] {data, filename}`, within one request's 10 MiB decoded total. The
 * case route hands them over in its transaction, after the case row's lock. Owner `api-case-files`.
 *
 * Each item is decoded, typed by its bytes and held to the pinned version's policy (`store.ts`; the
 * pointer names the item, never its value), sealed and put, then written with its history row in the
 * caller's transaction, where the cap is counted under the case's lock. An object put for a
 * transaction that then rolls back is left unreadable in storage: its wrapped key went with the row.
 *
 * Storing needs the keys, the store and the scanner fact, which the frozen caller does not pass yet;
 * without them any attachment is refused (501), so none is lost silently. The change for
 * `integration-8b` (`services/cases/service.ts`) is in this agent's report: pass
 * `{ deps, environmentKind: acting.environmentKind, requestId }` and, after the commit, call
 * {@link requestAttachmentWork} with the ids answered.
 */
import { getCaseAttachmentRow, getCaseRow, type Db } from '@openverify/db';
import { NotFoundError } from '../../../errors.js';
import { notBuilt } from '../../../workflows/not-built.js';
import type { ApiDependencies } from '../../context.js';
import { attachmentPolicyOf, sealAttachment, typedBytes, writeAttachmentInTx } from './store.js';

export interface PatchAttachment {
  /** Base64 of the bytes. */
  data: string;
  filename: string;
}

export interface CaseAttachmentTarget {
  environmentId: string;
  caseId: string;
  uploader: { type: 'user' | 'api-key' | 'workflow-run'; id: string };
}

/**
 * What storing an attachment needs beyond the transaction: the keys, the store and the scanner fact,
 * and the environment's kind, which picks the scanner. The frozen caller passes none yet, so a PATCH
 * with attachments still answers 501 (the change for `integration-8b` is in the report).
 */
export interface PatchAttachmentStore {
  deps: Pick<ApiDependencies, 'keyring' | 'storage' | 'ids' | 'attachmentScanners' | 'clock'>;
  environmentKind: 'sandbox' | 'production';
  requestId?: string | undefined;
}

/** The ids of the attachments made, in order. */
export async function acceptPatchAttachments(
  tx: Db,
  target: CaseAttachmentTarget,
  attachments: readonly PatchAttachment[],
  store?: PatchAttachmentStore,
): Promise<string[]> {
  if (attachments.length === 0) {
    return [];
  }
  if (store === undefined) {
    return notBuilt('Case attachments');
  }
  const { environmentId, caseId } = target;
  const current = await getCaseRow(tx, environmentId, caseId);
  if (current === null) {
    throw new NotFoundError(`Case ${caseId} was not found.`);
  }
  const policy = await attachmentPolicyOf(tx, environmentId, current.caseTemplateVersionId);
  const ids: string[] = [];
  for (const [index, item] of attachments.entries()) {
    const bytes = Buffer.from(item.data, 'base64');
    const { mediaType } = typedBytes(
      bytes,
      policy,
      `/data/attributes/attachments/${String(index)}/data`,
    );
    const sealed = await sealAttachment(store.deps, environmentId, bytes);
    const made = await writeAttachmentInTx(
      tx,
      {
        environmentId,
        environmentKind: store.environmentKind,
        caseId,
        policy,
        sealed,
        mediaType,
        filename: item.filename,
        uploader: target.uploader,
        requestId: store.requestId,
      },
      store.deps,
    );
    ids.push(made.id);
  }
  return ids;
}

/**
 * After the commit that stored attachments: asks for their scans (with a scanner bound) and their
 * renditions. A failed request is the content route's to repeat, which asks again when it finds one
 * pending.
 */
export async function requestAttachmentWork(
  deps: Pick<ApiDependencies, 'db' | 'caseAttachmentScans' | 'caseRenditions'>,
  environmentId: string,
  attachmentIds: readonly string[],
): Promise<void> {
  for (const id of attachmentIds) {
    const attachment = await getCaseAttachmentRow(deps.db, environmentId, id);
    if (attachment?.redactedAt !== null) {
      // Gone, or redacted since it was stored.
      continue;
    }
    if (attachment.scanStatus === 'pending') {
      await deps.caseAttachmentScans?.enqueueCaseAttachmentScan({
        environmentId,
        caseAttachmentId: id,
      });
    }
    if (attachment.renditionStatus === 'pending') {
      await deps.caseRenditions?.enqueueCaseRendition({ environmentId, sourceId: id });
    }
  }
}
