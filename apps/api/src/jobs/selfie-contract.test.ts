/**
 * The selfie contract (C39, C43): what every §4.2 evaluator may emit, what every result carries,
 * the thresholds they share, and the cascade end to end through the job.
 *
 * Workflow 4A Stage 1 set this file up; `api-worker` (Stage 3) extended it to every evaluator path
 * the worker can reach: captures in a sandbox and in production (a file-path label, `webdriver`, a
 * virtual camera, replays, no snapshot, an upload), consent given or not, every history and
 * provider outcome, mirrored images, degraded measurements, and the results the worker writes
 * itself (`unreadableImageChecks`, `visionFailureChecks`, `executionError`). Synthetic data only.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  SELFIE_EVALUATOR_REASONS,
  evaluateSelfieChecks,
  unreadableImageChecks,
  type SelfieCaptureInput,
  type SelfieCheckInput,
  type SelfieHistoryInput,
  type SelfieProviderOutcomes,
} from '@openverify/checks';
import {
  SELFIE_CHECK_IDS,
  SELFIE_CHECK_REASONS,
  defaultInquiryTemplateAttributes,
  newId,
} from '@openverify/contracts';
import {
  CHECK_REGISTRY,
  FACE_MATCH_DEFAULTS,
  checkResultSchema,
  defaultTemplateConfig,
  getCheckDefinition,
  type CheckResult,
  type VerificationTemplateConfig,
} from '@openverify/core';
import {
  createFile,
  createInquirySession,
  createVerification,
  encryptBytes,
  getVerification,
  recordInquirySessionConsent,
  setVerificationStatus,
  transitionInquiryStatus,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEventPublisher } from '../events/index.js';
import type { SelfieAnalysis } from '../ports.js';
import { createWebhookDeliveryScheduler } from '../webhooks/queue.js';
import { executionError, visionFailureChecks } from './execution-errors.js';
import { isRetryableFailure } from './inquiry-outcome.js';
import { CANONICAL_FACE_MESH, MODEL_DIGESTS, selfieModels } from './models.js';
import { processVerification } from './process-verification.js';
import {
  WEBCAM_DEVICE,
  seedSubmittedCapture,
  syntheticJpeg,
  threePoseAnalysis,
  unitVector,
} from './selfie-testing.js';
import {
  createCapturingLogger,
  createFakeVision,
  createMemoryStorage,
  createRecordingQueue,
  selfieFixture,
} from './testing.js';

const REPO = path.resolve(import.meta.dirname, '../../../..');

/**
 * Every place that used to hold its own copy of SFace's 0.363 (C39.3). Each must read
 * `FACE_MATCH_DEFAULTS` instead, so a calibrated threshold (C49) moves them all at once.
 */
const FACE_MATCH_READERS = [
  'packages/checks/src/face-match.ts',
  'packages/checks/src/phase1/selfie-checks.ts',
  'packages/checks/src/phase1/evaluate.ts',
  'packages/checks/src/government-id/id-selfie-comparison.ts',
  'packages/checks/src/government-id/id-inconsistent-repeat-detection.ts',
  'apps/api/src/worker.ts',
  'apps/api/src/jobs/process-verification.ts',
  'apps/api/src/jobs/selfie.ts',
] as const;

describe('the shared face-match threshold (C39.3)', () => {
  it('is 0.394 today (C49), in one place', () => {
    expect(FACE_MATCH_DEFAULTS.threshold).toBe(0.394);
    // C51.3 (V09): the check configs are split into per-area modules under check-config/; the
    // threshold lives in check-config/basis.ts, and no other module copies it.
    const dir = path.join(REPO, 'packages/core/src/check-config');
    const modules = [
      path.join(REPO, 'packages/core/src/check-config.ts'),
      ...readdirSync(dir)
        .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
        .map((name) => path.join(dir, name)),
    ];
    const copies = modules.flatMap((file) =>
      (readFileSync(file, 'utf8').match(/0\.394/g) ?? []).map(() => path.relative(REPO, file)),
    );
    expect(copies).toEqual(['packages/core/src/check-config/basis.ts']);
  });

  it.each(FACE_MATCH_READERS)('is read, never copied, by %s', (file) => {
    const source = readFileSync(path.join(REPO, file), 'utf8');
    expect(source).not.toMatch(/0\.363/);
  });

  it('is what the default evaluators of the 1:1 comparisons apply', async () => {
    const { DEFAULT_FACE_MATCH_THRESHOLD } = await import('@openverify/checks');
    expect(DEFAULT_FACE_MATCH_THRESHOLD).toBe(FACE_MATCH_DEFAULTS.threshold);
  });
});

