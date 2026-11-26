/**
 * C42.7 `face-index:rebuild` (a model change only): re-embeds the centre file of every verification
 * that already has a face template, through `/v1/embed/face` (as a selfie, vision's default
 * subject), and rewrites the template and its background row (the layout from a new centre
 * analysis; an existing row is kept as it is when the new analysis measures no layout), keeping
 * `created_at`. It never creates a row.
 *
 * Each row is rebuilt in one transaction under the C40.6 lock order: the inquiry (its redaction,
 * status and matching consent re-checked under the lock), then the template row, then its
 * background row. A row is deleted instead when its centre file is gone or unreadable, when the new
 * model finds no face in it, when its consent no longer holds, or when its inquiry was redacted,
 * declined or failed (C42.2). A vision failure leaves the row as it is, counted, for the next run.
 * The vision calls happen before the transaction, so no lock is held while vision works. A dry run
 * reads the rows and decrypts the files to count what would happen, calls no vision endpoint and
 * writes nothing.
 *
 * Reports counts only; templates, embeddings and layouts are never logged.
 */
import {
  deleteFaceTemplate,
  getInquiry,
  getInquiryTemplateVersion,
  listFaceTemplateRefs,
  listSelfieCaptures,
  listVerificationFiles,
  lockFaceTemplate,
  lockInquiry,
  rewriteFaceTemplate,
  rewriteSelfieBackground,
  type BackgroundLayoutInput,
  type Db,
  type FaceTemplateRef,
  type Keyring,
} from '@openverify/db';
import { safeStoredFlowView } from '../services/stored-flow.js';
import type { FileStorage, VisionClient, VisionImage } from '../ports.js';
import { isUnreadableImageError } from '../vision/index.js';
import { latestOfKind, readStoredImage } from './images.js';
import type { WorkerLogger } from './logger.js';
import { matchingConsentHolds } from './selfie.js';

export interface FaceIndexRebuildDeps {
  db: Db;
  storage: FileStorage;
  keyring: Keyring;
  vision: VisionClient;
  logger?: Pick<WorkerLogger, 'warn'> | undefined;
}

export interface FaceIndexRebuildOptions {
  /** Count what would change; write nothing and call no vision endpoint. */
  dryRun: boolean;
  /** Template rows read per page. */
  batchSize: number;
}

/** Counts only, never ids or data. */
export interface FaceIndexRebuildReport {
  examined: number;
  /** Rewritten (or, in a dry run, that would be). */
  rewritten: number;
  /** Deleted: files gone, no face, consent gone, or an inquiry redacted, declined or failed. */
  deleted: number;
  /** Left as they were because vision failed; the next run tries them again. */
  failed: number;
}

type Outcome = 'rewritten' | 'deleted' | 'failed';

/** The new template and layout vision gave, or why the row cannot be rebuilt. */
type Rebuilt =
  | {
      kind: 'template';
      model: string;
      embedding: readonly number[];
      layout: BackgroundLayoutInput | null;
    }
  | { kind: 'gone' }
  | { kind: 'failed' };

/**
 * C94.6 (Workflow 7A, V03): the session that created the template's capture: the newest processed
 * capture of its verification; `null` before Phase 7 or without one.
 */
async function templateSessionOf(db: Db, ref: FaceTemplateRef): Promise<string | null> {
  const captures = await listSelfieCaptures(db, ref.environmentId, {
    verificationId: ref.verificationId,
  });
  return captures.find((capture) => capture.status === 'processed')?.createdBySessionId ?? null;
}

/** Whether the row may keep a template: its inquiry open to it and its matching consent held. */
async function eligible(db: Db, ref: FaceTemplateRef): Promise<boolean> {
  const inquiry = await getInquiry(db, ref.environmentId, ref.inquiryId);
  const closed = new Set(['declined', 'failed']);
  if (inquiry?.redactedAt !== null || closed.has(inquiry.status)) {
    return false;
  }
  const version = await getInquiryTemplateVersion(
    db,
    ref.environmentId,
    inquiry.inquiryTemplateVersionId,
  );
  const flow = safeStoredFlowView(version?.flow);
  return (
    flow !== null &&
    matchingConsentHolds(
      db,
      {
        environmentId: ref.environmentId,
        inquiryId: ref.inquiryId,
        sessionId: await templateSessionOf(db, ref),
      },
      flow,
    )
  );
}

