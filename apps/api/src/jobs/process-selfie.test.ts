/**
 * The selfie job v2 (Workflow 4A Stage 3, `api-worker`; C40.8-C40.10, C42, C43, C44) on PGlite:
 * every prompted pose of the newest submitted capture is analysed with its source, every enabled
 * §4.2 check is evaluated with the capture context, the history and the providers, the decision
 * moves the capture to `processed` (device cleared) with `selfie.processed` after the verification
 * event, and a passed selfie with matching consent leaves a sealed template and its background
 * row. Vision answers are built from the synthetic golden fixtures; embeddings and layouts are
 * synthetic.
 */
import { createHash } from 'node:crypto';
import { defaultInquiryTemplateAttributes, newId } from '@openverify/contracts';
import {
  createFile,
  createGovernmentIdExtraction,
  createInquirySession,
  createVerification,
  encryptBytes,
  faceTemplates,
  getSelfieCapture,
  getVerification,
  inquiries,
  openFaceTemplate,
  recordInquirySessionConsent,
  selfieBackgrounds,
  setVerificationStatus,
  transitionInquiryStatus,
  writeFaceData,
  type Db,
  type FileKind,
  type Keyring,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  type TestDatabase,
} from '@openverify/db/testing';
import { emptyExtractedFields } from '@openverify/core';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEventPublisher, type TransactionalEventPublisher } from '../events/index.js';
import type {
  ProviderBindings,
  SandboxSelfieContext,
  SelfieAnalysis,
  SelfieProviderRequest,
} from '../ports.js';
import { createProviderBindings, NO_PROVIDERS, ProviderError } from '../providers/index.js';
import { VisionServiceError, VisionUnavailableError } from '../vision/index.js';
import { createWebhookDeliveryScheduler } from '../webhooks/queue.js';
import {
  failVerificationAfterError,
  processVerification,
  type ProcessVerificationDeps,
} from './process-verification.js';
import {
  POSE_FILE_KINDS,
  WEBCAM_DEVICE,
  cosine,
  seedSubmittedCapture,
  syntheticJpeg,
  threePoseAnalysis,
  unitVector,
  vectorAtCosine,
  type Pose,
  type SeedCaptureInput,
} from './selfie-testing.js';
import {
  createCapturingLogger,
  createFakeVision,
  createMemoryStorage,
  createRecordingQueue,
  embedFaceAnswer,
} from './testing.js';

const NOW = new Date('2026-10-21T12:00:00.000Z');
/** The capture was created two minutes before the job runs. */
const CAPTURED = new Date('2026-10-21T11:58:00.000Z');
const defaults = defaultInquiryTemplateAttributes();
const MATCHING = 'consent.biometric-matching';

let database: TestDatabase;
let db: Db;
let keyring: Keyring;
const storage = createMemoryStorage();

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  keyring = database.keyring;
}, 60_000);

afterAll(async () => {
  await database.close();
});

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const tenant = async (kind: 'sandbox' | 'production' = 'sandbox') =>
  (await createTestTenant(db, { kind })).environment.id;

// Data -----------------------------------------------------------------------------------------

type SelfieConfig = NonNullable<(typeof defaults)['verification-config']['selfie']>;

interface InquiryOptions {
  /** The C45.1 default selfie config when omitted. */
  selfie?: SelfieConfig;
  referenceId?: string;
  /** Whether the recorded consent ticked the optional matching text (C42.3). */
  matching?: boolean;
  accountId?: string;
}

/** A pending inquiry of the C45.1 default template, its consent recorded. */
async function pendingInquiry(environmentId: string, options: InquiryOptions = {}) {
  const verificationConfig = structuredClone(defaults['verification-config']);
  if (options.selfie !== undefined) {
    verificationConfig.selfie = options.selfie;
  }
  const { inquiry } = await createTestInquiry(db, environmentId, {
    flow: defaults.flow,
    verificationConfig,
    ...(options.referenceId === undefined ? {} : { referenceId: options.referenceId }),
  });
  await transitionInquiryStatus(db, environmentId, inquiry.id, { from: 'created', to: 'pending' });
  if (options.accountId !== undefined) {
    await db
      .update(inquiries)
      .set({ accountId: options.accountId })
      .where(eq(inquiries.id, inquiry.id));
  }
  const session = await createInquirySession(db, environmentId, {
    id: newId('iqse'),
    inquiryId: inquiry.id,
    tokenHash: sha256(Buffer.from(`session-of-${inquiry.id}`)),
    expiresAt: new Date(NOW.getTime() + 86_400_000),
  });
  await recordInquirySessionConsent(db, environmentId, session.id, {
    acceptedAt: new Date(CAPTURED.getTime() - 60_000),
    textKeys: ['consent.biometric', 'consent.processing'],
    optionalTextKeys: options.matching === false ? [] : [MATCHING],
    locale: 'en',
    ip: null,
    userAgent: null,
  });
  return { inquiryId: inquiry.id, accountId: options.accountId ?? inquiry.accountId };
}

async function addFile(environmentId: string, verificationId: string, kind: FileKind) {
  const id = newId('file');
  const bytes = syntheticJpeg();
  const sealed = encryptBytes(bytes, keyring, { context: id });
  const storageKey = `${environmentId}/${id}`;
  await storage.put(storageKey, sealed.ciphertext);
  await createFile(db, environmentId, {
    id,
    verificationId,
    kind,
    storageKey,
    mimeType: 'image/jpeg',
    byteSize: bytes.length,
    sha256: sha256(bytes),
    wrappedDek: sealed.wrappedDek,
  });
  return { id, bytes, storageKey };
}

/** A government ID of the inquiry with a front and a back, in `status`. */
async function governmentId(
  environmentId: string,
  inquiryId: string,
  status: 'passed' | 'failed' | 'submitted' = 'passed',
) {
  const id = newId('ver');
  await createVerification(db, environmentId, { id, inquiryId, type: 'government_id' });
  const front = await addFile(environmentId, id, 'front');
  await addFile(environmentId, id, 'back');
  await setVerificationStatus(db, environmentId, id, { to: 'submitted' });
  if (status !== 'submitted') {
    await setVerificationStatus(db, environmentId, id, { to: status });
  }
  return { id, front };
}

/** A selfie verification with a submitted C40 capture. */
async function capturedSelfie(
  environmentId: string,
  inquiryId: string,
  capture: Omit<SeedCaptureInput, 'inquiryId' | 'verificationId' | 'createdAt'> = {},
) {
  const verificationId = newId('ver');
  await createVerification(db, environmentId, { id: verificationId, inquiryId, type: 'selfie' });
  const seeded = await seedSubmittedCapture({ db, keyring, storage }, environmentId, {
    inquiryId,
    verificationId,
    createdAt: CAPTURED,
    device: WEBCAM_DEVICE,
    ...capture,
  });
  return { verificationId, ...seeded };
}

