/**
 * C135.3 (Workflow 8B, checkpoint (F)): renditions, the metadata-free images a reader sees instead of
 * an original. `file_renditions` holds an inquiry file's state; `rendition_pages` the sealed page
 * objects of a file's or an attachment's rendition, keyed `<source id>/<page>`. Owner
 * `api-case-files`; `foundation-8b` froze the names, and the owner adds what else it needs here.
 *
 * - A file's rendition is requested once (`pending`), and a job records it on the state row while it
 *   is still pending, so a job that lost a race with a redaction writes nothing.
 * - A source's pages are discarded with it (`discarded_at`), never served again, and a file's state
 *   reads `deleted`; the C16 pass deletes the objects of discarded pages and of pages whose source
 *   row is gone (Stage 1a amendment 9: three paths delete a `files` row outright), then the rows.
 */
import { and, asc, eq, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import {
  caseAttachments,
  fileRenditions,
  renditionPages,
  type FileRenditionRow,
  type RenditionPageRow,
} from '../tables/case-files.js';
import { files } from '../tables/verifications.js';
import type { RenditionOutcome } from './case-attachments.js';
import { firstOrNull } from './rows.js';

export type FileRendition = FileRenditionRow;
export type RenditionPage = RenditionPageRow;

/** One page a rendition job stores, its object already sealed and put. */
export interface NewRenditionPage {
  sourceId: string;
  page: number;
  mediaType: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
  byteSize: number;
  storageKey: string;
  wrappedDek: string;
}

/** A page object the C16 pass deletes, then its row. */
export interface RenditionPageObject {
  id: string;
  environmentId: string;
  storageKey: string;
}

const renditionOf = (environmentId: string, fileId: string) =>
  and(eq(fileRenditions.environmentId, environmentId), eq(fileRenditions.fileId, fileId));

/** The rendition state of one inquiry file, or `null` before it was requested. */
export async function getFileRendition(
  db: Db,
  environmentId: string,
  fileId: string,
): Promise<FileRendition | null> {
  return firstOrNull(
    await db.select().from(fileRenditions).where(renditionOf(environmentId, fileId)),
  );
}

/** C135.3: the file's rendition state, written `pending` when it was never requested. */
export async function requestFileRendition(
  db: Db,
  environmentId: string,
  fileId: string,
): Promise<FileRendition> {
  await db
    .insert(fileRenditions)
    .values({ fileId, environmentId })
    .onConflictDoNothing({ target: fileRenditions.fileId });
  const row = await getFileRendition(db, environmentId, fileId);
  if (row === null) {
    throw new Error(`requestFileRendition: file ${fileId} has no rendition state here`);
  }
  return row;
}

/** The file's rendition state `FOR UPDATE`, or `null`: what a job and a redaction serialise on. */
export async function lockFileRendition(
  tx: Db,
  environmentId: string,
  fileId: string,
): Promise<FileRendition | null> {
  return firstOrNull(
    await tx.select().from(fileRenditions).where(renditionOf(environmentId, fileId)).for('update'),
  );
}

/** C135.3: a rendition's outcome on a file whose rendition is still `pending`; `null` otherwise. */
export async function recordFileRendition(
  tx: Db,
  environmentId: string,
  fileId: string,
  outcome: RenditionOutcome,
): Promise<FileRendition | null> {
  return firstOrNull(
    await tx
      .update(fileRenditions)
      .set({
        status: outcome.status,
        attempts: sql`${fileRenditions.attempts} + 1`,
        ...(outcome.status === 'ready'
          ? {
              pageCount: outcome.pageCount,
              truncated: outcome.truncated,
              renderedAt: outcome.renderedAt,
            }
          : {}),
        ...(outcome.status === 'failed' ? { errorCode: outcome.errorCode } : {}),
      })
      .where(and(renditionOf(environmentId, fileId), eq(fileRenditions.status, 'pending')))
      .returning(),
  );
}

/** A source's pages that are still served, in page order (`rendition_pages_source_idx`). */
export async function listRenditionPages(
  db: Db,
  environmentId: string,
  sourceId: string,
): Promise<RenditionPage[]> {
  return db
    .select()
    .from(renditionPages)
    .where(
      and(
        eq(renditionPages.environmentId, environmentId),
        eq(renditionPages.sourceId, sourceId),
        isNull(renditionPages.discardedAt),
      ),
    )
    .orderBy(asc(renditionPages.page));
}

/** C135.3: a rendition's pages, written in the transaction that records it ready. */
export async function insertRenditionPages(
  tx: Db,
  environmentId: string,
  pages: readonly NewRenditionPage[],
): Promise<void> {
  if (pages.length === 0) {
    return;
  }
  await tx.insert(renditionPages).values(
    pages.map((page) => ({
      id: `${page.sourceId}/${String(page.page)}`,
      environmentId,
      sourceId: page.sourceId,
      page: page.page,
      mediaType: page.mediaType,
      width: page.width,
      height: page.height,
      byteSize: page.byteSize,
      storageKey: page.storageKey,
      wrappedDek: page.wrappedDek,
    })),
  );
}

/**
 * C135.3 (V19): marks the pages of `sourceIds` discarded in `tx` and answers their storage keys, which
 * the caller deletes after its commit; the C16 pass deletes what a failed delete left, then the rows.
 * A file's rendition state reads `deleted`, so no job writes its pages again.
 */
export async function discardRenditionPagesInTx(
  tx: Db,
  environmentId: string,
  sourceIds: readonly string[],
): Promise<string[]> {
  if (sourceIds.length === 0) {
    return [];
  }
  const fileIds = sourceIds.filter((id) => id.startsWith('file_'));
  if (fileIds.length > 0) {
    await tx
      .update(fileRenditions)
      .set({ status: 'deleted', pageCount: null, renderedAt: null, errorCode: null })
      .where(
        and(
          eq(fileRenditions.environmentId, environmentId),
          inArray(fileRenditions.fileId, fileIds),
        ),
      );
  }
  const rows = await tx
    .update(renditionPages)
    .set({ discardedAt: sql`now()` })
    .where(
      and(
        eq(renditionPages.environmentId, environmentId),
        inArray(renditionPages.sourceId, [...sourceIds]),
        isNull(renditionPages.discardedAt),
      ),
    )
    .returning({ storageKey: renditionPages.storageKey });
  return rows.map(({ storageKey }) => storageKey).sort();
}

/** C16: pages discarded, or whose source row is gone, at most `limit`, across environments. */
export async function listPurgeableRenditionPages(
  db: Db,
  limit: number,
): Promise<RenditionPageObject[]> {
  const orphan = or(
    and(
      sql`${renditionPages.sourceId} like 'file\\_%'`,
      sql`not exists (select 1 from ${files} where ${files.id} = ${renditionPages.sourceId})`,
    ),
    and(
      sql`${renditionPages.sourceId} like 'catt\\_%'`,
      sql`not exists (select 1 from ${caseAttachments}
        where ${caseAttachments.id} = ${renditionPages.sourceId})`,
    ),
  );
  return db
    .select({
      id: renditionPages.id,
      environmentId: renditionPages.environmentId,
      storageKey: renditionPages.storageKey,
    })
    .from(renditionPages)
    .where(or(isNotNull(renditionPages.discardedAt), orphan))
    .orderBy(asc(renditionPages.createdAt), asc(renditionPages.id))
    .limit(limit);
}

/** C16: deletes page rows whose objects are gone; answers how many. */
export async function deleteRenditionPageRows(db: Db, ids: readonly string[]): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }
  const rows = await db
    .delete(renditionPages)
    .where(inArray(renditionPages.id, [...ids]))
    .returning({ id: renditionPages.id });
  return rows.length;
}

