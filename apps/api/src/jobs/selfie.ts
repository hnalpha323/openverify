/**
 * The selfie evaluation of the `process-verification` job (Phase 4, C40.9, C42, C43, C44):
 *
 * 1. the newest submitted capture (C40.9): its prompts, its pose files (only files uploaded under
 *    it count), its `prompt-timings` and its device snapshot, decrypted here and reduced to flags
 *    (`captureDeviceFlags`); a selfie submitted before Phase 4 has no capture (C40.7) and its files
 *    are analysed as they are;
 * 2. vision analyses every pose with its `source` (C41.1); a failure follows the C30.3 rule;
 * 3. while the centre image is decrypted, the bound A-tier providers answer (C44: `{ image }` only,
 *    plus `{ referenceId, birthdate }` for a sandbox provider) and, with matching consent, the
 *    background search compares the room with the centre files of other faces (C42.8);
 * 4. the reference portrait of the latest eligible government ID is re-embedded (C43), the
 *    account's templates and the 1:N scan are read with matching consent (C42.3, C42.4), and the
 *    capture's poses are looked up for byte replays (C43);
 * 5. every enabled §4.2 evaluator runs over one context (`evaluateSelfieChecks`), with the
 *    template's config, the environment kind (the sandbox test-capture rule) and the pinned models.
 *
 * The centre face and layout are returned for the decision transaction, which stores them only
 * for a passed, live selfie compared with its ID, with matching consent (C42.2). Embeddings,
 * landmarks, layouts and the device snapshot stay in memory: never logged, never in a result.
 */
import {
  FACE_SCAN_FLOOR,
  captureDeviceFlags,
  evaluateSelfieChecks,
  oneToOneFaceThreshold,
  selfieCheckConfig,
  selfieContext,
  unreadableImageChecks,
  type AccountTemplatesInput,
  type BackgroundSearchInput,
  type ProviderOutcome,
  type RepeatScanInput,
  type SelfieCaptureInput,
  type SelfieHistoryInput,
  type SelfieIdReferenceInput,
  type SelfieProviderOutcomes,
} from '@openverify/checks';
import { SELFIE_POSE_FILE_KINDS, selfieDeviceSnapshotSchema } from '@openverify/contracts';
import {
  FACE_MATCH_DEFAULTS,
  type CheckResult,
  type VerificationTemplateConfig,
} from '@openverify/core';
import {
  DecryptionError,
  findNearestSelfieBackgrounds,
  findReplayedDigests,
  getEnvironment,
  getGovernmentIdExtraction,
  getEffectiveConsent,
  type ConsentHolder,
  listAccountFaceTemplates,
  listInquiryIdsOfAccount,
  listInquiryVerifications,
  listVerificationFiles,
  newestSubmittedSelfieCapture,
  resolveFaceTemplateSettings,
  selfieCapturePromptTimings,
  type BackgroundLayoutInput,
  type Db,
  type Inquiry,
  type SelfieCapture,
  type StoredFile,
} from '@openverify/db';
import type { Flow } from '@openverify/flow-spec';
import type {
  EnvironmentKind,
  ProviderBindings,
  ProviderIdentity,
  SandboxSelfieContext,
  SelfieAnalysis,
  SelfieProviderRequest,
  VisionClient,
  VisionImage,
} from '../ports.js';
import { MATCHING_CONSENT_TEXT_KEY } from '../services/inquiry-templates.js';
import { MAX_BACKGROUND_CANDIDATES } from '../vision/index.js';
import { attemptProvider, attemptVision, type AttemptContext } from './attempts.js';
import { PermanentJobError } from './errors.js';
import { visionFailureChecks } from './execution-errors.js';
import { bestTemplateCosine, cosineOf, faceGroups, scanFaceTemplates } from './face-search.js';
import { latestOfKind, readStoredImage, withImages, type ImageDeps } from './images.js';
import type { WorkerLogger } from './logger.js';
import { selfieModels } from './models.js';

export type SelfiePose = 'center' | 'left' | 'right';

const POSES: readonly SelfiePose[] = ['center', 'left', 'right'];

/** Nearest background rows examined per search (HNSW, C42.8). */
export const BACKGROUND_NEIGHBOURS = 20;
/** At most this many candidates are compared through `/v1/compare/background` (C41.2). */
export const BACKGROUND_CANDIDATES = MAX_BACKGROUND_CANDIDATES;