/** A selfie submitted before Phase 4: a centre file and no capture (C40.7). */
async function legacySelfie(environmentId: string, inquiryId: string) {
  const verificationId = newId('ver');
  await createVerification(db, environmentId, { id: verificationId, inquiryId, type: 'selfie' });
  const center = await addFile(environmentId, verificationId, 'selfie-center');
  await setVerificationStatus(db, environmentId, verificationId, { to: 'submitted' });
  return { verificationId, center };
}

function setup(overrides: Partial<ProcessVerificationDeps> = {}) {
  const vision = createFakeVision();
  vision.answers.selfie = threePoseAnalysis();
  const logger = createCapturingLogger();
  const publisher = createEventPublisher({
    db,
    deliveries: createWebhookDeliveryScheduler(createRecordingQueue()),
    logger,
  });
  const staged: { name: string; id: string }[] = [];
  const events: TransactionalEventPublisher = {
    publish: (input) => publisher.publish(input),
    stage: (tx, input) => {
      staged.push({ name: input.name, id: input.payload.data.id });
      return publisher.stage(tx, input);
    },
    dispatch: (events) => publisher.dispatch(events),
  };
  const deps: ProcessVerificationDeps = {
    db,
    storage,
    keyring,
    vision: vision.client,
    events,
    clock: { now: () => NOW },
    logger,
    ...overrides,
  };
  return { deps, vision, logger, staged };
}

const job = (environmentId: string, verificationId: string) => ({ environmentId, verificationId });

async function checksOf(environmentId: string, verificationId: string) {
  const stored = await getVerification(db, environmentId, verificationId);
  return Object.fromEntries((stored?.checks ?? []).map((check) => [check.name, check]));
}

async function faceDataOf(verificationId: string) {
  const templates = await db
    .select()
    .from(faceTemplates)
    .where(eq(faceTemplates.verificationId, verificationId));
  const backgrounds = await db
    .select()
    .from(selfieBackgrounds)
    .where(eq(selfieBackgrounds.verificationId, verificationId));
  return { templates, backgrounds };
}

const bytesOf = (file: { bytes: Uint8Array } | undefined) => ({
  mimeType: 'image/jpeg',
  bytes: [...(file?.bytes ?? [])],
});

/** The C45.1 default selfie config with `change` applied to one check. */
function selfieConfig(
  check: string,
  change: { enabled?: boolean; required?: boolean; config?: Record<string, unknown> },
): SelfieConfig {
  const config = structuredClone(defaults['verification-config'].selfie);
  if (config === undefined) {
    throw new Error('the default template configures the selfie');
  }
  config.checks[check] = {
    enabled: change.enabled ?? true,
    required: change.required ?? false,
    ...(change.config === undefined ? {} : { config: change.config }),
  };
  return config;
}

// The job ------------------------------------------------------------------------------------------

