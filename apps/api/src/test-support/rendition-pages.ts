/**
 * K8-29 (Workflow 8D review): an inquiry file's rendition as a rendition job leaves it, `ready` with
 * one page whose object is stored, and what a test reads back once a path discarded it: the page
 * row's `discarded_at`, the file's rendition state and the page's object. Every value is synthetic.
 */
import {
  fileRenditions,
  recordFileRendition,
  renditionPages,
  requestFileRendition,
  type Db,
} from '@openverify/db';
import { seedRenditionPage } from '@openverify/db/testing';
import { eq } from 'drizzle-orm';
import type { FileStorage } from '../ports.js';

export interface RenderedPage {
  pageId: string;
  storageKey: string;
}

/** One rendered page of `fileId`: its rendition `ready`, the page row and its object stored. */
export async function renderedPage(
  db: Db,
  storage: Pick<FileStorage, 'put'>,
  environmentId: string,
  fileId: string,
): Promise<RenderedPage> {
  await requestFileRendition(db, environmentId, fileId);
  await recordFileRendition(db, environmentId, fileId, {
    status: 'ready',
    pageCount: 1,
    truncated: false,
    renderedAt: new Date(),
  });
  const pageId = await seedRenditionPage(db, environmentId, { sourceId: fileId });
  const storageKey = `${environmentId}/renditions/${pageId}`;
  await storage.put(storageKey, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  return { pageId, storageKey };
}

export interface RenditionAfter {
  /** Whether the page row is discarded, never served again (`null` when the row is gone). */
  discarded: boolean | null;
  /** The file's rendition state, `null` once the state went with its file row. */
  status: string | null;
}

/** What the page and the file's rendition read after a path ran. */
export async function renditionAfter(
  db: Db,
  fileId: string,
  page: RenderedPage,
): Promise<RenditionAfter> {
  const [stored] = await db
    .select({ discardedAt: renditionPages.discardedAt })
    .from(renditionPages)
    .where(eq(renditionPages.id, page.pageId));
  const [state] = await db
    .select({ status: fileRenditions.status })
    .from(fileRenditions)
    .where(eq(fileRenditions.fileId, fileId));
  return {
    discarded: stored === undefined ? null : stored.discardedAt !== null,
    status: state?.status ?? null,
  };
}
