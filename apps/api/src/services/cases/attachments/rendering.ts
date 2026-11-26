/**
 * C135.3 (Workflow 8B, `api-case-files`; decisions 62, 63, F25): the `case-rendition` job's work, for
 * an attachment (`catt_`) or an inquiry's file (`file_`).
 *
 * - It reads the sealed original, asks the vision service's rendition lane for its metadata-free
 *   pages, seals each page (its `<source>/<page>` id as the context) under a new storage key, puts it,
 *   and then, in one transaction under the source's state row lock, writes the pages and records the
 *   rendition `ready` while it is still `pending` and its source alive. A source redacted meanwhile
 *   wins: nothing is written, and the pages just put are deleted.
 * - A retryable vision failure (a 5xx, the lane busy, a timeout) leaves the rendition `pending` with
 *   one more attempt counted: the content route's next request, which the console repeats on its
 *   Retry-After, asks again. Any other failure (vision refused the file, a page count of none, an
 *   object that fails its checks) records it `failed` with `rendition_unavailable`, served as 422.
 * - An attachment the scanner found `infected`, or could not scan, is never rendered: its rendition
 *   is recorded `failed` with `rendition_unavailable`, unread (R008, Workflow 8D review), so the
 *   recovery sweep does not enqueue it again.
 *
 * Nothing here logs a byte, a filename or a page.
 */
import {
  encryptBytes,
  getCaseAttachmentRow,
  getFile,
  getFileRendition,
  getInquiry,
  getVerification,
  insertRenditionPages,
  lockCaseAttachmentRow,
  lockFileRendition,
  recordCaseAttachmentRendition,
  recordFileRendition,
  type Db,
  type Keyring,
  type NewRenditionPage,
  type RenditionOutcome,
} from '@openverify/db';
import { isId } from '@openverify/contracts';
import type { WorkerLogger } from '../../../jobs/logger.js';
import type {
  Clock,
  FileStorage,
  VisionClient,
  VisionDocument,
  VisionRendition,
} from '../../../ports.js';
import { newStorageKey } from '../../../storage/index.js';
import { VisionError } from '../../../vision/index.js';
import { ObjectUnreadableError, openSealedObject } from './objects.js';

export interface RenditionJobDeps {
  db: Db;
  storage: FileStorage;
  keyring: Keyring;
  vision: VisionClient;
  clock: Clock;
  logger: Pick<WorkerLogger, 'warn' | 'error'>;
}

/** The code of a rendition vision could not make (C135.3, Stage 1a amendment 42). */
export const RENDITION_UNAVAILABLE = 'rendition_unavailable';

/**
 * R003 (Workflow 8C review): the attempts a rendition gets, as a scan gets `scan-attempts` (P23). A
 * source that failed retryably this often is `failed` with `rendition_unavailable`, so one document
 * the vision service cannot render in time stops taking its one rendition lane at every view.
 */
export const RENDITION_ATTEMPTS = 3;

/** What a source's rendition reads from it. */
interface Source {
  document: VisionDocument;
  /** The attempts recorded so far (each outcome written counts one). */
  attempts: number;
  /** Writes the outcome under the source's lock; `false` when the source moved on meanwhile. */
  record: (tx: Db, outcome: RenditionOutcome) => Promise<boolean>;
  lock: (tx: Db) => Promise<boolean>;
}

const RENDERABLE: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

type Opened =
  { kind: 'open'; source: Source } | { kind: 'skip' } | { kind: 'failed'; source: Source };

async function attachmentSource(
  deps: RenditionJobDeps,
  environmentId: string,
  id: string,
): Promise<Opened> {
  const row = await getCaseAttachmentRow(deps.db, environmentId, id);
  if (row === null) {
    return { kind: 'skip' };
  }
  if (
    row.redactedAt !== null ||
    row.storageKey === null ||
    row.wrappedDek === null ||
    row.renditionStatus !== 'pending'
  ) {
    return { kind: 'skip' };
  }
  const record = async (tx: Db, outcome: RenditionOutcome) =>
    (await recordCaseAttachmentRendition(tx, environmentId, id, outcome)) !== null;
  const lock = async (tx: Db) => {
    const locked = await lockCaseAttachmentRow(tx, environmentId, id);
    return locked !== null && locked.redactedAt === null && locked.renditionStatus === 'pending';
  };
  if (row.scanStatus === 'infected' || row.scanStatus === 'error') {
    // R008 (Workflow 8D review): both verdicts are final, so no rendition is ever made of it; it is
    // recorded `failed` unread, never sent to vision, and leaves the set the recovery sweep lists.
    return {
      kind: 'failed',
      source: { document: emptyDocument, attempts: row.renditionAttempts, record, lock },
    };
  }
  try {
    const bytes = await openSealedObject(deps, {
      storageKey: row.storageKey,
      wrappedDek: row.wrappedDek,
      context: row.id,
      byteSize: row.byteSize,
      sha256: row.sha256,
    });
    return {
      kind: 'open',
      source: {
        document: { bytes, mimeType: row.mimeType as VisionDocument['mimeType'] },
        attempts: row.renditionAttempts,
        record,
        lock,
      },
    };
  } catch (error) {
    if (error instanceof ObjectUnreadableError) {
      deps.logger.error({ attachmentId: id }, 'attachment object is unreadable; no rendition');
      return {
        kind: 'failed',
        source: { document: emptyDocument, attempts: row.renditionAttempts, record, lock },
      };
    }
    throw error;
  }
}