const DAY_MS = 86_400_000;

export interface SelfieDeps extends ImageDeps {
  db: Db;
  vision: VisionClient;
  logger: WorkerLogger;
  providers?: ProviderBindings | undefined;
  /** The Phase 1 face match threshold option (`FACE_MATCH_DEFAULTS` when omitted, C39.3). */
  faceMatchThreshold?: number | undefined;
}

export interface SelfieJob {
  environmentId: string;
  environmentKind: EnvironmentKind;
  inquiry: Inquiry;
  verificationId: string;
  /** The pinned template version's flow (its consent step). */
  flow: Flow;
  files: readonly StoredFile[];
  config: VerificationTemplateConfig;
  now: Date;
  lastAttempt: boolean;
}

/** What a passed decision may store (C42.2): the centre face and its layout. */
export interface FaceDataToStore {
  /** The recogniser vision reports, such as `sface-2021dec`. */
  model: string;
  embedding: readonly number[];
  background: BackgroundLayoutInput | null;
}

export interface SelfieEvaluation {
  results: CheckResult[];
  /** Vision could not read a pose: the Phase 1 `image_unreadable` results. */
  unreadable: boolean;
  /** The newest submitted capture, which the decision moves to `processed`. */
  capture: SelfieCapture | null;
  /** The centre face and layout, when matching consent holds and vision found the face. */
  faceData: FaceDataToStore | null;
}

const isEnabled = (config: VerificationTemplateConfig, check: string): boolean =>
  config.checks[check]?.enabled === true;

/**
 * C42.3: whether matching consent holds: the pinned version's consent step lists
 * `consent.biometric-matching` (required or optional) and the consent of `holder` includes it.
 * C94.6 (Workflow 7A, V03): the holder is the inquiry and the session that created the capture
 * (`created_by_session_id`), `null` for a capture from before Phase 7.
 */
export async function matchingConsentHolds(
  db: Db,
  holder: ConsentHolder,
  flow: Flow,
): Promise<boolean> {
  const listed = flow.steps.some(
    (step) =>
      step.type === 'consent' &&
      (step.textKeys.includes(MATCHING_CONSENT_TEXT_KEY) ||
        (step.optionalTextKeys ?? []).includes(MATCHING_CONSENT_TEXT_KEY)),
  );
  if (!listed) {
    return false;
  }
  const consent = await getEffectiveConsent(db, holder);
  return (
    consent !== null &&
    (consent.textKeys.includes(MATCHING_CONSENT_TEXT_KEY) ||
      (consent.optionalTextKeys ?? []).includes(MATCHING_CONSENT_TEXT_KEY))
  );
}

/**
 * The file of each pose: of the capture's prompts, only files uploaded under it; without a capture
 * (before Phase 4), every selfie file the verification has.
 */
function poseFiles(
  files: readonly StoredFile[],
  capture: SelfieCapture | null,
): Partial<Record<SelfiePose, StoredFile>> {
  const poses = capture === null ? POSES : capture.prompts;
  return Object.fromEntries(
    poses.flatMap((pose) => {
      const file = files
        .filter(
          (candidate) =>
            candidate.kind === SELFIE_POSE_FILE_KINDS[pose] &&
            (capture === null || candidate.selfieCaptureId === capture.id),
        )
        .at(-1);
      return file === undefined ? [] : [[pose, file]];
    }),
  );
}

/** The latest government ID the selfie compares with: `passed`, `submitted` or `needs_review`. */
async function referenceVerificationOf(deps: SelfieDeps, job: SelfieJob) {
  return (await listInquiryVerifications(deps.db, job.environmentId, job.inquiry.id))
    .filter(
      (verification) =>
        verification.type === 'government_id' &&
        (verification.status === 'passed' ||
          verification.status === 'submitted' ||
          verification.status === 'needs_review'),
    )
    .at(-1);
}

/**
 * C43 `selfie_id_comparison`: the reference's portrait, re-embedded from its stored front with
 * `/v1/embed/face` as a `document` (K101); or what is missing; or `error` when vision failed for
 * good (C30.3). A stored front that is gone or unreadable has no portrait.
 */