describe('the selfie job v2 (C40.9, C43)', () => {
  it('analyses every prompted pose of the submitted capture with its source and evaluates every enabled check', async () => {
    const environmentId = await tenant();
    const { inquiryId } = await pendingInquiry(environmentId);
    await governmentId(environmentId, inquiryId);
    const selfie = await capturedSelfie(environmentId, inquiryId, {
      prompts: ['center', 'right', 'left'],
    });
    const { deps, vision } = setup();

    expect(await processVerification(job(environmentId, selfie.verificationId), deps)).toEqual({
      outcome: 'processed',
      verificationStatus: 'passed',
      inquiryStatus: 'completed',
    });

    expect(vision.calls[0]).toEqual({
      endpoint: 'selfie',
      images: {
        center: bytesOf(selfie.files.center),
        left: bytesOf(selfie.files.left),
        right: bytesOf(selfie.files.right),
      },
      source: 'camera',
    });
    const checks = await checksOf(environmentId, selfie.verificationId);
    const enabled = Object.entries(defaults['verification-config'].selfie?.checks ?? {})
      .filter(([, check]) => check.enabled)
      .map(([name]) => name);
    expect(Object.keys(checks).sort()).toEqual([...enabled].sort());
    for (const check of Object.values(checks)) {
      expect(check.status, check.name).not.toBe('pending');
      expect(check.reasons, check.name).not.toContain('not_implemented');
    }
    expect(checks.selfie_liveness_detection).toMatchObject({
      status: 'passed',
      metadata: {
        components: { passive: 'passed', active: 'passed', integrity: 'passed' },
        'order-followed': true,
      },
    });
    expect(checks.selfie_liveness_detection?.confidence).toBeLessThanOrEqual(0.6);
    expect(checks.selfie_pose_detection?.status).toBe('passed');
    expect(checks.selfie_pose_repeat_detection?.status).toBe('passed');
  });

  it('moves the capture to processed, clears its device, and announces it after the verification', async () => {
    const environmentId = await tenant();
    const { inquiryId } = await pendingInquiry(environmentId);
    await governmentId(environmentId, inquiryId);
    const selfie = await capturedSelfie(environmentId, inquiryId);
    const { deps, staged } = setup();

    await processVerification(job(environmentId, selfie.verificationId), deps);

    expect(await getSelfieCapture(db, environmentId, selfie.captureId)).toMatchObject({
      status: 'processed',
      processedAt: NOW,
      errorCode: null,
      hasDevice: false,
    });
    // Then the completed inquiry cancels its session (inquiry-session.canceled).
    expect(staged.map((event) => event.name).slice(0, 4)).toEqual([
      'verification.passed',
      'selfie.processed',
      'inquiry.completed',
      'inquiry.transitioned',
    ]);
    expect(staged[1]?.id).toBe(selfie.captureId);
  });

  it('stores the C40.10 metadata keys the verification attributes derive from', async () => {
    const environmentId = await tenant();
    const { inquiryId } = await pendingInquiry(environmentId);
    await governmentId(environmentId, inquiryId);
    const selfie = await capturedSelfie(environmentId, inquiryId);
    const { deps } = setup();

    await processVerification(job(environmentId, selfie.verificationId), deps);

    const checks = await checksOf(environmentId, selfie.verificationId);
    expect(checks.selfie_id_comparison?.metadata).toMatchObject({ similarity: 0.72 });
    expect(checks.selfie_liveness_detection?.metadata).toMatchObject({
      'liveness-score': 0.971,
      'face-cosines': { left: 0.8813, right: 0.8813 },
    });
    expect(checks.selfie_image_quality_detection?.metadata).toMatchObject({
      'face-box': [0.3822, 0.2172, 0.2372, 0.4248],
    });
  });

  it('gives every result its stage, provenance with the pinned models, and the threshold basis', async () => {
    const environmentId = await tenant();
    const { inquiryId } = await pendingInquiry(environmentId);
    await governmentId(environmentId, inquiryId);
    const selfie = await capturedSelfie(environmentId, inquiryId);
    const { deps } = setup();

    await processVerification(job(environmentId, selfie.verificationId), deps);

    const checks = await checksOf(environmentId, selfie.verificationId);
    expect(checks.selfie_pose_detection?.provenance).toMatchObject({
      models: expect.arrayContaining([
        expect.objectContaining({ id: 'mediapipe-canonical-face-model-a908d66' }),
      ]) as unknown,
      'threshold-basis': {
        'max-center-yaw-ratio': 'provisional',
        'min-side-yaw-ratio-change': 'provisional',
      },
    });
    expect(checks.selfie_liveness_detection?.provenance?.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'minifasnet-v2-2.7' }),
        expect.objectContaining({ id: 'minifasnet-v1se-4.0' }),
      ]),
    );
    for (const check of Object.values(checks)) {
      expect(check.stage, check.name).toBe('beta');
    }
  });

  it('evaluates a selfie submitted before Phase 4 without a capture (C40.7)', async () => {
    const environmentId = await tenant();
    const { inquiryId } = await pendingInquiry(environmentId);
    await governmentId(environmentId, inquiryId);
    const selfie = await legacySelfie(environmentId, inquiryId);
    const { deps, vision, staged } = setup();
    const golden = threePoseAnalysis();
    vision.answers.selfie = {
      ...golden,
      poses: { ...golden.poses, left: null, right: null },
      consistency: [],
    };

    await processVerification(job(environmentId, selfie.verificationId), deps);

    expect(vision.calls[0]).toEqual({
      endpoint: 'selfie',
      images: { center: bytesOf(selfie.center) },
    });
    expect(
      (await checksOf(environmentId, selfie.verificationId)).selfie_liveness_detection,
    ).toMatchObject({
      status: 'not_applicable',
      reasons: ['capture_not_live'],
    });
    expect(staged.map((event) => event.name)).not.toContain('selfie.processed');
  });

  it('sends an upload capture to vision as an upload, which liveness cannot judge', async () => {
    const environmentId = await tenant();
    const { inquiryId } = await pendingInquiry(environmentId);
    await governmentId(environmentId, inquiryId);
    const selfie = await capturedSelfie(environmentId, inquiryId, { method: 'upload' });
    const { deps, vision } = setup();

    expect(
      await processVerification(job(environmentId, selfie.verificationId), deps),
    ).toMatchObject({
      verificationStatus: 'needs_review',
    });

    expect(vision.calls[0]?.source).toBe('upload');
    expect(
      (await checksOf(environmentId, selfie.verificationId)).selfie_liveness_detection,
    ).toMatchObject({
      status: 'not_applicable',
      reasons: ['capture_not_live'],
    });
    expect(await getSelfieCapture(db, environmentId, selfie.captureId)).toMatchObject({
      status: 'processed',
    });
  });

  it('flips the yaw sign of a mirrored image before judging the turns (C41.1)', async () => {
    const environmentId = await tenant();
    const { inquiryId } = await pendingInquiry(environmentId);
    await governmentId(environmentId, inquiryId);
    const selfie = await capturedSelfie(environmentId, inquiryId, {
      device: { ...WEBCAM_DEVICE, 'image-mirrored': true },
    });
    const { deps, vision } = setup();
    vision.answers.selfie = threePoseAnalysis({ mirrored: true });

    expect(
      await processVerification(job(environmentId, selfie.verificationId), deps),
    ).toMatchObject({
      verificationStatus: 'passed',
    });
    expect(
      (await checksOf(environmentId, selfie.verificationId)).selfie_pose_detection,
    ).toMatchObject({
      status: 'passed',
      metadata: { 'image-mirrored': true },
    });
  });

  it('records a vision failure on the last attempt as execution_error and still processes the capture (C30.3)', async () => {
    const environmentId = await tenant();
    const { inquiryId } = await pendingInquiry(environmentId);
    await governmentId(environmentId, inquiryId);
    const selfie = await capturedSelfie(environmentId, inquiryId);
    const { deps, vision, staged } = setup();
    vision.answers.selfie = new VisionServiceError('/v1/analyze/selfie', 500);

    expect(
      await processVerification(job(environmentId, selfie.verificationId), deps, {
        lastAttempt: true,
      }),
    ).toMatchObject({ verificationStatus: 'needs_review' });

    const checks = await checksOf(environmentId, selfie.verificationId);
    expect(checks.selfie_liveness_detection).toMatchObject({
      status: 'not_applicable',
      reasons: ['execution_error'],
    });
    expect(await getSelfieCapture(db, environmentId, selfie.captureId)).toMatchObject({
      status: 'processed',
      hasDevice: false,
    });
    expect(staged.map((event) => event.name).slice(0, 1)).toEqual(['selfie.processed']);
  });

  it('rethrows a vision outage before the last attempt, leaving the capture submitted', async () => {
    const environmentId = await tenant();
    const { inquiryId } = await pendingInquiry(environmentId);
    const selfie = await capturedSelfie(environmentId, inquiryId);
    const { deps, vision } = setup();
    vision.answers.selfie = new VisionUnavailableError('/v1/analyze/selfie', 'network');

    await expect(
      processVerification(job(environmentId, selfie.verificationId), deps),
    ).rejects.toBeInstanceOf(VisionUnavailableError);
    expect(await getSelfieCapture(db, environmentId, selfie.captureId)).toMatchObject({
      status: 'submitted',
      hasDevice: true,
    });
  });

  it('fails the quality check of a pose vision cannot read, and processes the capture', async () => {
    const environmentId = await tenant();
    const { inquiryId } = await pendingInquiry(environmentId);
    const selfie = await capturedSelfie(environmentId, inquiryId);
    const { deps, vision } = setup();
    vision.answers.selfie = new VisionServiceError('/v1/analyze/selfie', 422);

    expect(
      await processVerification(job(environmentId, selfie.verificationId), deps),
    ).toMatchObject({
      verificationStatus: 'failed',
      inquiryStatus: 'pending',
    });
    expect(
      (await checksOf(environmentId, selfie.verificationId)).selfie_image_quality_detection,
    ).toMatchObject({
      status: 'failed',
      reasons: ['image_unreadable'],
    });
    expect(await getSelfieCapture(db, environmentId, selfie.captureId)).toMatchObject({
      status: 'processed',
    });
  });
});