const emptyDocument: VisionDocument = { bytes: new Uint8Array(), mimeType: 'application/pdf' };

async function fileSource(
  deps: RenditionJobDeps,
  environmentId: string,
  id: string,
): Promise<Opened> {
  const [file, state] = await Promise.all([
    getFile(deps.db, environmentId, id),
    getFileRendition(deps.db, environmentId, id),
  ]);
  if (file?.deletedAt !== null || state?.status !== 'pending') {
    // Gone or deleted, or not waiting for a rendition.
    return { kind: 'skip' };
  }
  const verification = await getVerification(deps.db, environmentId, file.verificationId);
  const inquiry =
    verification === null ? null : await getInquiry(deps.db, environmentId, verification.inquiryId);
  if (inquiry?.redactedAt !== null) {
    return { kind: 'skip' };
  }
  const record = async (tx: Db, outcome: RenditionOutcome) =>
    (await recordFileRendition(tx, environmentId, id, outcome)) !== null;
  const lock = async (tx: Db) =>
    (await lockFileRendition(tx, environmentId, id))?.status === 'pending';
  const { attempts } = state;
  if (!RENDERABLE.has(file.mimeType)) {
    return { kind: 'failed', source: { document: emptyDocument, attempts, record, lock } };
  }
  try {
    const bytes = await openSealedObject(deps, {
      storageKey: file.storageKey,
      wrappedDek: file.wrappedDek,
      context: file.id,
      byteSize: file.byteSize,
      sha256: file.sha256,
    });
    return {
      kind: 'open',
      source: {
        document: { bytes, mimeType: file.mimeType as VisionDocument['mimeType'] },
        attempts,
        record,
        lock,
      },
    };
  } catch (error) {
    if (error instanceof ObjectUnreadableError) {
      deps.logger.error({ fileId: id }, 'file object is unreadable; no rendition');
      return { kind: 'failed', source: { document: emptyDocument, attempts, record, lock } };
    }
    throw error;
  }
}

async function recordOutcome(deps: RenditionJobDeps, source: Source, outcome: RenditionOutcome) {
  await deps.db.transaction(async (tx) => {
    if (await source.lock(tx)) {
      await source.record(tx, outcome);
    }
  });
}

/** Renders one source; a source gone, redacted or no longer pending is left as it is. */
export async function renderSource(
  deps: RenditionJobDeps,
  environmentId: string,
  sourceId: string,
): Promise<void> {
  const opened = isId('catt', sourceId)
    ? await attachmentSource(deps, environmentId, sourceId)
    : isId('file', sourceId)
      ? await fileSource(deps, environmentId, sourceId)
      : ({ kind: 'skip' } as const);
  if (opened.kind === 'skip') {
    return;
  }
  if (opened.kind === 'failed') {
    await recordOutcome(deps, opened.source, {
      status: 'failed',
      errorCode: RENDITION_UNAVAILABLE,
    });
    return;
  }
  const { source } = opened;
  if (source.attempts >= RENDITION_ATTEMPTS) {
    source.document.bytes.fill(0);
    await recordOutcome(deps, source, { status: 'failed', errorCode: RENDITION_UNAVAILABLE });
    return;
  }
  let rendition: VisionRendition;
  try {
    rendition = await deps.vision.createRendition({ source: source.document });
  } catch (error) {
    if (!(error instanceof VisionError)) {
      throw error;
    }
    if (error.retryable && source.attempts + 1 < RENDITION_ATTEMPTS) {
      deps.logger.warn({ sourceId, endpoint: error.endpoint }, 'rendition will be asked again');
      await recordOutcome(deps, source, { status: 'pending' });
    } else {
      await recordOutcome(deps, source, {
        status: 'failed',
        errorCode: RENDITION_UNAVAILABLE,
      });
    }
    return;
  } finally {
    source.document.bytes.fill(0);
  }
  if (rendition.pages.length === 0) {
    await recordOutcome(deps, source, { status: 'failed', errorCode: RENDITION_UNAVAILABLE });
    return;
  }
  const pages: NewRenditionPage[] = [];
  for (const page of rendition.pages) {
    const storageKey = newStorageKey(environmentId);
    const sealed = encryptBytes(page.bytes, deps.keyring, {
      context: `${sourceId}/${String(page.page)}`,
    });
    await deps.storage.put(storageKey, sealed.ciphertext);
    pages.push({
      sourceId,
      page: page.page,
      mediaType: page.mediaType,
      width: page.width,
      height: page.height,
      byteSize: page.bytes.byteLength,
      storageKey,
      wrappedDek: sealed.wrappedDek,
    });
  }
  const written = await deps.db.transaction(async (tx) => {
    if (!(await source.lock(tx))) {
      return false;
    }
    await insertRenditionPages(tx, environmentId, pages);
    return source.record(tx, {
      status: 'ready',
      pageCount: pages.length,
      truncated: rendition.truncated,
      renderedAt: deps.clock.now(),
    });
  });
  if (!written) {
    for (const { storageKey } of pages) {
      await deps.storage.delete(storageKey).catch(() => {
        deps.logger.warn({ sourceId }, 'a rendition page left by a lost race was not deleted');
      });
    }
  }
}