async function idReferenceOf(
  deps: SelfieDeps,
  job: SelfieJob,
  reference: { id: string } | undefined,
): Promise<SelfieIdReferenceInput> {
  if (reference === undefined) {
    return { kind: 'missing', missing: 'government_id' };
  }
  const front = latestOfKind(
    await listVerificationFiles(deps.db, job.environmentId, [reference.id]),
    'front',
  );
  const image = front === undefined ? null : await readStoredImage(deps, front);
  if (image === null) {
    return { kind: 'missing', missing: 'portrait' };
  }
  try {
    const embedded = await attemptVision(
      () => deps.vision.embedFace({ image, subject: 'document' }),
      {
        lastAttempt: job.lastAttempt,
        logger: deps.logger,
        log: { verificationId: job.verificationId, check: 'selfie_id_comparison' },
      },
    );
    if (!embedded.ok) {
      return embedded.unreadable ? { kind: 'missing', missing: 'portrait' } : { kind: 'error' };
    }
    const { face } = embedded.value;
    return face === null
      ? { kind: 'missing', missing: 'portrait' }
      : { kind: 'portrait', verificationId: reference.id, embedding: face.embedding };
  } finally {
    image.bytes.fill(0);
  }
}

/** The compared ID's birthdate (`YYYY-MM-DD`), from its stored extraction; `null` without one. */
async function birthdateOf(
  deps: SelfieDeps,
  job: SelfieJob,
  reference: { id: string } | undefined,
): Promise<string | null> {
  if (reference === undefined) {
    return null;
  }
  const extraction = await getGovernmentIdExtraction(deps.db, job.environmentId, reference.id);
  return extraction?.fields?.birthdate ?? null;
}

const identityOf = (provider: ProviderIdentity) => ({ id: provider.id, sandbox: provider.sandbox });

/** Asks a bound provider under the C30.3 rule; `not_configured` without one. */
async function ask<Provider extends ProviderIdentity, Result>(
  provider: Provider | undefined,
  call: (provider: Provider) => Promise<Result>,
  context: AttemptContext,
): Promise<ProviderOutcome<Result>> {
  if (provider === undefined) {
    return { kind: 'not_configured' };
  }
  const answered = await attemptProvider(() => call(provider), context);
  return answered.ok
    ? { kind: 'result', provider: identityOf(provider), result: answered.value }
    : { kind: 'error' };
}

/**
 * C44: the outcomes of the enabled A-tier selfie checks. Every provider gets `{ image }`, the
 * centre image only; a real adapter is called with that one argument, and only a provider whose
 * identity has `sandbox: true` also gets the {@link SandboxSelfieContext}.
 */
async function askProviders(
  deps: SelfieDeps,
  job: SelfieJob,
  image: VisionImage,
  sandbox: SandboxSelfieContext,
): Promise<SelfieProviderOutcomes> {
  const bound = deps.providers?.[job.environmentKind] ?? {};
  const request: SelfieProviderRequest = { image };
  const context = (check: string): AttemptContext => ({
    lastAttempt: job.lastAttempt,
    logger: deps.logger,
    log: { verificationId: job.verificationId, check },
  });
  const outcomes: SelfieProviderOutcomes = {};
  if (isEnabled(job.config, 'selfie_age_comparison')) {
    outcomes.selfieAgeEstimate = await ask(
      bound.selfieAgeEstimate,
      (provider) =>
        provider.sandbox ? provider.estimateAge(request, sandbox) : provider.estimateAge(request),
      context('selfie_age_comparison'),
    );
  }
  if (isEnabled(job.config, 'selfie_public_figure_detection')) {
    outcomes.selfiePublicFigure = await ask(
      bound.selfiePublicFigure,
      (provider) =>
        provider.sandbox
          ? provider.matchPublicFigure(request, sandbox)
          : provider.matchPublicFigure(request),
      context('selfie_public_figure_detection'),
    );
  }
  if (isEnabled(job.config, 'selfie_suspicious_entity_detection')) {
    outcomes.suspiciousEntity = await ask(
      bound.suspiciousEntity,
      (provider) =>
        provider.sandbox ? provider.assess(request, sandbox) : provider.assess(request),
      context('selfie_suspicious_entity_detection'),
    );
  }
  return outcomes;
}

/** A failure to open stored face data: recorded on the check, never retried (C30.3). */
function unopenable(deps: SelfieDeps, job: SelfieJob, check: string, error: unknown): void {
  if (!(error instanceof DecryptionError)) {
    throw error;
  }
  deps.logger.warn(
    { verificationId: job.verificationId, check, error: error.name },
    'stored face data could not be opened; its check is recorded as execution_error',
  );
}