/**
 * K8-28 (Workflow 8D): the rendition sources (an unredacted attachment or an inquiry's file) whose
 * rendition has been `pending` since before `before`, oldest first, across environments, for the
 * sweep to enqueue again.
 */
export async function listPendingRenditionSources(
  db: Db,
  before: Date,
  limit: number,
): Promise<{ sourceId: string; environmentId: string }[]> {
  const attachments = await db
    .select({
      sourceId: caseAttachments.id,
      environmentId: caseAttachments.environmentId,
      at: caseAttachments.updatedAt,
    })
    .from(caseAttachments)
    .where(
      and(
        eq(caseAttachments.renditionStatus, 'pending'),
        isNull(caseAttachments.redactedAt),
        lt(caseAttachments.updatedAt, before),
      ),
    )
    .orderBy(asc(caseAttachments.updatedAt), asc(caseAttachments.id))
    .limit(limit);
  const renditions = await db
    .select({
      sourceId: fileRenditions.fileId,
      environmentId: fileRenditions.environmentId,
      at: fileRenditions.updatedAt,
    })
    .from(fileRenditions)
    .where(and(eq(fileRenditions.status, 'pending'), lt(fileRenditions.updatedAt, before)))
    .orderBy(asc(fileRenditions.updatedAt), asc(fileRenditions.fileId))
    .limit(limit);
  return [...attachments, ...renditions]
    .sort(
      (left, right) =>
        left.at.getTime() - right.at.getTime() ||
        (left.sourceId < right.sourceId ? -1 : left.sourceId > right.sourceId ? 1 : 0),
    )
    .slice(0, limit)
    .map(({ sourceId, environmentId }) => ({ sourceId, environmentId }));
}