// Every evaluator path ---------------------------------------------------------------------------

const NOW = new Date('2026-10-21T12:00:00.000Z');
const CREATED = new Date('2026-10-21T11:58:00.000Z');
const PROVIDER = { id: 'sandbox', sandbox: true } as const;

/** Every §4.2 check enabled and required, the age comparison with limits. */
const ALL: VerificationTemplateConfig = {
  checks: Object.fromEntries(
    SELFIE_CHECK_IDS.map((id) => [
      id,
      {
        enabled: true,
        required: true,
        ...(id === 'selfie_age_comparison' ? { config: { 'min-age': 18, 'max-age': 60 } } : {}),
      },
    ]),
  ),
};

function camera(change: Partial<SelfieCaptureInput> = {}): SelfieCaptureInput {
  return {
    method: 'camera',
    liveness: 'active',
    prompts: ['center', 'left', 'right'],
    promptTimings: [
      { pose: 'center', clientElapsedMs: 1500, receivedAt: new Date(CREATED.getTime() + 2000) },
      { pose: 'left', clientElapsedMs: 3000, receivedAt: new Date(CREATED.getTime() + 4000) },
      { pose: 'right', clientElapsedMs: 4500, receivedAt: new Date(CREATED.getTime() + 6000) },
    ],
    createdAt: CREATED,
    expiresAt: new Date(CREATED.getTime() + 180_000),
    submittedAt: new Date(CREATED.getTime() + 10_000),
    device: {
      labelIsFilePath: false,
      virtualCamera: false,
      webdriver: false,
      imageMirrored: false,
    },
    replayedPoses: [],
    ...change,
  };
}

const HISTORY: SelfieHistoryInput = {
  account: { kind: 'compared', templates: 2, bestCosine: 0.81 },
  repeat: {
    kind: 'searched',
    searched: 120,
    truncated: false,
    bestCosine: 0.92,
    matchCosines: [0.92],
  },
  background: {
    kind: 'searched',
    skipped: 1,
    candidates: [0, 1, 2].map((faceGroup) => ({
      faceCosine: 0.05,
      faceGroup,
      goodMatches: 320,
      inliers: 300,
      inlierRatio: 0.94,
    })),
  },
};

const PROVIDERS: SelfieProviderOutcomes = {
  selfieAgeEstimate: { kind: 'result', provider: PROVIDER, result: { age: 72 } },
  selfiePublicFigure: { kind: 'result', provider: PROVIDER, result: { match: true, score: 0.97 } },
  suspiciousEntity: {
    kind: 'result',
    provider: PROVIDER,
    result: { flagged: true, score: 0.97 },
  },
};

/** The golden three-pose analysis with `change` applied to a copy. */
function analysisWith(change: (analysis: SelfieAnalysis) => void): SelfieAnalysis {
  const analysis = threePoseAnalysis();
  change(analysis);
  return analysis;
}