describe('capture integrity (C43)', () => {
  it('fails liveness in production for a file-path camera label (automated_capture)', async () => {
    const environmentId = await tenant('production');
    const { inquiryId } = await pendingInquiry(environmentId);
    await governmentId(environmentId, inquiryId);
    const selfie = await capturedSelfie(environmentId, inquiryId, {
      device: { ...WEBCAM_DEVICE, label: '/tmp/fixtures/head-turn-a.mjpeg' },
    });
    const { deps } = setup();

    expect(
      await processVerification(job(environmentId, selfie.verificationId), deps),
    ).toMatchObject({
      verificationStatus: 'failed',
      inquiryStatus: 'failed',
    });
    expect(
      (await checksOf(environmentId, selfie.verificationId)).selfie_liveness_detection,
    ).toMatchObject({
      status: 'failed',
      reasons: ['automated_capture'],
    });
  });

  it('records the same label in a sandbox as a test capture device and passes (the sandbox test-capture rule)', async () => {
    const environmentId = await tenant('sandbox');
    const { inquiryId } = await pendingInquiry(environmentId);
    await governmentId(environmentId, inquiryId);
    const selfie = await capturedSelfie(environmentId, inquiryId, {
      device: { ...WEBCAM_DEVICE, label: '/tmp/fixtures/head-turn-a.mjpeg', webdriver: true },
    });
    const { deps } = setup();

    expect(
      await processVerification(job(environmentId, selfie.verificationId), deps),
    ).toMatchObject({
      verificationStatus: 'passed',
    });
    expect(
      (await checksOf(environmentId, selfie.verificationId)).selfie_liveness_detection,
    ).toMatchObject({
      status: 'passed',
      metadata: { 'test-capture-device': true },
    });
  });

  it("fails liveness in production when a pose replays another inquiry's file (capture_replayed)", async () => {
    const environmentId = await tenant('production');
    const earlier = await pendingInquiry(environmentId);
    const replayed = await capturedSelfie(environmentId, earlier.inquiryId);
    const { inquiryId } = await pendingInquiry(environmentId);
    await governmentId(environmentId, inquiryId);
    const selfie = await capturedSelfie(environmentId, inquiryId, {
      bytes: { left: replayed.files.left?.bytes ?? new Uint8Array() },
    });
    const { deps } = setup();

    await processVerification(job(environmentId, selfie.verificationId), deps);

    expect(
      (await checksOf(environmentId, selfie.verificationId)).selfie_liveness_detection,
    ).toMatchObject({
      status: 'failed',
      reasons: ['capture_replayed'],
      metadata: { 'replayed-poses': ['left'] },
    });
  });
});

// C42 face data -------------------------------------------------------------------------------

describe('face templates and background rows (C42.2)', () => {
  it('stores the sealed template and the background row of a passed selfie with matching consent', async () => {
    const environmentId = await tenant();
    const { inquiryId } = await pendingInquiry(environmentId);
    await governmentId(environmentId, inquiryId);
    const selfie = await capturedSelfie(environmentId, inquiryId);
    const { deps } = setup();

    await processVerification(job(environmentId, selfie.verificationId), deps);

    const { templates, backgrounds } = await faceDataOf(selfie.verificationId);
    expect(templates).toHaveLength(1);
    expect(templates[0]).toMatchObject({ inquiryId, model: 'sface-2021dec', source: 'selfie' });
    const embedding = threePoseAnalysis().poses.center.face?.embedding ?? [];
    const opened = templates[0] === undefined ? null : openFaceTemplate(templates[0]);
    expect(cosine(opened?.embedding ?? [], embedding)).toBeCloseTo(1, 5);
    expect(backgrounds).toEqual([
      expect.objectContaining({
        faceTemplateId: templates[0]?.id,
        validCells: threePoseAnalysis().poses.center.background?.valid_cells,
        coverage: 0.6667,
      }),
    ]);
  });

  it('stores nothing, and compares with nothing, without the matching consent (C42.3)', async () => {
    const environmentId = await tenant();
    const { inquiryId } = await pendingInquiry(environmentId, { matching: false });
    await governmentId(environmentId, inquiryId);
    const selfie = await capturedSelfie(environmentId, inquiryId);
    const { deps, vision } = setup();

    expect(
      await processVerification(job(environmentId, selfie.verificationId), deps),
    ).toMatchObject({
      verificationStatus: 'passed',
    });

    expect(await faceDataOf(selfie.verificationId)).toEqual({ templates: [], backgrounds: [] });
    const checks = await checksOf(environmentId, selfie.verificationId);
    for (const name of [
      'selfie_account_comparison',
      'selfie_repeat_detection',
      'selfie_similar_background_detection',
    ]) {
      expect(checks[name], name).toMatchObject({
        status: 'not_applicable',
        reasons: ['not_consented'],
      });
    }
    expect(vision.calls.map((call) => call.endpoint)).not.toContain('compare-background');
  });

  it('stores nothing for a spoof that passed only because liveness is advisory', async () => {
    const environmentId = await tenant();
    const { inquiryId } = await pendingInquiry(environmentId, {
      selfie: selfieConfig('selfie_liveness_detection', { required: false }),
    });
    await governmentId(environmentId, inquiryId);
    const selfie = await capturedSelfie(environmentId, inquiryId);
    const { deps, vision } = setup();
    const spoof = threePoseAnalysis();
    spoof.poses.center.passive_liveness = {
      v2: 0.12,
      v1se: 0.2,
      mean: 0.16,
      effective_scales: { v2: 2.7, v1se: 4 },
    };
    vision.answers.selfie = spoof;

    expect(
      await processVerification(job(environmentId, selfie.verificationId), deps),
    ).toMatchObject({
      verificationStatus: 'passed',
    });

    expect(
      (await checksOf(environmentId, selfie.verificationId)).selfie_liveness_detection,
    ).toMatchObject({
      status: 'failed',
      reasons: ['passive_liveness_low'],
    });
    expect(await faceDataOf(selfie.verificationId)).toEqual({ templates: [], backgrounds: [] });
  });

  it('stores nothing for a selfie that is not passed', async () => {
    const environmentId = await tenant();
    const { inquiryId } = await pendingInquiry(environmentId);
    const selfie = await capturedSelfie(environmentId, inquiryId);
    const { deps } = setup();

    // No government ID: the required comparison has no reference, so the selfie goes to review.
    expect(
      await processVerification(job(environmentId, selfie.verificationId), deps),
    ).toMatchObject({
      verificationStatus: 'needs_review',
    });
    expect(await faceDataOf(selfie.verificationId)).toEqual({ templates: [], backgrounds: [] });
  });

  it('stores nothing for an inquiry an operator declined while the job ran', async () => {
    const environmentId = await tenant();
    const { inquiryId } = await pendingInquiry(environmentId);
    await governmentId(environmentId, inquiryId);
    const selfie = await capturedSelfie(environmentId, inquiryId);
    await db.update(inquiries).set({ status: 'declined' }).where(eq(inquiries.id, inquiryId));
    const { deps } = setup();

    await processVerification(job(environmentId, selfie.verificationId), deps);

    expect(await faceDataOf(selfie.verificationId)).toEqual({ templates: [], backgrounds: [] });
  });

  it("deletes the inquiry's face data when the inquiry fails", async () => {
    const environmentId = await tenant();
    const { inquiryId } = await pendingInquiry(environmentId);
    await governmentId(environmentId, inquiryId);
    const earlier = newId('ver');
    await createVerification(db, environmentId, { id: earlier, inquiryId, type: 'selfie' });
    await writeFaceData(db, environmentId, {
      verificationId: earlier,
      inquiryId,
      model: 'sface-2021dec',
      embedding: unitVector(5),
      background: {
        layout: Array.from({ length: 144 }, () => 50),
        validCells: '1'.repeat(48),
        coverage: 1,
      },
    });
    const selfie = await capturedSelfie(environmentId, inquiryId);
    const { deps, vision } = setup();
    const mismatch = threePoseAnalysis();
    if (mismatch.poses.center.face !== null) {
      mismatch.poses.center.face = { ...mismatch.poses.center.face, embedding: unitVector(6) };
    }
    vision.answers.selfie = mismatch;

    expect(
      await processVerification(job(environmentId, selfie.verificationId), deps),
    ).toMatchObject({
      verificationStatus: 'failed',
      inquiryStatus: 'failed',
    });
    expect(await faceDataOf(earlier)).toEqual({ templates: [], backgrounds: [] });
  });
});

