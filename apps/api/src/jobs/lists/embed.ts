/**
 * C97.4, C99.7 (Workflow 7B): the `list-item-embed` job and its sweep.
 *
 * - **A pending item.** The job re-embeds the source inquiry's centre selfie through vision, while
 *   the file still exists; for a background, it takes the layout from the selfie analysis and a
 *   person-masked image from `/v1/mask/background`, sealed as an envelope object for the item. The
 *   item becomes `active`, or `archived` with `source_unavailable` when the selfie, the face, the
 *   room or the consent is gone.
 * - **Vision works outside any transaction.** So the commit asks again, in the order every writer
 *   locks (the basis under its shared lock, then the inquiry): a redaction, a cleared basis or a
 *   rejected handoff that landed meanwhile wins, and the object just written is deleted.
 * - **A redacted item with an object left.** Redaction keeps the object's key on the side row, with
 *   no layout, so nothing can orphan it; the job deletes the object, then the row, and a storage
 *   failure comes back on the next sweep.
 * - **The sweep** runs every 15 s. It redacts what is past its window, no later than
 *   `face-template-retention-days` after the source consent (P08), then enqueues what is pending
 *   and what is left to purge, so a lost enqueue recovers.
 *
 * A retryable vision failure is thrown for BullMQ's backoff, and the item stays `pending`, which a
 * screening reads as `list_items_pending`, never "no match". Embeddings, layouts and images stay in
 * memory and are wiped after use: never logged, never in a result.
 */
import {
  DEFAULT_SWEEP_LIMIT,
  archiveUnavailableBiometricItem,
  completeListItemBackground,
  completeListItemFace,
  deleteRedactedBackgroundRow,
  encryptBytes,
  getBiometricItem,
  getInquiry,
  listBiometricItemsPastRetention,
  listMaskedObjectsToPurge,
  listPendingBiometricItems,
  lockInquiry,
  readBiometricListsBasis,
  redactBiometricItems,
  type BackgroundLayoutInput,
  type BiometricItem,
  type BiometricItemRef,
  type Db,
  type Inquiry,
  type Keyring,
} from '@openverify/db';
import type {
  Clock,
  FileStorage,
  ListItemEmbedJob,
  ListItemEmbedQueue,
  VisionClient,
  VisionImage,
} from '../../ports.js';
import {
  latestSelfieOf,
  selfieConsentHolds,
  type SourceSelfie,
} from '../../services/lists/biometric/source-selfie.js';
import { BACKGROUND_MIN_COVERAGE } from '../../services/lists/biometric/thresholds.js';
import type { StagedEvent, TransactionalEventPublisher } from '../../events/index.js';
import { afterListItemsRedactedInTx } from '../../services/lists/list-writes.js';
import { stageListUpdated } from '../../workflows/actions/lists/list-updated.js';
import { newStorageKey } from '../../storage/index.js';
import { attemptVision, type VisionAttempt } from '../attempts.js';
import { PermanentJobError } from '../errors.js';
import { readStoredImage } from '../images.js';
import type { WorkerLogger } from '../logger.js';

export interface ListItemEmbedDeps {
  /** C127.12: an item that became matchable, or left, stages `list.updated`. */
  events: TransactionalEventPublisher;
  db: Db;
  clock: Clock;
  logger: WorkerLogger;
  storage: FileStorage;
  keyring: Keyring;
  vision: Pick<VisionClient, 'embedFace' | 'analyzeSelfie' | 'maskBackground'>;
}

export interface ListItemEmbedResult {
  status: 'active' | 'archived' | 'purged' | 'skipped';
}

export type ProcessListItemEmbed = (
  job: ListItemEmbedJob,
  deps: ListItemEmbedDeps,
) => Promise<ListItemEmbedResult>;

/** What vision answered, or `null` when the image cannot give it: the source is unavailable. */
async function answerOf<T>(
  call: () => Promise<T>,
  deps: ListItemEmbedDeps,
  itemId: string,
): Promise<T | null> {
  const answered: VisionAttempt<T> = await attemptVision(call, {
    // BullMQ and then the sweep retry for as long as vision is away.
    lastAttempt: false,
    logger: deps.logger,
    log: { itemId },
  });
  if (answered.ok) {
    return answered.value;
  }
  if (answered.unreadable) {
    return null;
  }
  throw new PermanentJobError('vision_response');
}