/** The inputs that drive every evaluator down each of its paths. */
function inputs(): SelfieCheckInput[] {
  const golden = threePoseAnalysis();
  const models = selfieModels(golden.model_versions);
  const portrait = {
    kind: 'portrait' as const,
    verificationId: 'ver_01M5CJXHG07XPHF3HRM6NREDH7',
    embedding: golden.poses.center.face?.embedding ?? [],
  };
  const base: SelfieCheckInput = {
    analysis: golden,
    idReference: portrait,
    capture: camera(),
    environment: 'production',
    now: NOW,
    matchingConsent: true,
    idBirthdate: '1990-05-17',
    history: HISTORY,
    providers: PROVIDERS,
    models,
  };
  const noFace = analysisWith((analysis) => {
    analysis.poses.center = { ...analysis.poses.center, faces: [], face: null };
  });
  const dark = analysisWith((analysis) => {
    analysis.poses.center.quality = { ...analysis.poses.center.quality, is_too_dark: true };
  });
  const shallow = analysisWith((analysis) => {
    const left = analysis.poses.left;
    if (left?.head_pose != null) {
      left.head_pose = { ...left.head_pose, yaw_ratio: 0.02 };
    }
  });
  const unmeasured = analysisWith((analysis) => {
    for (const pose of [analysis.poses.center, analysis.poses.left, analysis.poses.right]) {
      if (pose !== null) {
        Object.assign(pose, {
          face_quality: null,
          head_pose: null,
          passive_liveness: null,
          occlusion: null,
          synthetic: null,
          background: null,
        });
      }
    }
    analysis.consistency = [];
  });
  const spoof = analysisWith((analysis) => {
    analysis.poses.center.passive_liveness = {
      v2: 0.1,
      v1se: 0.2,
      mean: 0.15,
      effective_scales: { v2: 2.7, v1se: 4 },
    };
    analysis.poses.center.faces = [
      ...analysis.poses.center.faces,
      { ...analysis.poses.center.faces[0], bbox: [420, 104, 140, 190], score: 0.9 } as never,
    ];
    if (analysis.poses.center.occlusion !== null) {
      analysis.poses.center.occlusion.covering.score = 0.9;
      analysis.poses.center.occlusion.glasses.score = 0.9;
    }
    analysis.poses.center.face_quality = analysis.poses.center.face_quality && {
      ...analysis.poses.center.face_quality,
      glare_ratio: 0.4,
    };
    analysis.consistency = analysis.consistency.map((entry) => ({
      ...entry,
      face_cosine_to_center: 0.995,
      duplicate_of_center: true,
      planarity:
        entry.planarity === null ? null : { ...entry.planarity, median_residual_ratio: 0.0001 },
    }));
  });
  const uploaded = analysisWith((analysis) => {
    if (analysis.poses.center.synthetic !== null) {
      analysis.poses.center.synthetic.digital_source_type = 'trainedAlgorithmicMedia';
    }
  });
  const errors: SelfieCheckInput = {
    ...base,
    idReference: { kind: 'error' },
    history: {
      account: { kind: 'error' },
      repeat: { kind: 'error' },
      background: { kind: 'error' },
    },
    providers: {
      selfieAgeEstimate: { kind: 'error' },
      selfiePublicFigure: { kind: 'error' },
      suspiciousEntity: { kind: 'error' },
    },
  };
  return [
    base,
    { ...base, environment: 'sandbox' },
    { ...base, analysis: spoof },
    { ...base, analysis: noFace },
    { ...base, analysis: dark },
    { ...base, analysis: shallow },
    { ...base, analysis: unmeasured },
    { ...base, analysis: uploaded, capture: camera({ method: 'upload' }) },
    {
      ...base,
      analysis: threePoseAnalysis({ mirrored: true }),
      capture: camera({
        device: {
          labelIsFilePath: false,
          virtualCamera: false,
          webdriver: false,
          imageMirrored: true,
        },
      }),
    },
    {
      ...base,
      capture: camera({
        device: {
          labelIsFilePath: true,
          virtualCamera: false,
          webdriver: true,
          imageMirrored: false,
        },
      }),
    },
    {
      ...base,
      environment: 'sandbox',
      capture: camera({
        device: {
          labelIsFilePath: true,
          virtualCamera: false,
          webdriver: true,
          imageMirrored: false,
        },
      }),
    },
    {
      ...base,
      capture: camera({
        device: {
          labelIsFilePath: false,
          virtualCamera: true,
          webdriver: false,
          imageMirrored: false,
        },
      }),
    },
    { ...base, capture: camera({ replayedPoses: ['left'] }) },
    { ...base, capture: camera({ device: null, replayedPoses: null }) },
    { ...base, capture: camera({ prompts: ['center'], liveness: 'passive', promptTimings: [] }) },
    { ...base, capture: null },
    { ...base, matchingConsent: false },
    { ...base, idReference: { kind: 'missing', missing: 'government_id' }, idBirthdate: null },
    { ...base, idReference: { kind: 'missing', missing: 'portrait' } },
    {
      ...base,
      idReference: { ...portrait, embedding: unitVector(3) },
      history: {
        account: { kind: 'compared', templates: 1, bestCosine: 0.05 },
        repeat: {
          kind: 'searched',
          searched: 0,
          truncated: false,
          bestCosine: null,
          matchCosines: [],
        },
        background: { kind: 'searched', skipped: 0, candidates: [] },
      },
      providers: {
        selfieAgeEstimate: { kind: 'result', provider: PROVIDER, result: { age: 36 } },
        selfiePublicFigure: {
          kind: 'result',
          provider: PROVIDER,
          result: { match: false, score: 0.03 },
        },
        suspiciousEntity: {
          kind: 'result',
          provider: PROVIDER,
          result: { flagged: false, score: 0.03 },
        },
      },
    },
    {
      ...base,
      history: { account: { kind: 'compared', templates: 0, bestCosine: null } },
      providers: {},
    },
    { ...base, providers: { selfieAgeEstimate: { kind: 'not_configured' } }, idBirthdate: null },
    errors,
  ];
}

