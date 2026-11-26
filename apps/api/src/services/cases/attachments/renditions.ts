/**
 * C135.3 (Workflow 8B (F); V19, V27, P22): renditions, the metadata-free images the console and every
 * export serve instead of an original, made asynchronously on the `case-rendition` queue. Owner
 * `api-case-files`; `foundation-8b` froze these hooks and called them from the shared files:
 *
 * - {@link deleteRenditionsForFilesInTx} wherever an inquiry's `files` row is redacted or deleted:
 *   the inquiry's redaction and a child inquiry's (`services/redaction.ts`,
 *   `workflows/actions/transactions/children.ts`), `POST /transactions/:id/redact-biometrics`, a
 *   rejected handoff, and the three deletes of a `files` row outright (a replaced upload, a replaced
 *   server-written file and a discarded selfie capture, Stage 1a amendment 9). It discards the files'
 *   pages (never served again), marks their rendition `deleted` so no job writes it again, and answers
 *   the pages' keys, which each caller deletes after its commit.
 * - {@link purgeDiscardedRenditions} in the C16 pass, beside `purgeRedactedFiles`: the objects of
 *   discarded pages and of pages whose source row is gone, then their rows; and the objects a failed
 *   delete left of redacted attachments, each row then marked deleted.
 * - {@link requestRenditionsForFiles} from the verification job after its commit
 *   (`jobs/process-verification.ts`, inventory 13.1): each image or PDF file's rendition is requested
 *   (`pending`) and enqueued; the console's first request makes any that was lost.
 */
import {
  deleteRenditionPageRows,
  discardRenditionPagesInTx,
  getFile,
  listPurgeableRenditionPages,
  listUndeletedRedactedCaseAttachments,
  markCaseAttachmentsDeleted,
  requestFileRendition,
  type Db,
} from '@openverify/db';
import type { WorkerLogger } from '../../../jobs/logger.js';
import type { CaseRenditionQueue, Clock, FileStorage } from '../../../ports.js';

/** The files whose renditions go, in the transaction that redacts or deletes them. */
export interface RenditionFiles {
  environmentId: string;
  fileIds: readonly string[];
}

/** The media types a rendition is made of: the four an upload may hold. */
export const RENDERABLE_MEDIA_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

/**
 * Discards the renditions of `fileIds` in `tx` and answers the storage keys of their pages, which
 * the caller deletes after its commit; the C16 pass deletes what a failed delete left.
 */
export function deleteRenditionsForFilesInTx(tx: Db, files: RenditionFiles): Promise<string[]> {
  return discardRenditionPagesInTx(tx, files.environmentId, files.fileIds);
}

export interface PurgeDiscardedRenditionsOptions {
  db: Db;
  storage: FileStorage;
  clock?: Clock | undefined;
  /** Pages per batch. */
  limit?: number | undefined;
  logger?: Pick<WorkerLogger, 'warn'> | undefined;
}

/** Pages, and leftover attachment objects, per batch of the C16 pass. */
export const RENDITION_PURGE_BATCH = 500;

/**
 * C16: deletes the objects of discarded or orphaned rendition pages, then their rows, and finishes
 * redacted attachments whose objects a failed delete left; answers how many pages it purged. A
 * delete that fails is logged by id and left for the next pass.
 */
export async function purgeDiscardedRenditions(
  options: PurgeDiscardedRenditionsOptions,
): Promise<number> {
  const { db, storage, logger } = options;
  const limit = options.limit ?? RENDITION_PURGE_BATCH;
  const at = options.clock?.now() ?? new Date();
  const deleted: string[] = [];
  for (const page of await listPurgeableRenditionPages(db, limit)) {
    try {
      await storage.delete(page.storageKey);
      deleted.push(page.id);
    } catch {
      logger?.warn({ renditionPageId: page.id }, 'rendition page object could not be deleted');
    }
  }
  const purged = await deleteRenditionPageRows(db, deleted);
  for (const attachment of await listUndeletedRedactedCaseAttachments(db, limit)) {
    try {
      await storage.delete(attachment.storageKey);
    } catch {
      logger?.warn({ attachmentId: attachment.id }, 'attachment object could not be deleted');
      continue;
    }
    await markCaseAttachmentsDeleted(db, attachment.environmentId, [attachment.id], at);
  }
  return purged;
}

export interface RenditionRequestDeps {
  db: Db;
  /** The `case-rendition` producer; without it nothing is requested and the first view makes it. */
  renditions?: CaseRenditionQueue | undefined;
  logger: Pick<WorkerLogger, 'warn'>;
}

/** C135.3 (V27): asks for the renditions of a verification's files, after the job's commit. */
export async function requestRenditionsForFiles(
  deps: RenditionRequestDeps,
  files: RenditionFiles,
): Promise<void> {
  if (deps.renditions === undefined) {
    return;
  }
  for (const fileId of files.fileIds) {
    const file = await getFile(deps.db, files.environmentId, fileId);
    if (file?.deletedAt !== null || !RENDERABLE_MEDIA_TYPES.has(file.mimeType)) {
      // Gone or deleted, or of a kind no rendition is made of.
      continue;
    }
    const state = await requestFileRendition(deps.db, files.environmentId, fileId);
    if (state.status === 'pending') {
      await deps.renditions.enqueueCaseRendition({
        environmentId: files.environmentId,
        sourceId: fileId,
      });
    }
  }
}