describe('the account comparison and the 1:N scan (C42.4, C42.8)', () => {
  /** A template of a passed selfie of another inquiry with `embedding`. */
  async function storedTemplate(
    environmentId: string,
    embedding: readonly number[],
    accountId?: string,
  ) {
    const { inquiryId } = await pendingInquiry(
      environmentId,
      accountId === undefined ? {} : { accountId },
    );
    const verificationId = newId('ver');
    await createVerification(db, environmentId, { id: verificationId, inquiryId, type: 'selfie' });
    await writeFaceData(db, environmentId, {
      verificationId,
      inquiryId,
      model: 'sface-2021dec',
      embedding,
      background: null,
    });
    return { inquiryId, verificationId };
  }

  const centre = () => threePoseAnalysis().poses.center.face?.embedding ?? [];

  async function accountOf(inquiryId: string): Promise<string> {
    const [row] = await db
      .select({ accountId: inquiries.accountId })
      .from(inquiries)
      .where(eq(inquiries.id, inquiryId));
    return row?.accountId ?? '';
  }

  it("compares the face with the account's earlier templates", async () => {
    const environmentId = await tenant();
    const first = await storedTemplate(environmentId, vectorAtCosine(centre(), 7, 0.8));
    const account = await accountOf(first.inquiryId);
    const { inquiryId } = await pendingInquiry(environmentId, { accountId: account });
    await governmentId(environmentId, inquiryId);
    const selfie = await capturedSelfie(environmentId, inquiryId);
    const { deps } = setup();

    await processVerification(job(environmentId, selfie.verificationId), deps);

    expect(
      (await checksOf(environmentId, selfie.verificationId)).selfie_account_comparison,
    ).toMatchObject({
      status: 'passed',
      metadata: { 'templates-compared': 1, 'best-cosine': 0.8 },
    });
  });

  it('finds the same face on another account, recording what the scan searched', async () => {
    const environmentId = await tenant();
    await storedTemplate(environmentId, vectorAtCosine(centre(), 8, 0.9));
    await storedTemplate(environmentId, vectorAtCosine(centre(), 9, 0.1));
    const { inquiryId } = await pendingInquiry(environmentId);
    await governmentId(environmentId, inquiryId);
    const selfie = await capturedSelfie(environmentId, inquiryId);
    const { deps } = setup();

    // Advisory: the verification still passes.
    expect(
      await processVerification(job(environmentId, selfie.verificationId), deps),
    ).toMatchObject({
      verificationStatus: 'passed',
    });
    expect(
      (await checksOf(environmentId, selfie.verificationId)).selfie_repeat_detection,
    ).toMatchObject({
      status: 'failed',
      reasons: ['face_seen_on_other_account'],
      metadata: { searched: 2, truncated: false, 'match-count': 1, 'best-cosine': 0.9 },
    });
  });

  it("leaves the account's own templates out of the 1:N scan", async () => {
    const environmentId = await tenant();
    const own = await storedTemplate(environmentId, vectorAtCosine(centre(), 10, 0.95));
    const account = await accountOf(own.inquiryId);
    const { inquiryId } = await pendingInquiry(environmentId, { accountId: account });
    await governmentId(environmentId, inquiryId);
    const selfie = await capturedSelfie(environmentId, inquiryId);
    const { deps } = setup();

    await processVerification(job(environmentId, selfie.verificationId), deps);

    expect(
      (await checksOf(environmentId, selfie.verificationId)).selfie_repeat_detection,
    ).toMatchObject({
      status: 'passed',
      metadata: { searched: 0, truncated: false, 'match-count': 0 },
    });
  });
});

describe('the background search (C42.8)', () => {
  const golden = () => threePoseAnalysis().poses.center;

  /**
   * A passed selfie of another account with a template (`embedding`) and a background row with
   * the golden centre's layout, created `daysAgo` days ago, and its centre file unless `noFile`.
   */
  async function candidate(
    environmentId: string,
    embedding: readonly number[],
    options: { daysAgo?: number; noFile?: boolean } = {},
  ) {
    const { inquiryId } = await pendingInquiry(environmentId);
    const verificationId = newId('ver');
    await createVerification(db, environmentId, { id: verificationId, inquiryId, type: 'selfie' });
    const center = await addFile(environmentId, verificationId, 'selfie-center');
    if (options.noFile === true) {
      await storage.delete(center.storageKey);
    }
    const background = golden().background;
    const { templateId } = await writeFaceData(db, environmentId, {
      verificationId,
      inquiryId,
      model: 'sface-2021dec',
      embedding,
      background:
        background === null
          ? null
          : {
              layout: background.layout,
              validCells: background.valid_cells,
              coverage: background.coverage,
            },
    });
    if (options.daysAgo !== undefined) {
      const at = new Date(NOW.getTime() - options.daysAgo * 86_400_000);
      await db.update(faceTemplates).set({ createdAt: at }).where(eq(faceTemplates.id, templateId));
      await db
        .update(selfieBackgrounds)
        .set({ createdAt: at })
        .where(eq(selfieBackgrounds.faceTemplateId, templateId));
    }
    return center;
  }

  const verifiedRoom = (candidates: number) => ({
    results: Array.from({ length: candidates }, (_, index) => ({
      index,
      good_matches: 320,
      inliers: 300,
      inlier_ratio: 0.94,
    })),
  });

  it('compares the room with the centre files of other faces in the window and fails on three distinct faces', async () => {
    const environmentId = await tenant();
    const a = await candidate(environmentId, unitVector(21));
    const b = await candidate(environmentId, unitVector(22));
    const c = await candidate(environmentId, unitVector(23));
    await candidate(environmentId, unitVector(24), { daysAgo: 31 });
    await candidate(environmentId, vectorAtCosine(golden().face?.embedding ?? [], 25, 0.9));
    const { inquiryId } = await pendingInquiry(environmentId);
    await governmentId(environmentId, inquiryId);
    const selfie = await capturedSelfie(environmentId, inquiryId);
    const { deps, vision } = setup();
    vision.answers.compareBackground = verifiedRoom;

    expect(
      await processVerification(job(environmentId, selfie.verificationId), deps),
    ).toMatchObject({
      verificationStatus: 'passed',
    });

    const compare = vision.calls.find((call) => call.endpoint === 'compare-background');
    expect(compare?.images.probe).toEqual(bytesOf(selfie.files.center));
    expect(
      Object.entries(compare?.images ?? {})
        .filter(([field]) => field.startsWith('candidate_'))
        .map(([, image]) => image.bytes)
        .sort(),
    ).toEqual([a, b, c].map((file) => [...file.bytes]).sort());
    expect(
      (await checksOf(environmentId, selfie.verificationId)).selfie_similar_background_detection,
    ).toMatchObject({
      status: 'failed',
      reasons: ['background_seen_with_other_faces'],
      metadata: { compared: 3, skipped: 0, verified: 3, 'distinct-faces': 3 },
    });
  });

  it('skips and counts a candidate whose centre file is gone, and compares at most five', async () => {
    const environmentId = await tenant();
    await candidate(environmentId, unitVector(31), { noFile: true });
    for (const seed of [32, 33, 34, 35, 36, 37]) {
      await candidate(environmentId, unitVector(seed));
    }
    const { inquiryId } = await pendingInquiry(environmentId);
    await governmentId(environmentId, inquiryId);
    const selfie = await capturedSelfie(environmentId, inquiryId);
    const { deps, vision } = setup();

    await processVerification(job(environmentId, selfie.verificationId), deps);

    const compare = vision.calls.find((call) => call.endpoint === 'compare-background');
    expect(
      Object.keys(compare?.images ?? {}).filter((field) => field.startsWith('candidate_')),
    ).toHaveLength(5);
    expect(
      (await checksOf(environmentId, selfie.verificationId)).selfie_similar_background_detection,
    ).toMatchObject({
      status: 'passed',
      metadata: { compared: 5, skipped: 1, verified: 0 },
    });
  });

  it('records a failed comparison on the last attempt as execution_error', async () => {
    const environmentId = await tenant();
    await candidate(environmentId, unitVector(41));
    const { inquiryId } = await pendingInquiry(environmentId);
    await governmentId(environmentId, inquiryId);
    const selfie = await capturedSelfie(environmentId, inquiryId);
    const { deps, vision } = setup();
    vision.answers.compareBackground = new VisionServiceError('/v1/compare/background', 503);

    expect(
      await processVerification(job(environmentId, selfie.verificationId), deps, {
        lastAttempt: true,
      }),
    ).toMatchObject({ verificationStatus: 'passed' });
    expect(
      (await checksOf(environmentId, selfie.verificationId)).selfie_similar_background_detection,
    ).toMatchObject({
      status: 'not_applicable',
      reasons: ['execution_error'],
    });
  });
});