/** Every result the selfie job can store: the evaluators' and the worker's own. */
function selfieResults(): CheckResult[] {
  const evaluated = inputs().flatMap((input) => evaluateSelfieChecks(input, ALL));
  const defaults = [
    ...evaluateSelfieChecks(
      { analysis: selfieFixture(), idPortrait: null },
      defaultTemplateConfig('selfie'),
    ),
  ];
  return [
    ...evaluated,
    ...defaults,
    ...unreadableImageChecks('selfie', ALL),
    ...visionFailureChecks(ALL),
    ...evaluated.map((result) => executionError(result)),
  ];
}

const REASONS: Readonly<Partial<Record<string, readonly string[]>>> = SELFIE_CHECK_REASONS;
const listedFor = (name: string): readonly string[] => REASONS[name] ?? [];

describe('every selfie result (C39.2, C39.4)', () => {
  const results = selfieResults();

  it('covers every §4.2 check and nothing else', () => {
    expect(new Set(results.map((result) => result.name))).toEqual(new Set(SELFIE_CHECK_IDS));
  });

  it('emits only reasons SELFIE_CHECK_REASONS lists for its check, never not_implemented', () => {
    for (const result of results) {
      expect(result.reasons, result.name).not.toContain('not_implemented');
      if (result.status === 'pending') {
        // Only the Phase 1 unreadable path: the quality check failed, the others could not run.
        expect(result.reasons, result.name).toEqual(['image_unreadable']);
      }
      for (const reason of result.reasons) {
        expect(listedFor(result.name), `${result.name}: ${reason}`).toContain(reason);
      }
    }
  });

  it('declares, per evaluator, only reasons the contract lists (SELFIE_EVALUATOR_REASONS)', () => {
    expect(Object.keys(SELFIE_EVALUATOR_REASONS).sort()).toEqual([...SELFIE_CHECK_IDS].sort());
    for (const [id, reasons] of Object.entries(SELFIE_EVALUATOR_REASONS)) {
      for (const reason of reasons) {
        expect(listedFor(id), `${id}: ${reason}`).toContain(reason);
      }
    }
  });

  it('gives a not_applicable result a reason', () => {
    for (const result of results.filter((entry) => entry.status === 'not_applicable')) {
      expect(result.reasons.length, result.name).toBeGreaterThan(0);
    }
  });

  it('satisfies the result contract (C29.2)', () => {
    for (const result of results) {
      expect(checkResultSchema.safeParse(result).success, result.name).toBe(true);
    }
  });

  it('carries its registry stage and implementation version', () => {
    for (const result of results) {
      const definition = getCheckDefinition(result.name);
      expect(result.stage, result.name).toBe(definition?.stage);
      expect(result.provenance['implementation-version'], result.name).toBe(definition?.version);
    }
  });

  it('names only pinned models: an id vision reports with its manifest digest, or the canonical mesh', () => {
    const pinned = new Map<string, string>([
      ...Object.entries(MODEL_DIGESTS).map(([id, digest]): [string, string] => [id, digest.sha256]),
      [CANONICAL_FACE_MESH.id, CANONICAL_FACE_MESH.sha256],
    ]);
    const evaluated = inputs().flatMap((input) => evaluateSelfieChecks(input, ALL));
    expect(evaluated.some((result) => (result.provenance.models ?? []).length > 0)).toBe(true);
    for (const result of evaluated) {
      for (const model of result.provenance.models ?? []) {
        expect(pinned.get(model.id), `${result.name}: ${model.id}`).toBe(model.sha256);
      }
    }
  });

  it('records the basis of every default threshold it was judged against (C39.3)', () => {
    for (const result of inputs().flatMap((input) => evaluateSelfieChecks(input, ALL))) {
      const { thresholds } = result.provenance;
      const basis = result.provenance['threshold-basis'] ?? {};
      for (const key of Object.keys(basis)) {
        expect(thresholds, `${result.name}: ${key}`).toHaveProperty(key);
      }
    }
    // With no template config, every threshold is a default and has its basis.
    const golden = threePoseAnalysis();
    const defaults: VerificationTemplateConfig = {
      checks: Object.fromEntries(
        SELFIE_CHECK_IDS.map((id) => [id, { enabled: true, required: true }]),
      ),
    };
    for (const result of evaluateSelfieChecks(
      {
        analysis: golden,
        capture: camera(),
        matchingConsent: true,
        history: HISTORY,
        providers: PROVIDERS,
        models: selfieModels(golden.model_versions),
      },
      defaults,
    )) {
      const basis = result.provenance['threshold-basis'] ?? {};
      for (const key of Object.keys(result.provenance.thresholds)) {
        expect(['calibrated', 'provisional'], `${result.name}: ${key}`).toContain(basis[key]);
      }
    }
  });

  it('gives every decided H-tier and liveness result a confidence in [0, 1] (ADR 0002 §3c)', () => {
    const needsConfidence = new Set<string>([
      ...CHECK_REGISTRY.filter(
        (definition) =>
          definition.verificationType === 'selfie' &&
          (definition.tier === 'H' || definition.alternateTier === 'H'),
      ).map((definition) => definition.id),
      'selfie_liveness_detection',
    ]);
    expect(needsConfidence).toEqual(
      new Set([
        'selfie_face_covering_detection',
        'selfie_glasses_detection',
        'selfie_age_comparison',
        'selfie_suspicious_entity_detection',
        'selfie_liveness_detection',
      ]),
    );
    const decided = inputs()
      .flatMap((input) => evaluateSelfieChecks(input, ALL))
      .filter(
        (result) =>
          needsConfidence.has(result.name) &&
          (result.status === 'passed' || result.status === 'failed') &&
          // An A/H check answered by its provider (no heuristic ran) carries the provider instead.
          !(result.name === 'selfie_age_comparison' && result.provenance.provider !== undefined),
      );
    expect(decided.length).toBeGreaterThan(0);
    for (const result of decided) {
      expect(result.confidence, result.name).toEqual(expect.any(Number));
      expect(result.confidence ?? -1, result.name).toBeGreaterThanOrEqual(0);
      expect(result.confidence ?? 2, result.name).toBeLessThanOrEqual(1);
    }
  });

  it('never copies an embedding, a landmark, a layout or a device label into a result', () => {
    const golden = threePoseAnalysis();
    const secrets = [
      ...(golden.poses.center.face?.embedding.slice(0, 3) ?? []),
      ...(golden.poses.center.faces[0]?.landmarks.flat() ?? []),
      ...(golden.poses.center.background?.layout.slice(0, 3) ?? []),
    ].map(String);
    const stored = JSON.stringify(selfieResults());
    for (const value of secrets) {
      expect(stored).not.toContain(value);
    }
    expect(stored).not.toContain(WEBCAM_DEVICE.label);
  });
});

