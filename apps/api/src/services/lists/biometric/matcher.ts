/**
 * C99.7 (Workflow 7B): `BiometricListMatcher`, advisory only: a match here is a record for a person
 * to read, never a decline (ADR 0006). It runs in the worker, on the screening job and the custom
 * list report; `POST /lists/match` answers these lists `method_not_on_demand`.
 *
 * - **The probe** is the inquiry's centre selfie, under its own consent (`source-selfie.ts`). An
 *   inquiry with no decided selfie has nothing to compare (`subject_has_no_value`); one without
 *   `consent.biometric-matching` is `consent_not_given`, and no image is opened.
 * - **Faces.** The list's templates are decrypted in the worker (`cache.ts`) and scored by cosine
 *   against the probe's embedding at `FACE_LIST_THRESHOLD`. A template of another model is not
 *   comparable, so the list reads `normaliser_outdated` while the others still count.
 * - **Backgrounds.** The nearest layouts by an exact scan, then ORB and RANSAC on at most five
 *   masked images through `/v1/compare/background`, under the Phase 4 limits (H, `beta`). The score
 *   is the inlier ratio. `compared` counts the images scored, and the scan's rest were ruled out
 *   by colour alone: this is a prefilter, as Phase 4's is.
 * - **Never "no match" for what was not read** (H02): a pending item, an outdated model, an object
 *   or a template that cannot be opened, or a probe vision could not read leaves the list in
 *   `unscreened`, beside whatever matches the rest gave.
 *
 * A worker's cached copy is the only one of its kind, and whoever changes a list may be another
 * process, so the check here reads the lists' states every 15 s while the cache holds anything: a
 * version change, an archive, a redaction and a cleared basis all reach it there, and a list idle
 * ten minutes goes too. A check that cannot read the lists drops everything, since it cannot say
 * what still may be held.
 *
 * Embeddings, layouts and images stay in memory, wiped after use, and are never logged.
 */
import { detectImageMimeType } from '@openverify/contracts';
import {
  DecryptionError,
  decodeFaceTemplate,
  decryptBytes,
  getInquiry,
  listBiometricListStates,
  listCachedListStates,
  listListFaceTemplates,
  nearestListBackgrounds,
  type BiometricListState,
  type Db,
  type Keyring,
  type ListBackgroundCandidate,
} from '@openverify/db';
import { attemptVision, type AttemptContext } from '../../../jobs/attempts.js';
import { readStoredImage } from '../../../jobs/images.js';
import type { WorkerLogger } from '../../../jobs/logger.js';
import type {
  BiometricListMatcher,
  BiometricListOutcome,
  Clock,
  FileStorage,
  VisionClient,
  VisionImage,
} from '../../../ports.js';
import {
  createBiometricCache,
  wipeGallery,
  type BiometricCache,
  type FaceGallery,
} from './cache.js';
import { latestSelfieOf, selfieConsentHolds } from './source-selfie.js';
import {
  BACKGROUND_LIST_CANDIDATES,
  BACKGROUND_MIN_COVERAGE,
  BACKGROUND_MIN_INLIERS,
  BACKGROUND_MIN_INLIER_RATIO,
  BIOMETRIC_CACHE_BYTES,
  BIOMETRIC_CACHE_IDLE_MS,
  FACE_LIST_THRESHOLD,
} from './thresholds.js';

/** As long as a sweep: the most a redaction or a cleared basis waits to reach a worker's memory. */
const CACHE_CHECK_INTERVAL_MS = 15_000;
/** Vision's own precision for a score (`_SCORE_DECIMALS`). */
const SCORE_FACTOR = 10_000;

export interface BiometricMatcherDeps {
  db: Db;
  clock: Clock;
  logger: WorkerLogger;
  storage: FileStorage;
  keyring: Keyring;
  vision: Pick<VisionClient, 'embedFace' | 'analyzeSelfie' | 'compareBackground'>;
  cache?: BiometricCache | undefined;
  /** Runs `check` every period; answers how to stop. Defaults to an unref'd interval. */
  schedule?: ((check: () => void) => () => void) | undefined;
}

export interface WorkerBiometricListMatcher extends BiometricListMatcher {
  readonly cache: BiometricCache;
  /** Checks the cached lists against the database; what the schedule runs. */
  checkCache(): Promise<void>;
}

/** What the selfie gave: each part `null` when vision could not read it. */
interface Probe {
  face: { embedding: Float32Array; model: string } | null;
  background: { layout: readonly number[]; coverage: number } | null;
}

const score = (value: number): number =>
  Math.round(Math.min(value, 1) * SCORE_FACTOR) / SCORE_FACTOR;

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let index = 0; index < a.length; index += 1) {
    sum += (a[index] ?? 0) * (b[index] ?? 0);
  }
  return sum;
}

const defaultSchedule = (check: () => void) => {
  const timer = setInterval(check, CACHE_CHECK_INTERVAL_MS);
  timer.unref();
  return () => {
    clearInterval(timer);
  };
};