// C44 providers --------------------------------------------------------------------------------

describe('the A-tier selfie providers (C44)', () => {
  const aTier = () => {
    let config = selfieConfig('selfie_age_comparison', { config: { 'min-age': 18 } });
    config = {
      checks: {
        ...config.checks,
        selfie_public_figure_detection: { enabled: true, required: false },
      },
    };
    return config;
  };

  /** A sandbox provider set whose calls are recorded. */
  function recordingSandbox() {
    const bound = createProviderBindings({
      sandbox: {
        ...NO_PROVIDERS.sandbox,
        selfieAgeEstimate: 'sandbox',
        selfiePublicFigure: 'sandbox',
        suspiciousEntity: 'sandbox',
      },
      production: NO_PROVIDERS.production,
    });
    const calls: {
      kind: string;
      request: SelfieProviderRequest;
      context: SandboxSelfieContext | undefined;
      count: number;
    }[] = [];
    const wrap =
      <R>(
        kind: string,
        call: (request: SelfieProviderRequest, context: SandboxSelfieContext) => Promise<R>,
      ) =>
      (...args: [SelfieProviderRequest, SandboxSelfieContext]) => {
        // The job wipes the image after use, so the spy keeps a copy of what it was given.
        const [request, context] = args;
        calls.push({
          kind,
          request: {
            ...request,
            image: { ...request.image, bytes: Uint8Array.from(request.image.bytes) },
          },
          context,
          count: args.length,
        });
        return call(...args);
      };
    const age = bound.sandbox.selfieAgeEstimate;
    const figure = bound.sandbox.selfiePublicFigure;
    const entity = bound.sandbox.suspiciousEntity;
    const providers: ProviderBindings = {
      sandbox: {
        selfieAgeEstimate:
          age?.sandbox === true
            ? {
                ...age,
                estimateAge: wrap('age', (request, context) => age.estimateAge(request, context)),
              }
            : undefined,
        selfiePublicFigure:
          figure?.sandbox === true
            ? {
                ...figure,
                matchPublicFigure: wrap('public-figure', (request, context) =>
                  figure.matchPublicFigure(request, context),
                ),
              }
            : undefined,
        suspiciousEntity:
          entity?.sandbox === true
            ? {
                ...entity,
                assess: wrap('suspicious-entity', (request, context) =>
                  entity.assess(request, context),
                ),
              }
            : undefined,
      },
      production: {},
    };
    return { providers, calls };
  }

  it('asks the bound sandbox providers with the centre image only, plus the reference id and birthdate', async () => {
    const environmentId = await tenant();
    const { inquiryId } = await pendingInquiry(environmentId, {
      selfie: aTier(),
      referenceId: 'customer-7 sandbox-public-figure',
    });
    const gov = await governmentId(environmentId, inquiryId);
    await createGovernmentIdExtraction(db, environmentId, {
      verificationId: gov.id,
      fields: { ...emptyExtractedFields(), birthdate: '1990-05-17' },
      fieldSources: {},
      identificationNumberIndex: null,
      frontPhash: null,
    });
    const selfie = await capturedSelfie(environmentId, inquiryId);
    const { providers, calls } = recordingSandbox();
    const { deps } = setup({ providers });

    await processVerification(job(environmentId, selfie.verificationId), deps);

    expect(calls.map((call) => call.kind).sort()).toEqual([
      'age',
      'public-figure',
      'suspicious-entity',
    ]);
    for (const call of calls) {
      expect(Object.keys(call.request)).toEqual(['image']);
      expect(call.request.image.bytes).toEqual(selfie.files.center?.bytes);
      expect(call.count).toBe(2);
      expect(call.context).toEqual({
        referenceId: 'customer-7 sandbox-public-figure',
        birthdate: '1990-05-17',
      });
    }
    const checks = await checksOf(environmentId, selfie.verificationId);
    expect(checks.selfie_public_figure_detection).toMatchObject({
      status: 'failed',
      reasons: ['public_figure_match'],
      provenance: { provider: { id: 'sandbox', sandbox: true } },
    });
    expect(checks.selfie_age_comparison).toMatchObject({
      status: 'passed',
      provenance: { provider: { id: 'sandbox', sandbox: true } },
    });
    expect(checks.selfie_suspicious_entity_detection).toMatchObject({
      status: 'passed',
      provenance: { provider: { id: 'sandbox', sandbox: true } },
    });
  });

  it('gives a provider that is not a sandbox one argument: the centre image', async () => {
    const environmentId = await tenant('production');
    const { inquiryId } = await pendingInquiry(environmentId, {
      selfie: aTier(),
      referenceId: 'customer-8',
    });
    await governmentId(environmentId, inquiryId);
    const selfie = await capturedSelfie(environmentId, inquiryId);
    const received: unknown[][] = [];
    const providers: ProviderBindings = {
      sandbox: {},
      production: {
        selfieAgeEstimate: {
          id: 'estimator',
          sandbox: false,
          estimateAge: (...args) => {
            received.push(args);
            return Promise.resolve({ age: 31 });
          },
        },
      },
    };
    const { deps } = setup({ providers });

    await processVerification(job(environmentId, selfie.verificationId), deps);

    expect(received).toHaveLength(1);
    expect(received[0]).toHaveLength(1);
    expect(Object.keys(received[0]?.[0] as object)).toEqual(['image']);
    expect(
      (await checksOf(environmentId, selfie.verificationId)).selfie_age_comparison,
    ).toMatchObject({
      status: 'passed',
      provenance: { provider: { id: 'estimator', sandbox: false } },
    });
  });

  it('answers provider_not_configured for an unbound provider', async () => {
    const environmentId = await tenant();
    const { inquiryId } = await pendingInquiry(environmentId, { selfie: aTier() });
    await governmentId(environmentId, inquiryId);
    const selfie = await capturedSelfie(environmentId, inquiryId);
    const { deps } = setup();

    await processVerification(job(environmentId, selfie.verificationId), deps);

    const checks = await checksOf(environmentId, selfie.verificationId);
    for (const name of ['selfie_age_comparison', 'selfie_public_figure_detection']) {
      expect(checks[name], name).toMatchObject({
        status: 'not_applicable',
        reasons: ['provider_not_configured'],
      });
    }
  });

  it('retries a provider failure, then records execution_error on the last attempt (C30.3)', async () => {
    const environmentId = await tenant();
    const { inquiryId } = await pendingInquiry(environmentId, { selfie: aTier() });
    await governmentId(environmentId, inquiryId);
    const selfie = await capturedSelfie(environmentId, inquiryId);
    const providers: ProviderBindings = {
      sandbox: {
        selfiePublicFigure: {
          id: 'gallery',
          sandbox: false,
          matchPublicFigure: () =>
            Promise.reject(new ProviderError('gallery unavailable', { retryable: true })),
        },
      },
      production: {},
    };
    const { deps } = setup({ providers });

    await expect(
      processVerification(job(environmentId, selfie.verificationId), deps),
    ).rejects.toBeInstanceOf(ProviderError);
    await processVerification(job(environmentId, selfie.verificationId), deps, {
      lastAttempt: true,
    });

    expect(
      (await checksOf(environmentId, selfie.verificationId)).selfie_public_figure_detection,
    ).toMatchObject({
      status: 'not_applicable',
      reasons: ['execution_error'],
    });
  });
});