/** The write under the locks, or nothing when the item stops being embeddable. */
type Completion = (tx: Db) => Promise<boolean>;

async function embedFace(
  deps: ListItemEmbedDeps,
  item: BiometricItem,
  environmentId: string,
  image: VisionImage,
): Promise<Completion | null> {
  const { itemId } = item;
  const embedded = await answerOf(() => deps.vision.embedFace({ image }), deps, itemId);
  if (embedded?.face == null) {
    return null;
  }
  const { embedding } = embedded.face;
  const model = embedded.model_versions.recognizer;
  return (tx) => completeListItemFace(tx, environmentId, { itemId, embedding, model });
}

interface BackgroundEmbedding {
  layout: BackgroundLayoutInput;
  masked: Uint8Array;
}

async function backgroundOf(
  deps: ListItemEmbedDeps,
  itemId: string,
  image: VisionImage,
): Promise<BackgroundEmbedding | null> {
  const analysis = await answerOf(() => deps.vision.analyzeSelfie({ center: image }), deps, itemId);
  const background = analysis?.poses.center.background ?? null;
  if (background === null || background.coverage < BACKGROUND_MIN_COVERAGE) {
    return null;
  }
  const masked = await answerOf(() => deps.vision.maskBackground({ image }), deps, itemId);
  return masked === null
    ? null
    : {
        masked,
        layout: {
          layout: background.layout,
          validCells: background.valid_cells,
          coverage: background.coverage,
        },
      };
}

/** Under the locks: the basis, the inquiry, its consent; then the write. */
async function commit(
  deps: ListItemEmbedDeps,
  environmentId: string,
  { sourceInquiryId, listId }: Pick<BiometricItem, 'sourceInquiryId' | 'listId'>,
  complete: Completion,
): Promise<boolean> {
  const staged: StagedEvent[] = [];
  const completed = await deps.db.transaction(async (tx) => {
    if ((await readBiometricListsBasis(tx, environmentId)) === null) {
      return false;
    }
    await lockInquiry(tx, environmentId, sourceInquiryId);
    const inquiry = await getInquiry(tx, environmentId, sourceInquiryId);
    if (inquiry?.redactedAt !== null) {
      return false;
    }
    const selfie = await latestSelfieOf(tx, environmentId, sourceInquiryId);
    if (!((await selfieConsentHolds(tx, inquiry, selfie)) && (await complete(tx)))) {
      return false;
    }
    // C127.12 (outcome 25): the item can match from here on, and a pending one staged nothing.
    staged.push(
      ...(await stageListUpdated(tx, deps, environmentId, [
        { listId, changeKind: 'items-added', items: 1 },
      ])),
    );
    return true;
  });
  await deps.events.dispatch(staged);
  return completed;
}

/** The readable centre selfie of a source whose consent holds, or `null`. */
async function sourceImageOf(
  deps: ListItemEmbedDeps,
  inquiry: Inquiry | null,
  selfie: SourceSelfie | null,
): Promise<VisionImage | null> {
  if (
    inquiry?.redactedAt !== null ||
    selfie?.center == null ||
    !(await selfieConsentHolds(deps.db, inquiry, selfie))
  ) {
    return null;
  }
  return readStoredImage(deps, selfie.center);
}

async function archive(
  deps: ListItemEmbedDeps,
  environmentId: string,
  { itemId, listId }: BiometricItem,
): Promise<ListItemEmbedResult> {
  const staged = await deps.db.transaction(async (tx) =>
    (await archiveUnavailableBiometricItem(tx, environmentId, itemId, deps.clock.now()))
      ? stageListUpdated(tx, deps, environmentId, [
          { listId, changeKind: 'items-archived', items: 1 },
        ])
      : [],
  );
  await deps.events.dispatch(staged);
  return { status: 'archived' };
}

/** The masked object first, then its row, so a failure leaves the sweep something to find. */
async function purge(
  deps: ListItemEmbedDeps,
  environmentId: string,
  item: BiometricItem,
): Promise<ListItemEmbedResult> {
  if (item.maskedFileKey === null) {
    return { status: 'skipped' };
  }
  await deps.storage.delete(item.maskedFileKey);
  await deleteRedactedBackgroundRow(deps.db, environmentId, item.itemId);
  return { status: 'purged' };
}