/** C42.8 `selfie_account_comparison`: the account's other templates, all of them. */
async function accountComparison(
  deps: SelfieDeps,
  job: SelfieJob,
  embedding: readonly number[],
): Promise<AccountTemplatesInput> {
  try {
    const templates = await listAccountFaceTemplates(deps.db, job.environmentId, {
      accountId: job.inquiry.accountId,
      excludeInquiryId: job.inquiry.id,
    });
    return {
      kind: 'compared',
      templates: templates.length,
      bestCosine: bestTemplateCosine(
        embedding,
        templates.map((template) => template.embedding),
      ),
    };
  } catch (error) {
    unopenable(deps, job, 'selfie_account_comparison', error);
    return { kind: 'error' };
  }
}

/**
 * C42.4 `selfie_repeat_detection`: the 1:N scan outside the inquiry and every inquiry of its
 * account (resolved through `inquiries.account_id` now), up to `face-search-max-templates`.
 */
async function repeatScan(
  deps: SelfieDeps,
  job: SelfieJob,
  embedding: readonly number[],
): Promise<RepeatScanInput> {
  const environment = await getEnvironment(deps.db, job.environmentId);
  const settings = resolveFaceTemplateSettings(environment?.settings ?? {});
  const accountInquiries = await listInquiryIdsOfAccount(
    deps.db,
    job.environmentId,
    job.inquiry.accountId,
  );
  try {
    return await scanFaceTemplates(deps.db, job.environmentId, {
      embedding,
      excludeInquiryIds: [...new Set([job.inquiry.id, ...accountInquiries])],
      maxTemplates: settings['face-search-max-templates'],
      floor: FACE_SCAN_FLOOR,
    });
  } catch (error) {
    unopenable(deps, job, 'selfie_repeat_detection', error);
    return { kind: 'error' };
  }
}

interface BackgroundProbe {
  image: VisionImage;
  embedding: readonly number[];
  layout: readonly number[];
  /** The effective 1:1 face threshold: a candidate's face must differ from the current one. */
  faceThreshold: number;
  windowDays: number;
}

/**
 * C42.8 `selfie_similar_background_detection`: the nearest background rows within `window-days`
 * of other accounts, keeping those whose template's face differs from the current one; their
 * centre files are read through `listVerificationFiles` (a missing or undecryptable one, or a
 * template that cannot be opened, is skipped and counted) and at most five are compared with the
 * current centre through `/v1/compare/background`.
 */
async function searchBackgrounds(
  deps: SelfieDeps,
  job: SelfieJob,
  probe: BackgroundProbe,
): Promise<BackgroundSearchInput> {
  const neighbours = await findNearestSelfieBackgrounds(deps.db, job.environmentId, {
    layout: probe.layout,
    since: new Date(job.now.getTime() - probe.windowDays * DAY_MS),
    excludeAccountId: job.inquiry.accountId,
    limit: BACKGROUND_NEIGHBOURS,
  });
  let skipped = 0;
  const chosen: { embedding: readonly number[]; faceCosine: number; image: VisionImage }[] = [];
  try {
    for (const neighbour of neighbours) {
      if (chosen.length === BACKGROUND_CANDIDATES) {
        break;
      }
      if (neighbour.template === null) {
        skipped += 1;
        continue;
      }
      const faceCosine = cosineOf(neighbour.template.embedding, probe.embedding);
      if (faceCosine >= probe.faceThreshold) {
        continue;
      }
      const center = latestOfKind(
        await listVerificationFiles(deps.db, job.environmentId, [neighbour.verificationId]),
        'selfie-center',
      );
      const image = center === undefined ? null : await readStoredImage(deps, center);
      if (image === null) {
        skipped += 1;
        continue;
      }
      chosen.push({ embedding: neighbour.template.embedding, faceCosine, image });
    }
    if (chosen.length === 0) {
      return { kind: 'searched', candidates: [], skipped };
    }
    const compared = await attemptVision(
      () =>
        deps.vision.compareBackground({
          probe: probe.image,
          candidates: chosen.map((candidate) => candidate.image),
        }),
      {
        lastAttempt: job.lastAttempt,
        logger: deps.logger,
        log: { verificationId: job.verificationId, check: 'selfie_similar_background_detection' },
      },
    );
    if (!compared.ok) {
      return { kind: 'error' };
    }
    const groups = faceGroups(
      chosen.map((candidate) => candidate.embedding),
      probe.faceThreshold,
    );
    return {
      kind: 'searched',
      skipped,
      candidates: compared.value.results.flatMap((result) => {
        const candidate = chosen[result.index];
        return candidate === undefined
          ? []
          : [
              {
                faceCosine: candidate.faceCosine,
                faceGroup: groups[result.index] ?? result.index,
                goodMatches: result.good_matches,
                inliers: result.inliers,
                inlierRatio: result.inlier_ratio,
              },
            ];
      }),
    };
  } finally {
    for (const candidate of chosen) {
      candidate.image.bytes.fill(0);
    }
  }
}