describe('failVerificationAfterError (C40.8)', () => {
  it('errors the capture with processing_failed, clears its device, and announces it after the verification', async () => {
    const environmentId = await tenant();
    const { inquiryId } = await pendingInquiry(environmentId);
    const selfie = await capturedSelfie(environmentId, inquiryId);
    const { deps, staged } = setup();

    expect(
      await failVerificationAfterError(
        job(environmentId, selfie.verificationId),
        deps,
        'PermanentJobError',
      ),
    ).toMatchObject({ outcome: 'failed' });

    expect(await getSelfieCapture(db, environmentId, selfie.captureId)).toMatchObject({
      status: 'errored',
      errorCode: 'processing_failed',
      hasDevice: false,
    });
    expect(staged.slice(0, 2)).toEqual([
      { name: 'verification.failed', id: selfie.verificationId },
      { name: 'selfie.errored', id: selfie.captureId },
    ]);
  });
});

// Poses ----------------------------------------------------------------------------------------

describe('prompted poses without a file (C40.4)', () => {
  it('analyses the poses that have one; the pose check has no input for the missing one', async () => {
    const environmentId = await tenant();
    const { inquiryId } = await pendingInquiry(environmentId);
    await governmentId(environmentId, inquiryId);
    const selfie = await capturedSelfie(environmentId, inquiryId, {
      omit: ['right'] satisfies Pose[],
    });
    const { deps, vision } = setup();
    const analysis: SelfieAnalysis = threePoseAnalysis();
    vision.answers.selfie = {
      ...analysis,
      poses: { ...analysis.poses, right: null },
      consistency: analysis.consistency.filter((entry) => entry.pose === 'left'),
    };

    await processVerification(job(environmentId, selfie.verificationId), deps);

    expect(Object.keys(vision.calls[0]?.images ?? {}).sort()).toEqual(['center', 'left']);
    expect(
      (await checksOf(environmentId, selfie.verificationId)).selfie_pose_detection,
    ).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
  });

  it('only counts files uploaded under the capture', async () => {
    const environmentId = await tenant();
    const { inquiryId } = await pendingInquiry(environmentId);
    const selfie = await capturedSelfie(environmentId, inquiryId, {
      omit: ['left'] satisfies Pose[],
    });
    // A stray file of the kind without the capture (as a pre-Phase 4 client would upload).
    await addFile(environmentId, selfie.verificationId, POSE_FILE_KINDS.left);
    const { deps, vision } = setup();

    await processVerification(job(environmentId, selfie.verificationId), deps);

    expect(Object.keys(vision.calls[0]?.images ?? {}).sort()).toEqual(['center', 'right']);
  });
});

// Embedding of the ID front ---------------------------------------------------------------------

describe('the reference portrait (C43 selfie_id_comparison)', () => {
  it('says the government ID is missing, or only its portrait', async () => {
    const environmentId = await tenant();
    const noId = await pendingInquiry(environmentId);
    const first = await capturedSelfie(environmentId, noId.inquiryId);
    const withId = await pendingInquiry(environmentId);
    await governmentId(environmentId, withId.inquiryId);
    const second = await capturedSelfie(environmentId, withId.inquiryId);
    const { deps, vision } = setup();

    await processVerification(job(environmentId, first.verificationId), deps);
    vision.answers.embedFace = embedFaceAnswer(null);
    await processVerification(job(environmentId, second.verificationId), deps);

    expect(
      (await checksOf(environmentId, first.verificationId)).selfie_id_comparison,
    ).toMatchObject({
      status: 'not_applicable',
      reasons: ['no_reference_data'],
      metadata: { reference: 'government_id' },
    });
    expect(
      (await checksOf(environmentId, second.verificationId)).selfie_id_comparison,
    ).toMatchObject({
      status: 'not_applicable',
      reasons: ['no_reference_data'],
      metadata: { reference: 'portrait' },
    });
  });
});

// Edges ------------------------------------------------------------------------------------------