async function embedBackground(
  deps: ListItemEmbedDeps,
  item: BiometricItem,
  environmentId: string,
  image: VisionImage,
): Promise<ListItemEmbedResult> {
  const { itemId } = item;
  const background = await backgroundOf(deps, itemId, image);
  if (background === null) {
    return archive(deps, environmentId, item);
  }
  // The image's own key, so the row and the object are written or abandoned together.
  const maskedFileKey = newStorageKey(environmentId);
  const sealed = encryptBytes(background.masked, deps.keyring, { context: itemId });
  background.masked.fill(0);
  await deps.storage.put(maskedFileKey, sealed.ciphertext);
  const completed = await commit(deps, environmentId, item, (tx) =>
    completeListItemBackground(tx, environmentId, {
      itemId,
      ...background.layout,
      maskedFileKey,
      maskedFileWrappedDek: sealed.wrappedDek,
    }),
  ).catch(async (error: unknown) => {
    await deps.storage.delete(maskedFileKey).catch(() => undefined);
    throw error;
  });
  if (!completed) {
    await deps.storage.delete(maskedFileKey);
  }
  return { status: completed ? 'active' : 'skipped' };
}

/** C97.4, C99.7: one item, as the file's header says. */
export const processListItemEmbed: ProcessListItemEmbed = async (job, deps) => {
  const { environmentId, itemId } = job;
  const item = await getBiometricItem(deps.db, environmentId, itemId);
  if (item === null) {
    return { status: 'skipped' };
  }
  if (item.redactedAt !== null) {
    return purge(deps, environmentId, item);
  }
  if (item.status !== 'pending' || item.listStatus !== 'active') {
    return { status: 'skipped' };
  }
  const { sourceInquiryId } = item;
  const inquiry = await getInquiry(deps.db, environmentId, sourceInquiryId);
  const selfie = await latestSelfieOf(deps.db, environmentId, sourceInquiryId);
  const image = await sourceImageOf(deps, inquiry, selfie);
  if (image === null) {
    return archive(deps, environmentId, item);
  }
  try {
    if (item.kind === 'selfie-background') {
      return await embedBackground(deps, item, environmentId, image);
    }
    const complete = await embedFace(deps, item, environmentId, image);
    if (complete === null) {
      return await archive(deps, environmentId, item);
    }
    const completed = await commit(deps, environmentId, item, complete);
    return { status: completed ? 'active' : 'skipped' };
  } finally {
    image.bytes.fill(0);
  }
};

export interface ListItemEmbedSweepDeps {
  events: TransactionalEventPublisher;
  db: Db;
  clock: Clock;
  logger: WorkerLogger;
  embeds: ListItemEmbedQueue;
}

export type RunListItemEmbedSweep = (deps: ListItemEmbedSweepDeps) => Promise<void>;

/** C99.7 (P08): redacts what is past its window, each environment in its own transaction. */
async function redactPastRetention(
  db: Db,
  events: TransactionalEventPublisher,
  now: Date,
): Promise<number> {
  const due = await listBiometricItemsPastRetention(db, { now, limit: DEFAULT_SWEEP_LIMIT });
  const byEnvironment = new Map<string, string[]>();
  for (const { environmentId, itemId } of due) {
    byEnvironment.set(environmentId, [...(byEnvironment.get(environmentId) ?? []), itemId]);
  }
  for (const [environmentId, itemIds] of byEnvironment) {
    const staged = await db.transaction(async (tx) =>
      afterListItemsRedactedInTx(
        tx,
        { events },
        environmentId,
        await redactBiometricItems(tx, environmentId, itemIds, { at: now }),
        now,
      ),
    );
    await events.dispatch(staged);
  }
  return due.length;
}

export const runListItemEmbedSweep: RunListItemEmbedSweep = async (deps) => {
  const { db, clock, logger, embeds, events } = deps;
  const redacted = await redactPastRetention(db, events, clock.now());
  const jobs: BiometricItemRef[] = [
    ...(await listPendingBiometricItems(db, { limit: DEFAULT_SWEEP_LIMIT })),
    ...(await listMaskedObjectsToPurge(db, { limit: DEFAULT_SWEEP_LIMIT })),
  ];
  let enqueued = 0;
  for (const job of jobs) {
    try {
      await embeds.enqueueListItemEmbed(job);
      enqueued += 1;
    } catch (error) {
      logger.warn({ error: (error as Error).name }, 'list-item-embed could not be enqueued');
    }
  }
  if (redacted > 0 || enqueued > 0) {
    logger.info({ redacted, enqueued }, 'list-item-embed sweep');
  }
};