/**
 * C43 `capture_replayed`: the prompted poses whose bytes equal a file outside this capture in the
 * environment (another capture of any inquiry, or any other verification's file), excluding files
 * whose object redaction deleted and files of redacted inquiries (`findReplayedDigests`).
 */
async function replayedPosesOf(
  deps: SelfieDeps,
  job: SelfieJob,
  capture: SelfieCapture,
  poses: Partial<Record<SelfiePose, StoredFile>>,
): Promise<SelfiePose[]> {
  // Never empty: the centre file exists by now.
  const digests = [...new Set(Object.values(poses).map((file) => file.sha256))];
  const rows = await findReplayedDigests(deps.db, job.environmentId, {
    sha256s: digests,
    excludeCaptureId: capture.id,
  });
  const replayed = new Set(rows);
  return capture.prompts.filter((pose) => {
    const file = poses[pose];
    return file !== undefined && replayed.has(file.sha256);
  });
}

/** C40.9: the evaluators' view of the capture. */
async function captureInputOf(
  deps: SelfieDeps,
  job: SelfieJob,
  submitted: { capture: SelfieCapture; device: unknown },
  poses: Partial<Record<SelfiePose, StoredFile>>,
): Promise<SelfieCaptureInput> {
  const { capture } = submitted;
  const snapshot = selfieDeviceSnapshotSchema.safeParse(submitted.device);
  return {
    method: capture.method,
    liveness: capture.liveness,
    prompts: capture.prompts,
    promptTimings: await selfieCapturePromptTimings(deps.db, job.environmentId, capture.id),
    createdAt: capture.createdAt,
    expiresAt: capture.expiresAt,
    submittedAt: capture.submittedAt,
    device: snapshot.success ? captureDeviceFlags(snapshot.data) : null,
    replayedPoses: await replayedPosesOf(deps, job, capture, poses),
  };
}

/** The background search, when the check is enabled and it can run (C42.8). */
async function backgroundOf(
  searchDeps: SelfieDeps,
  searchJob: SelfieJob,
  measured: SelfieAnalysis,
  probe: VisionImage,
  consent: boolean,
): Promise<BackgroundSearchInput | undefined> {
  const centre = measured.poses.center;
  const layout = centre.background;
  if (
    !consent ||
    !isEnabled(searchJob.config, 'selfie_similar_background_detection') ||
    centre.face === null ||
    layout === null
  ) {
    return undefined;
  }
  const config = selfieCheckConfig(searchJob.config, 'selfie_similar_background_detection');
  const minCoverage = config.values['min-coverage'];
  if (typeof minCoverage === 'number' && layout.coverage < minCoverage) {
    return undefined;
  }
  const oneToOne = oneToOneFaceThreshold(
    selfieContext(
      {
        analysis: measured,
        ...(searchDeps.faceMatchThreshold === undefined
          ? {}
          : { faceMatchThreshold: searchDeps.faceMatchThreshold }),
      },
      searchJob.config,
    ),
  );
  const threshold = oneToOne.values.threshold;
  const windowDays = config.values['window-days'];
  return searchBackgrounds(searchDeps, searchJob, {
    image: probe,
    embedding: centre.face.embedding,
    layout: layout.layout,
    faceThreshold: typeof threshold === 'number' ? threshold : FACE_MATCH_DEFAULTS.threshold,
    windowDays: typeof windowDays === 'number' ? windowDays : 30,
  });
}

/**
 * Evaluates one selfie verification (C43).
 * @throws {PermanentJobError} `missing_selfie_center` without a centre file, and when an upload
 * cannot be decrypted.
 * @throws a vision or provider failure that a retry may cure, before the last attempt.
 */