export function createBiometricListMatcher(deps: BiometricMatcherDeps): WorkerBiometricListMatcher {
  const { db, logger, storage, keyring, vision } = deps;
  const cache =
    deps.cache ??
    createBiometricCache({
      maxBytes: BIOMETRIC_CACHE_BYTES,
      idleMs: BIOMETRIC_CACHE_IDLE_MS,
      clock: deps.clock,
    });
  const schedule = deps.schedule ?? defaultSchedule;
  let stopChecks: (() => void) | null = null;

  async function checkCache(): Promise<void> {
    cache.sweepIdle();
    try {
      const states = await listCachedListStates(db, cache.listIds());
      cache.reconcile(new Map(states.map(({ id, ...state }) => [id, state])));
    } catch (error) {
      cache.clear();
      logger.warn({ error: (error as Error).name }, 'the biometric cache could not be checked');
    }
    if (cache.listIds().length === 0) {
      stopChecks?.();
      stopChecks = null;
    }
  }

  const startChecks = () => {
    stopChecks ??= schedule(() => {
      void checkCache();
    });
  };

  /** The list's templates, from the cache or opened; `held` says whether the cache keeps them. */
  async function galleryOf(
    environmentId: string,
    state: BiometricListState,
  ): Promise<{ gallery: FaceGallery; held: boolean }> {
    const cached = cache.get(state.id, state.version);
    if (cached !== null) {
      return { gallery: cached, held: true };
    }
    const rows = await listListFaceTemplates(db, environmentId, state.id);
    const gallery = rows.map(({ itemId, model, template }) => ({
      itemId,
      model,
      vector: Float32Array.from(decodeFaceTemplate(template)),
    }));
    const held = cache.set(state.id, state.version, gallery);
    if (held) {
      startChecks();
    }
    return { gallery, held };
  }

  /** One face list: scored with no `await`, since another job's eviction wipes a gallery. */
  async function scanFaces(
    environmentId: string,
    state: BiometricListState,
    face: NonNullable<Probe['face']>,
    outcome: BiometricListOutcome,
  ): Promise<void> {
    const { id: listId } = state;
    let loaded;
    try {
      loaded = await galleryOf(environmentId, state);
    } catch (error) {
      if (!(error instanceof DecryptionError)) {
        throw error;
      }
      logger.warn({ listId, error: error.name }, 'a list template could not be opened');
      outcome.unscreened.push({ 'list-id': listId, reason: 'probe_unavailable' });
      return;
    }
    let compared = 0;
    let outdated = 0;
    let best: number | null = null;
    for (const { itemId, model, vector } of loaded.gallery) {
      if (model !== face.model || vector.length !== face.embedding.length) {
        outdated += 1;
        continue;
      }
      const cosine = dot(vector, face.embedding);
      compared += 1;
      best = best === null ? cosine : Math.max(best, cosine);
      if (cosine >= FACE_LIST_THRESHOLD) {
        outcome.matches.push({
          listId,
          listItemId: itemId,
          listVersion: state.version,
          method: 'face_cosine',
          score: score(cosine),
        });
      }
    }
    if (!loaded.held) {
      wipeGallery(loaded.gallery);
    }
    outcome.compared.push({ listId, compared, bestScore: best === null ? null : score(best) });
    if (state.pending > 0) {
      outcome.unscreened.push({ 'list-id': listId, reason: 'list_items_pending' });
    } else if (outdated > 0) {
      outcome.unscreened.push({ 'list-id': listId, reason: 'normaliser_outdated' });
    }
  }

  /** A candidate's masked image, or `null` when it can no longer be read. */
  async function maskedImageOf(candidate: ListBackgroundCandidate): Promise<VisionImage | null> {
    const { itemId, maskedFileKey, maskedFileWrappedDek } = candidate;
    const ciphertext = await storage.get(maskedFileKey);
    if (ciphertext === null) {
      return null;
    }
    try {
      const bytes = decryptBytes({ wrappedDek: maskedFileWrappedDek, ciphertext }, keyring, {
        context: itemId,
      });
      const mimeType = detectImageMimeType(bytes);
      return mimeType === null ? null : { bytes, mimeType };
    } catch {
      return null;
    }
  }

  /** One background list: the exact scan, then ORB on what could be read. */
  async function confirmBackgrounds(
    environmentId: string,
    state: BiometricListState,
    probe: { image: VisionImage; layout: readonly number[] },
    outcome: BiometricListOutcome,
    context: AttemptContext,
  ): Promise<void> {
    const { id: listId } = state;
    const candidates = await nearestListBackgrounds(db, environmentId, {
      listId,
      layout: probe.layout,
      limit: BACKGROUND_LIST_CANDIDATES,
    });
    const read: { itemId: string; image: VisionImage }[] = [];
    try {
      for (const candidate of candidates) {
        const image = await maskedImageOf(candidate);
        if (image !== null) {
          read.push({ itemId: candidate.itemId, image });
        }
      }
      const unreadable = candidates.length - read.length;
      if (read.length === 0) {
        outcome.compared.push({ listId, compared: 0, bestScore: null });
      } else {
        const answered = await attemptVision(
          () =>
            vision.compareBackground({
              probe: probe.image,
              candidates: read.map(({ image }) => image),
            }),
          context,
        );
        if (!answered.ok) {
          outcome.unscreened.push({ 'list-id': listId, reason: 'probe_unavailable' });
          return;
        }
        let best: number | null = null;
        for (const { index, inliers, inlier_ratio: ratio } of answered.value.results) {
          const candidate = read[index];
          best = best === null ? ratio : Math.max(best, ratio);
          if (
            candidate !== undefined &&
            inliers >= BACKGROUND_MIN_INLIERS &&
            ratio >= BACKGROUND_MIN_INLIER_RATIO
          ) {
            outcome.matches.push({
              listId,
              listItemId: candidate.itemId,
              listVersion: state.version,
              method: 'background',
              score: score(ratio),
            });
          }
        }
        outcome.compared.push({
          listId,
          compared: read.length,
          bestScore: best === null ? null : score(best),
        });
      }
      if (state.pending > 0) {
        outcome.unscreened.push({ 'list-id': listId, reason: 'list_items_pending' });
      } else if (unreadable > 0) {
        outcome.unscreened.push({ 'list-id': listId, reason: 'probe_unavailable' });
      }
    } finally {
      for (const { image } of read) {
        image.bytes.fill(0);
      }
    }
  }

  /** The probe: the selfie analysis when a background is asked for, which also gives the face. */
  async function probeOf(
    image: VisionImage,
    lists: readonly BiometricListState[],
    context: AttemptContext,
  ): Promise<Probe> {
    if (lists.some(({ kind }) => kind === 'selfie-background')) {
      const analysis = await attemptVision(() => vision.analyzeSelfie({ center: image }), context);
      if (!analysis.ok) {
        return { face: null, background: null };
      }
      const { model_versions: models, poses } = analysis.value;
      const { face, background } = poses.center;
      return {
        face:
          face === null
            ? null
            : {
                embedding: Float32Array.from(face.embedding),
                model: models.recognizer,
              },
        background,
      };
    }
    const embedded = await attemptVision(() => vision.embedFace({ image }), context);
    const face = embedded.ok ? embedded.value.face : null;
    return {
      face:
        !embedded.ok || face === null
          ? null
          : {
              embedding: Float32Array.from(face.embedding),
              model: embedded.value.model_versions.recognizer,
            },
      background: null,
    };
  }

  return {
    cache,
    checkCache,
    async match({ environmentId, inquiryId, lists, lastAttempt }) {
      const outcome: BiometricListOutcome = { matches: [], unscreened: [], compared: [] };
      const states = new Map(
        (
          await listBiometricListStates(
            db,
            environmentId,
            lists.map(({ id }) => id),
          )
        ).map((state) => [state.id, state]),
      );
      const readable: BiometricListState[] = [];
      for (const { id } of lists) {
        const state = states.get(id);
        if (state?.status === 'active') {
          readable.push(state);
        } else {
          cache.evict(id);
          outcome.unscreened.push({ 'list-id': id, reason: 'list_archived' });
        }
      }
      if (readable.length === 0) {
        return outcome;
      }
      const refuseAll = (reason: 'consent_not_given' | 'probe_unavailable') => {
        for (const { id } of readable) {
          outcome.unscreened.push({ 'list-id': id, reason });
        }
        return outcome;
      };
      const inquiry = await getInquiry(db, environmentId, inquiryId);
      if (inquiry?.redactedAt !== null) {
        return refuseAll('consent_not_given');
      }
      const selfie = await latestSelfieOf(db, environmentId, inquiryId);
      if (selfie === null) {
        outcome.notApplicable = readable.map(({ id }) => ({
          'list-id': id,
          reason: 'subject_has_no_value',
        }));
        return outcome;
      }
      if (!(await selfieConsentHolds(db, inquiry, selfie))) {
        return refuseAll('consent_not_given');
      }
      const image = selfie.center === null ? null : await readStoredImage(deps, selfie.center);
      if (image === null) {
        return refuseAll('probe_unavailable');
      }
      const context: AttemptContext = {
        lastAttempt: lastAttempt ?? true,
        logger,
        log: { inquiryId },
      };
      let probe: Probe | null = null;
      try {
        probe = await probeOf(image, readable, context);
        for (const state of readable) {
          const { id: listId } = state;
          if (state.kind === 'face') {
            if (probe.face === null) {
              outcome.unscreened.push({ 'list-id': listId, reason: 'probe_unavailable' });
            } else {
              await scanFaces(environmentId, state, probe.face, outcome);
            }
          } else if (probe.background === null) {
            outcome.unscreened.push({ 'list-id': listId, reason: 'probe_unavailable' });
          } else if (probe.background.coverage < BACKGROUND_MIN_COVERAGE) {
            outcome.unscreened.push({ 'list-id': listId, reason: 'probe_too_coarse' });
          } else {
            await confirmBackgrounds(
              environmentId,
              state,
              { image, layout: probe.background.layout },
              outcome,
              context,
            );
          }
        }
        return outcome;
      } finally {
        image.bytes.fill(0);
        probe?.face?.embedding.fill(0);
      }
    },
  };
}