/** The decrypted centre file of the row's verification, or `null` when it can no longer be read. */
async function centreImage(
  deps: FaceIndexRebuildDeps,
  ref: FaceTemplateRef,
): Promise<VisionImage | null> {
  const center = latestOfKind(
    await listVerificationFiles(deps.db, ref.environmentId, [ref.verificationId]),
    'selfie-center',
  );
  return center === undefined ? null : readStoredImage(deps, center);
}

/** The new embedding (and, for a row with a background, the new layout) from vision. */
async function reembed(
  deps: FaceIndexRebuildDeps,
  ref: FaceTemplateRef,
  image: VisionImage,
): Promise<Rebuilt> {
  try {
    const embedded = await deps.vision.embedFace({ image });
    if (embedded.face === null) {
      return { kind: 'gone' };
    }
    const row = await lockFaceTemplate(deps.db, ref.environmentId, ref.id);
    let layout: BackgroundLayoutInput | null = null;
    if (row?.hasBackground === true) {
      const background = (await deps.vision.analyzeSelfie({ center: image })).poses.center
        .background;
      layout =
        background === null
          ? null
          : {
              layout: background.layout,
              validCells: background.valid_cells,
              coverage: background.coverage,
            };
    }
    return {
      kind: 'template',
      model: embedded.model_versions.recognizer,
      embedding: embedded.face.embedding,
      layout,
    };
  } catch (error) {
    if (isUnreadableImageError(error)) {
      return { kind: 'gone' };
    }
    deps.logger?.warn(
      { environmentId: ref.environmentId, error: (error as Error).name },
      'face-index:rebuild: vision failed; the template is left as it is',
    );
    return { kind: 'failed' };
  }
}

/** Rebuilds or deletes one row, in one transaction under the C40.6 lock order. */
async function rebuildOne(
  deps: FaceIndexRebuildDeps,
  ref: FaceTemplateRef,
  dryRun: boolean,
): Promise<Outcome> {
  const image = await centreImage(deps, ref);
  let rebuilt: Rebuilt;
  try {
    if (dryRun) {
      return image !== null && (await eligible(deps.db, ref)) ? 'rewritten' : 'deleted';
    }
    rebuilt = image === null ? { kind: 'gone' } : await reembed(deps, ref, image);
  } finally {
    image?.bytes.fill(0);
  }
  if (rebuilt.kind === 'failed') {
    return 'failed';
  }
  return deps.db.transaction(async (tx): Promise<Outcome> => {
    await lockInquiry(tx, ref.environmentId, ref.inquiryId);
    const keep = rebuilt.kind === 'template' && (await eligible(tx, ref));
    const row = await lockFaceTemplate(tx, ref.environmentId, ref.id);
    if (row === null) {
      // Deleted meanwhile (a redaction, a decline, retention): nothing to rebuild or create.
      return 'deleted';
    }
    if (!keep || rebuilt.kind !== 'template') {
      await deleteFaceTemplate(tx, ref.environmentId, ref.id);
      return 'deleted';
    }
    await rewriteFaceTemplate(tx, ref.environmentId, {
      id: ref.id,
      model: rebuilt.model,
      embedding: rebuilt.embedding,
    });
    if (row.hasBackground && rebuilt.layout !== null) {
      await rewriteSelfieBackground(tx, ref.environmentId, {
        faceTemplateId: ref.id,
        ...rebuilt.layout,
      });
    }
    return 'rewritten';
  });
}

/** One run over every environment's template rows, page by page. */
export async function rebuildFaceIndex(
  deps: FaceIndexRebuildDeps,
  options: FaceIndexRebuildOptions,
): Promise<FaceIndexRebuildReport> {
  const report: FaceIndexRebuildReport = { examined: 0, rewritten: 0, deleted: 0, failed: 0 };
  let after: string | undefined;
  for (;;) {
    const page = await listFaceTemplateRefs(deps.db, { after, limit: options.batchSize });
    if (page.length === 0) {
      return report;
    }
    for (const ref of page) {
      report.examined += 1;
      report[await rebuildOne(deps, ref, options.dryRun)] += 1;
    }
    after = page.at(-1)?.id;
  }
}