describe('edges of the selfie job (guards)', () => {
  /** Gives template `id` another row's sealed value, so its row AAD no longer opens it. */
  async function corrupt(id: string, donor: string) {
    await db.execute(
      sql`update face_templates set template = (select template from face_templates where id = ${donor}) where id = ${id}`,
    );
  }

  async function templateOf(inquiryId: string, embedding: readonly number[], withLayout = false) {
    const verificationId = newId('ver');
    await createVerification(db, environmentIdOf.get(inquiryId) ?? '', {
      id: verificationId,
      inquiryId,
      type: 'selfie',
    });
    const layout = threePoseAnalysis().poses.center.background;
    const { templateId } = await writeFaceData(db, environmentIdOf.get(inquiryId) ?? '', {
      verificationId,
      inquiryId,
      model: 'sface-2021dec',
      embedding,
      background:
        withLayout && layout !== null
          ? { layout: layout.layout, validCells: layout.valid_cells, coverage: layout.coverage }
          : null,
    });
    return { verificationId, templateId };
  }

  const environmentIdOf = new Map<string, string>();

  async function inquiryIn(environmentId: string, options: InquiryOptions = {}) {
    const created = await pendingInquiry(environmentId, options);
    environmentIdOf.set(created.inquiryId, environmentId);
    return created;
  }

  it('has no matching consent when the consent step does not list the key', async () => {
    const environmentId = await tenant();
    const { inquiryId } = await inquiryIn(environmentId);
    await db.execute(
      sql`update inquiry_template_versions set flow = flow #- '{steps,0,optionalTextKeys}'
          where id = (select inquiry_template_version_id from inquiries where id = ${inquiryId})`,
    );
    await governmentId(environmentId, inquiryId);
    const selfie = await capturedSelfie(environmentId, inquiryId);
    const { deps } = setup();

    await processVerification(job(environmentId, selfie.verificationId), deps);

    expect(
      (await checksOf(environmentId, selfie.verificationId)).selfie_repeat_detection,
    ).toMatchObject({
      status: 'not_applicable',
      reasons: ['not_consented'],
    });
    expect(await faceDataOf(selfie.verificationId)).toEqual({ templates: [], backgrounds: [] });
  });

  it('has no portrait when the stored ID front is gone or vision cannot read it, and an error when vision fails for good', async () => {
    const environmentId = await tenant();
    const gone = await inquiryIn(environmentId);
    const goneId = await governmentId(environmentId, gone.inquiryId);
    await storage.delete(goneId.front.storageKey);
    const goneSelfie = await capturedSelfie(environmentId, gone.inquiryId);
    const unreadable = await inquiryIn(environmentId);
    await governmentId(environmentId, unreadable.inquiryId);
    const unreadableSelfie = await capturedSelfie(environmentId, unreadable.inquiryId);
    const failing = await inquiryIn(environmentId);
    await governmentId(environmentId, failing.inquiryId);
    const failingSelfie = await capturedSelfie(environmentId, failing.inquiryId);
    const { deps, vision } = setup();

    await processVerification(job(environmentId, goneSelfie.verificationId), deps);
    vision.answers.embedFace = new VisionServiceError('/v1/embed/face', 422);
    await processVerification(job(environmentId, unreadableSelfie.verificationId), deps);
    vision.answers.embedFace = new VisionServiceError('/v1/embed/face', 503);
    await processVerification(job(environmentId, failingSelfie.verificationId), deps, {
      lastAttempt: true,
    });

    for (const selfie of [goneSelfie, unreadableSelfie]) {
      expect(
        (await checksOf(environmentId, selfie.verificationId)).selfie_id_comparison,
      ).toMatchObject({
        status: 'not_applicable',
        reasons: ['no_reference_data'],
        metadata: { reference: 'portrait' },
      });
    }
    expect(
      (await checksOf(environmentId, failingSelfie.verificationId)).selfie_id_comparison,
    ).toMatchObject({
      status: 'not_applicable',
      reasons: ['execution_error'],
    });
  });

  it('records stored templates that cannot be opened as execution_error, and skips such a background candidate', async () => {
    const environmentId = await tenant();
    const donor = await inquiryIn(environmentId);
    const donorTemplate = await templateOf(donor.inquiryId, unitVector(90));
    // The account's earlier inquiry, and another account's room, each with a broken template.
    const earlier = await inquiryIn(environmentId);
    const earlierTemplate = await templateOf(earlier.inquiryId, unitVector(91));
    await corrupt(earlierTemplate.templateId, donorTemplate.templateId);
    const room = await inquiryIn(environmentId);
    const roomTemplate = await templateOf(room.inquiryId, unitVector(92), true);
    await corrupt(roomTemplate.templateId, donorTemplate.templateId);
    const [account] = await db
      .select({ accountId: inquiries.accountId })
      .from(inquiries)
      .where(eq(inquiries.id, earlier.inquiryId));
    const { inquiryId } = await inquiryIn(environmentId, { accountId: account?.accountId ?? '' });
    await governmentId(environmentId, inquiryId);
    const selfie = await capturedSelfie(environmentId, inquiryId);
    const { deps, logger } = setup();

    expect(
      await processVerification(job(environmentId, selfie.verificationId), deps),
    ).toMatchObject({
      verificationStatus: 'passed',
    });

    const checks = await checksOf(environmentId, selfie.verificationId);
    for (const name of ['selfie_account_comparison', 'selfie_repeat_detection']) {
      expect(checks[name], name).toMatchObject({
        status: 'not_applicable',
        reasons: ['execution_error'],
      });
    }
    expect(checks.selfie_similar_background_detection).toMatchObject({
      status: 'passed',
      metadata: { compared: 0, skipped: 1 },
    });
    expect(
      logger.entries.filter((entry) => entry.level === 'warn').map((entry) => entry.object.check),
    ).toEqual(['selfie_account_comparison', 'selfie_repeat_detection']);
  });

  it('does not search the background index for a layout below min-coverage', async () => {
    const environmentId = await tenant();
    const { inquiryId } = await inquiryIn(environmentId);
    await governmentId(environmentId, inquiryId);
    const selfie = await capturedSelfie(environmentId, inquiryId);
    const { deps, vision } = setup();
    const analysis = threePoseAnalysis();
    if (analysis.poses.center.background !== null) {
      analysis.poses.center.background.coverage = 0.1;
    }
    vision.answers.selfie = analysis;

    await processVerification(job(environmentId, selfie.verificationId), deps);

    expect(
      (await checksOf(environmentId, selfie.verificationId)).selfie_similar_background_detection,
    ).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
    expect(vision.calls.map((call) => call.endpoint)).not.toContain('compare-background');
  });

  it('fails for good without a centre file under the capture', async () => {
    const environmentId = await tenant();
    const { inquiryId } = await inquiryIn(environmentId);
    const selfie = await capturedSelfie(environmentId, inquiryId, { omit: ['center'] });
    const { deps } = setup();

    await expect(
      processVerification(job(environmentId, selfie.verificationId), deps),
    ).rejects.toMatchObject({
      name: 'PermanentJobError',
      reason: 'missing_selfie_center',
    });
  });
});