// The cascade end to end (C43) -------------------------------------------------------------------

describe('the cascade through the job (C43)', () => {
  const defaults = defaultInquiryTemplateAttributes();
  const storage = createMemoryStorage();
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 60_000);

  afterAll(async () => {
    await database.close();
  });

  /** A pending inquiry of the C45.1 default with a passed ID and a submitted three-pose capture. */
  async function submittedSelfie() {
    const { db, keyring } = database;
    const environmentId = (await createTestTenant(db)).environment.id;
    const { inquiry } = await createTestInquiry(db, environmentId, {
      flow: defaults.flow,
      verificationConfig: defaults['verification-config'],
    });
    await transitionInquiryStatus(db, environmentId, inquiry.id, {
      from: 'created',
      to: 'pending',
    });
    const session = await createInquirySession(db, environmentId, {
      id: newId('iqse'),
      inquiryId: inquiry.id,
      tokenHash: createHash('sha256').update(inquiry.id).digest('hex'),
      expiresAt: new Date(NOW.getTime() + 86_400_000),
    });
    await recordInquirySessionConsent(db, environmentId, session.id, {
      acceptedAt: CREATED,
      textKeys: ['consent.biometric', 'consent.processing'],
      optionalTextKeys: [],
      locale: 'en',
      ip: null,
      userAgent: null,
    });
    const governmentId = newId('ver');
    await createVerification(db, environmentId, {
      id: governmentId,
      inquiryId: inquiry.id,
      type: 'government_id',
    });
    for (const kind of ['front', 'back'] as const) {
      const id = newId('file');
      const bytes = syntheticJpeg();
      const sealed = encryptBytes(bytes, keyring, { context: id });
      await storage.put(`${environmentId}/${id}`, sealed.ciphertext);
      await createFile(db, environmentId, {
        id,
        verificationId: governmentId,
        kind,
        storageKey: `${environmentId}/${id}`,
        mimeType: 'image/jpeg',
        byteSize: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        wrappedDek: sealed.wrappedDek,
      });
    }
    await setVerificationStatus(db, environmentId, governmentId, { to: 'submitted' });
    await setVerificationStatus(db, environmentId, governmentId, { to: 'passed' });
    const verificationId = newId('ver');
    await createVerification(db, environmentId, {
      id: verificationId,
      inquiryId: inquiry.id,
      type: 'selfie',
    });
    await seedSubmittedCapture({ db, keyring, storage }, environmentId, {
      inquiryId: inquiry.id,
      verificationId,
      createdAt: CREATED,
      device: WEBCAM_DEVICE,
    });
    return { environmentId, verificationId };
  }

  async function run(analysis: SelfieAnalysis) {
    const { environmentId, verificationId } = await submittedSelfie();
    const vision = createFakeVision();
    vision.answers.selfie = analysis;
    const logger = createCapturingLogger();
    const result = await processVerification(
      { environmentId, verificationId },
      {
        db: database.db,
        storage,
        keyring: database.keyring,
        vision: vision.client,
        events: createEventPublisher({
          db: database.db,
          deliveries: createWebhookDeliveryScheduler(createRecordingQueue()),
          logger,
        }),
        clock: { now: () => NOW },
        logger,
      },
    );
    const checks =
      (await getVerification(database.db, environmentId, verificationId))?.checks ?? [];
    return { result, checks, of: (name: string) => checks.find((check) => check.name === name) };
  }

  it('fails an insufficient turn alone on the pose check, retryable with its hint; liveness and pose repeat do not fail', async () => {
    const { result, checks, of } = await run(
      analysisWith((analysis) => {
        const left = analysis.poses.left;
        if (left?.head_pose != null) {
          left.head_pose = { ...left.head_pose, yaw_ratio: 0.02 };
        }
      }),
    );

    expect(result).toMatchObject({ verificationStatus: 'failed', inquiryStatus: 'pending' });
    expect(isRetryableFailure(checks)).toBe(true);
    expect(of('selfie_pose_detection')).toMatchObject({
      status: 'failed',
      type: 'user_behavior',
      reasons: ['pose_not_left'],
    });
    expect(of('selfie_liveness_detection')?.status).not.toBe('failed');
    expect(of('selfie_pose_repeat_detection')?.status).not.toBe('failed');
  });

  it('fails a too-dark centre alone on the quality check, retryable with its hint; liveness and pose repeat do not fail', async () => {
    const { result, checks, of } = await run(
      analysisWith((analysis) => {
        analysis.poses.center.quality = { ...analysis.poses.center.quality, is_too_dark: true };
      }),
    );

    expect(result).toMatchObject({ verificationStatus: 'failed', inquiryStatus: 'pending' });
    expect(isRetryableFailure(checks)).toBe(true);
    expect(of('selfie_image_quality_detection')).toMatchObject({
      status: 'failed',
      type: 'user_behavior',
      reasons: ['image_too_dark'],
    });
    expect(of('selfie_liveness_detection')).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
    expect(of('selfie_pose_repeat_detection')?.status).not.toBe('failed');
  });
});