export async function evaluateSelfieVerification(
  deps: SelfieDeps,
  job: SelfieJob,
): Promise<SelfieEvaluation> {
  const submitted = await newestSubmittedSelfieCapture(
    deps.db,
    job.environmentId,
    job.verificationId,
  );
  const capture = submitted?.capture ?? null;
  const poses = poseFiles(job.files, capture);
  const center = poses.center;
  if (center === undefined) {
    throw new PermanentJobError('missing_selfie_center');
  }
  const matchingConsent = await matchingConsentHolds(
    deps.db,
    {
      environmentId: job.environmentId,
      inquiryId: job.inquiry.id,
      sessionId: capture?.createdBySessionId ?? null,
    },
    job.flow,
  );
  const reference = await referenceVerificationOf(deps, job);
  // The compared ID's birthdate is decrypted only for the age comparison (and its sandbox context).
  const birthdate = isEnabled(job.config, 'selfie_age_comparison')
    ? await birthdateOf(deps, job, reference)
    : null;
  const sides: SelfiePose[] = [];
  const sideFiles: StoredFile[] = [];
  for (const pose of POSES) {
    const file = poses[pose];
    if (pose !== 'center' && file !== undefined) {
      sides.push(pose);
      sideFiles.push(file);
    }
  }
  const ordered: readonly [StoredFile, ...StoredFile[]] = [center, ...sideFiles];

  const scanned = await withImages(deps, ordered, async ([centerImage, ...sideImages]) => {
    const images: Partial<Record<SelfiePose, VisionImage>> = { center: centerImage };
    sides.forEach((pose, index) => {
      const image = sideImages[index];
      if (image !== undefined) {
        images[pose] = image;
      }
    });
    const analysis = await attemptVision(
      () =>
        deps.vision.analyzeSelfie({
          center: centerImage,
          left: images.left,
          right: images.right,
          source: capture?.method,
        }),
      {
        lastAttempt: job.lastAttempt,
        logger: deps.logger,
        log: { verificationId: job.verificationId },
      },
    );
    if (!analysis.ok) {
      return { failure: analysis };
    }
    const providers = await askProviders(deps, job, centerImage, {
      referenceId: job.inquiry.referenceId,
      birthdate,
    });
    const background = await backgroundOf(deps, job, analysis.value, centerImage, matchingConsent);
    return { analysis: analysis.value, providers, background };
  });
  if ('failure' in scanned) {
    return {
      results: scanned.failure.unreadable
        ? unreadableImageChecks('selfie', job.config)
        : visionFailureChecks(job.config),
      unreadable: scanned.failure.unreadable,
      capture,
      faceData: null,
    };
  }

  const { analysis, providers, background } = scanned;
  const face = analysis.poses.center.face;
  const history: SelfieHistoryInput = {};
  if (matchingConsent && face !== null) {
    if (isEnabled(job.config, 'selfie_account_comparison')) {
      history.account = await accountComparison(deps, job, face.embedding);
    }
    if (isEnabled(job.config, 'selfie_repeat_detection')) {
      history.repeat = await repeatScan(deps, job, face.embedding);
    }
    if (background !== undefined) {
      history.background = background;
    }
  }
  const idReference = isEnabled(job.config, 'selfie_id_comparison')
    ? await idReferenceOf(deps, job, reference)
    : undefined;
  const captureInput =
    submitted === null ? null : await captureInputOf(deps, job, submitted, poses);

  const results = evaluateSelfieChecks(
    {
      analysis,
      ...(idReference === undefined ? {} : { idReference }),
      ...(deps.faceMatchThreshold === undefined
        ? {}
        : { faceMatchThreshold: deps.faceMatchThreshold }),
      capture: captureInput,
      environment: job.environmentKind,
      now: job.now,
      matchingConsent,
      idBirthdate: birthdate,
      history,
      providers,
      models: selfieModels(analysis.model_versions),
    },
    job.config,
  );
  const layout = analysis.poses.center.background;
  return {
    results,
    unreadable: false,
    capture,
    faceData:
      matchingConsent && face !== null
        ? {
            model: analysis.model_versions.recognizer,
            embedding: face.embedding,
            background:
              layout === null
                ? null
                : {
                    layout: layout.layout,
                    validCells: layout.valid_cells,
                    coverage: layout.coverage,
                  },
          }
        : null,
  };
}
