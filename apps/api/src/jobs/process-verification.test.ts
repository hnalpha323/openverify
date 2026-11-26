import { createHash, randomBytes } from 'node:crypto';
import {
  DEFAULT_GOVERNMENT_ID_CHECKS,
  defaultInquiryTemplateAttributes,
  eventPayloadSchema,
  newId,
  newWebhookSecret,
} from '@openverify/contracts';
import { InvalidCheckConfigError, InvalidFaceEmbeddingError } from '@openverify/checks';
import { DomainError, getCheckDefinition } from '@openverify/core';
import {
  createFile,
  createInquirySession,
  createVerification,
  createWebhook,
  encryptBytes,
  getInquiry,
  getInquirySession,
  getVerification,
  listEvents,
  setVerificationStatus,
  transitionInquiryStatus,
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
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { createEventPublisher } from '../events/index.js';
import {
  VisionResponseError,
  VisionServiceError,
  VisionUnavailableError,
} from '../vision/index.js';
import { createWebhookDeliveryScheduler, type WebhookDeliveryJob } from '../webhooks/queue.js';
import {
  PermanentJobError,
  failVerificationAfterError,
  isPermanentJobFailure,
  processVerification,
  type ProcessVerificationDeps,
} from './process-verification.js';
import {
  createCapturingLogger,
  createFakeVision,
  createMemoryStorage,
  createRecordingQueue,
  embedFaceAnswer,
  governmentIdFixture,
  selfieFixture,
  visionFixture,
  phase3SelfieTemplate,
} from './testing.js';
import { phase5TemplateAttributes } from '../test-support/phase5-templates.js';

// C54.1: Workflow 5B builds the last type jobs (the document job is runnable since `api-document`),
// so this file keeps an unbuilt document job to test the refusal of a type whose job is not built.
vi.mock('./types/document.js', async () => {
  const { unbuiltTypeJob } = await import('./types/stub.js');
  return { documentJob: unbuiltTypeJob('document') };
});

const NOW = new Date('2026-10-20T12:00:00.000Z');
/**
 * The Phase 1-3 selfie template these tests were written for: a passive centre selfie with the
 * three Phase 1 checks. The C45.1 default (three poses, active liveness, every §4.2 check) is
 * tested in `process-selfie.test.ts`.
 */
const defaults = phase3SelfieTemplate(defaultInquiryTemplateAttributes());

let database: TestDatabase;
let db: Db;
let keyring: Keyring;
let environmentId: string;
const storage = createMemoryStorage();

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  keyring = database.keyring;
  environmentId = (await createTestTenant(db)).environment.id;
}, 60_000);

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await db.execute('delete from webhooks');
});

// Vision ---------------------------------------------------------------------

const governmentIdAnalysis = governmentIdFixture;
const selfieAnalysis = selfieFixture;
/** A vision client answering with the synthetic recorded fixtures (`jobs/testing.ts`). */
const fakeVision = createFakeVision;

// Data -----------------------------------------------------------------------

const syntheticJpeg = () => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...randomBytes(48)]);
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function pendingInquiry(
  verificationConfig: Record<string, unknown> = defaults['verification-config'],
) {
  const { inquiry } = await createTestInquiry(db, environmentId, {
    flow: defaults.flow,
    verificationConfig,
  });
  await transitionInquiryStatus(db, environmentId, inquiry.id, { from: 'created', to: 'pending' });
  return inquiry.id;
}

interface StoredImage {
  id: string;
  bytes: Uint8Array;
  storageKey: string;
}

async function addFile(verificationId: string, kind: FileKind): Promise<StoredImage> {
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

async function verification(
  inquiryId: string,
  type: 'government_id' | 'selfie',
  options: { kinds?: FileKind[]; status?: 'submitted' | 'passed' | 'failed' } = {},
) {
  const id = newId('ver');
  await createVerification(db, environmentId, { id, inquiryId, type });
  const kinds = options.kinds ?? (type === 'government_id' ? ['front', 'back'] : ['selfie-center']);
  const files: Partial<Record<FileKind, StoredImage>> = {};
  for (const kind of kinds) {
    files[kind] = await addFile(id, kind);
  }
  await setVerificationStatus(db, environmentId, id, { to: 'submitted' });
  if (options.status !== undefined && options.status !== 'submitted') {
    await setVerificationStatus(db, environmentId, id, { to: options.status });
  }
  return { id, files };
}

function setup(overrides: Partial<ProcessVerificationDeps> = {}) {
  const vision = fakeVision();
  const logger = createCapturingLogger();
  const queue = createRecordingQueue<WebhookDeliveryJob>();
  const events = createEventPublisher({
    db,
    deliveries: createWebhookDeliveryScheduler(queue),
    logger,
  });
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
  return { deps, vision, logger, queue };
}

const job = (verificationId: string) => ({ environmentId, verificationId });

/** Names of the events about `resourceId`, oldest first. */
async function eventNames(resourceId: string): Promise<string[]> {
  const page = await listEvents(db, environmentId, { size: 100 });
  return page.items
    .filter((event) => eventPayloadSchema.parse(event.payload).data.id === resourceId)
    .reverse()
    .map((event) => event.name);
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

// Government ID ----------------------------------------------------------------

/** The default verification config with `check` also enabled and required on the government ID. */
function configRequiring(check: string) {
  const config = structuredClone(defaults['verification-config']);
  config['government-id'] = {
    checks: { ...config['government-id']?.checks, [check]: { enabled: true, required: true } },
  };
  return config;
}

describe('processVerification: government ID', () => {
  it('sends the decrypted front and back to vision, passes the C36 required checks and publishes', async () => {
    const inquiryId = await pendingInquiry();
    const gov = await verification(inquiryId, 'government_id');
    const { deps, vision } = setup();

    expect(await processVerification(job(gov.id), deps)).toEqual({
      outcome: 'processed',
      verificationStatus: 'passed',
      inquiryStatus: 'pending',
    });

    expect(vision.calls).toEqual([
      {
        endpoint: 'government-id',
        images: {
          front: { mimeType: 'image/jpeg', bytes: [...(gov.files.front?.bytes ?? [])] },
          back: { mimeType: 'image/jpeg', bytes: [...(gov.files.back?.bytes ?? [])] },
        },
      },
    ]);
    const stored = await getVerification(db, environmentId, gov.id);
    expect(stored).toMatchObject({ status: 'passed', completedAt: NOW });
    // C36: every required check passed on the golden card, in a sandbox; the advisory ones are
    // stored as not required, and the disabled A-tier checks are not run.
    const required = stored?.checks.filter((check) => check.requirement === 'required') ?? [];
    expect(required.map((check) => check.name).sort()).toEqual(
      [...DEFAULT_GOVERNMENT_ID_CHECKS.required].sort(),
    );
    expect(required.every((check) => check.status === 'passed')).toBe(true);
    expect(
      stored?.checks
        .filter((check) => check.requirement === 'not_required')
        .map((check) => check.name)
        .sort(),
    ).toEqual([...DEFAULT_GOVERNMENT_ID_CHECKS.advisory].sort());
    expect(await eventNames(gov.id)).toEqual(['verification.passed']);
    expect((await getInquiry(db, environmentId, inquiryId))?.status).toBe('pending');
  });

  it("stores each check's stage, confidence and provenance (C29.2)", async () => {
    const inquiryId = await pendingInquiry();
    const gov = await verification(inquiryId, 'government_id');
    const { deps } = setup();
    await processVerification(job(gov.id), deps);

    const checks = (await getVerification(db, environmentId, gov.id))?.checks ?? [];
    const of = (name: string) => checks.find((check) => check.name === name);
    expect(of('id_blur_detection')).toMatchObject({
      stage: 'ga',
      confidence: null,
      provenance: {
        'implementation-version': 1,
        thresholds: { 'min-document-blur-score': 67.1, 'min-document-width-px': 616 },
      },
    });
    expect(of('id_portrait_detection')).toMatchObject({
      stage: 'beta',
      confidence: null,
      provenance: { 'implementation-version': 1, models: [{ id: 'yunet-2026may' }] },
    });
    // An H-tier result carries a confidence (C29.2).
    expect(of('id_tamper_detection')).toMatchObject({ stage: 'beta', status: 'passed' });
    expect(of('id_tamper_detection')?.confidence).toEqual(expect.any(Number));
    for (const check of checks) {
      expect(check.provenance?.['implementation-version'], check.name).toBe(
        getCheckDefinition(check.name)?.version,
      );
    }
  });

  it('publishes the verification resource with its checks and files', async () => {
    const inquiryId = await pendingInquiry();
    const gov = await verification(inquiryId, 'government_id');
    const { deps } = setup();
    await processVerification(job(gov.id), deps);

    const [event] = (await listEvents(db, environmentId, { size: 100 })).items.filter(
      (candidate) => eventPayloadSchema.parse(candidate.payload).data.id === gov.id,
    );
    const payload = eventPayloadSchema.parse(event?.payload);
    expect(payload.data).toMatchObject({
      type: 'verification/government-id',
      id: gov.id,
      attributes: { status: 'passed' },
      relationships: {
        inquiry: { data: { type: 'inquiry', id: inquiryId } },
        files: {
          data: [
            { type: 'file', id: gov.files.front?.id },
            { type: 'file', id: gov.files.back?.id },
          ],
        },
      },
    });
    expect(JSON.stringify(payload)).not.toContain('embedding');
  });

  it('fails a blurry ID and keeps the inquiry pending while attempts remain', async () => {
    const inquiryId = await pendingInquiry();
    const gov = await verification(inquiryId, 'government_id');
    const { deps, vision } = setup();
    const analysis = governmentIdAnalysis();
    analysis.sides.front.quality.is_blurry = true;
    // Phase 12A C9: a side whose document was measured is judged on that measure, so vision's
    // whole-image verdict decides only without one.
    analysis.sides.front.document_quality = null;
    vision.answers.governmentId = analysis;

    expect(await processVerification(job(gov.id), deps)).toMatchObject({
      verificationStatus: 'failed',
      inquiryStatus: 'pending',
    });
    const stored = await getVerification(db, environmentId, gov.id);
    expect(stored?.checks.find((check) => check.name === 'id_blur_detection')).toMatchObject({
      status: 'failed',
      type: 'user_behavior',
      reasons: ['image_blurry'],
    });
    expect(await eventNames(gov.id)).toEqual(['verification.failed']);
    expect(await eventNames(inquiryId)).toEqual([]);
  });

  it('fails the inquiry when the last attempt fails', async () => {
    const inquiryId = await pendingInquiry();
    await verification(inquiryId, 'government_id', { status: 'failed' });
    await verification(inquiryId, 'government_id', { status: 'failed' });
    const third = await verification(inquiryId, 'government_id');
    const { deps, vision } = setup();
    const analysis = governmentIdAnalysis();
    analysis.sides.front.quality.has_glare = true;
    vision.answers.governmentId = analysis;

    expect(await processVerification(job(third.id), deps)).toMatchObject({
      verificationStatus: 'failed',
      inquiryStatus: 'failed',
    });
    expect(await getInquiry(db, environmentId, inquiryId)).toMatchObject({
      status: 'failed',
      failedAt: NOW,
    });
    expect((await eventNames(inquiryId)).sort()).toEqual([
      'inquiry.failed',
      'inquiry.transitioned',
    ]);
  });

  it('fails the inquiry at once on a fraud check failure', async () => {
    const inquiryId = await pendingInquiry();
    const gov = await verification(inquiryId, 'government_id');
    const { deps, vision } = setup();
    const analysis = governmentIdAnalysis();
    analysis.sides.front.portrait = null;
    vision.answers.governmentId = analysis;

    expect(await processVerification(job(gov.id), deps)).toMatchObject({
      verificationStatus: 'failed',
      inquiryStatus: 'failed',
    });
    expect((await eventNames(inquiryId)).sort()).toEqual([
      'inquiry.failed',
      'inquiry.transitioned',
    ]);
  });

  it('fails the double-side check when the back is missing', async () => {
    const inquiryId = await pendingInquiry();
    const gov = await verification(inquiryId, 'government_id', { kinds: ['front'] });
    const { deps, vision } = setup();
    await processVerification(job(gov.id), deps);

    expect(Object.keys(vision.calls[0]?.images ?? {})).toEqual(['front']);
    const stored = await getVerification(db, environmentId, gov.id);
    expect(stored?.checks.find((check) => check.name === 'id_double_side_detection')).toMatchObject(
      { status: 'failed', reasons: ['back_not_present'] },
    );
  });

  it('sends a verification to review when a required check has no evidence (C30.1, C30.4)', async () => {
    const inquiryId = await pendingInquiry(configRequiring('id_public_figure_detection'));
    const gov = await verification(inquiryId, 'government_id');
    const { deps } = setup();

    expect(await processVerification(job(gov.id), deps)).toEqual({
      outcome: 'processed',
      verificationStatus: 'needs_review',
      inquiryStatus: 'pending',
    });
    const stored = await getVerification(db, environmentId, gov.id);
    expect(stored).toMatchObject({ status: 'needs_review', completedAt: NOW });
    // No provider is bound for the A-tier check (C35): it has no evidence.
    expect(
      stored?.checks.find((check) => check.name === 'id_public_figure_detection'),
    ).toMatchObject({ status: 'not_applicable', reasons: ['provider_not_configured'] });
    // needs_review emits no verification event; the inquiry announces the review (C30.4).
    expect(await eventNames(gov.id)).toEqual([]);
    expect((await getInquiry(db, environmentId, inquiryId))?.status).toBe('pending');
  });

  it('completes the inquiry, then marks it for review, in one transaction and in that order (C30.5)', async () => {
    const inquiryId = await pendingInquiry(configRequiring('id_public_figure_detection'));
    const gov = await verification(inquiryId, 'government_id');
    const selfie = await verification(inquiryId, 'selfie');
    const { deps, vision } = setup();
    const staged: string[] = [];
    const stage = deps.events.stage.bind(deps.events);
    deps.events = {
      ...deps.events,
      stage: (tx, input) => {
        staged.push(input.name);
        return stage(tx, input);
      },
      dispatch: deps.events.dispatch.bind(deps.events),
    };
    await processVerification(job(gov.id), deps);
    staged.length = 0;

    expect(await processVerification(job(selfie.id), deps)).toEqual({
      outcome: 'processed',
      verificationStatus: 'passed',
      inquiryStatus: 'needs_review',
    });

    expect(staged).toEqual([
      'verification.passed',
      'inquiry.completed',
      'inquiry.transitioned',
      'inquiry.marked-for-review',
      'inquiry.transitioned',
    ]);
    expect(await getInquiry(db, environmentId, inquiryId)).toMatchObject({
      status: 'needs_review',
      completedAt: NOW,
    });
    // The selfie is still compared with the portrait of the ID under review, re-embedded (C30.4);
    // the ID job itself re-embedded the selfie submitted before it (C34 id_selfie_comparison).
    expect(vision.calls.map((call) => call.endpoint)).toEqual([
      'government-id',
      'embed-face',
      'selfie',
      'embed-face',
    ]);
    const comparison = (await getVerification(db, environmentId, selfie.id))?.checks.find(
      (check) => check.name === 'selfie_id_comparison',
    );
    expect(comparison).toMatchObject({
      status: 'passed',
      metadata: { id_verification_id: gov.id },
    });
  });

  it('enqueues the webhook deliveries of its events after the commit', async () => {
    await createWebhook(db, environmentId, {
      id: newId('wbh'),
      url: 'https://hooks.example.test/in',
      enabledEvents: ['*'],
      secret: newWebhookSecret(),
    });
    const inquiryId = await pendingInquiry();
    const gov = await verification(inquiryId, 'government_id');
    const { deps, queue } = setup();
    await processVerification(job(gov.id), deps);
    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0]?.data).toMatchObject({ environmentId, attempt: 1 });
  });
});

// Selfie ------------------------------------------------------------------------

describe('processVerification: selfie', () => {
  it('compares the selfie with the stored ID front re-embedded (C30.4) and completes the inquiry', async () => {
    const inquiryId = await pendingInquiry();
    const gov = await verification(inquiryId, 'government_id', { status: 'passed' });
    const selfie = await verification(inquiryId, 'selfie');
    const { deps, vision } = setup();

    expect(await processVerification(job(selfie.id), deps)).toEqual({
      outcome: 'processed',
      verificationStatus: 'passed',
      inquiryStatus: 'completed',
    });

    expect(vision.calls).toEqual([
      {
        endpoint: 'selfie',
        images: {
          center: {
            mimeType: 'image/jpeg',
            bytes: [...(selfie.files['selfie-center']?.bytes ?? [])],
          },
        },
      },
      {
        endpoint: 'embed-face',
        images: { image: { mimeType: 'image/jpeg', bytes: [...(gov.files.front?.bytes ?? [])] } },
        // K101: the stored front is a document; its portrait is the face inside its quad.
        subject: 'document',
      },
    ]);
    const stored = await getVerification(db, environmentId, selfie.id);
    const comparison = stored?.checks.find((check) => check.name === 'selfie_id_comparison');
    expect(comparison).toMatchObject({
      status: 'passed',
      metadata: {
        similarity: 0.72,
        threshold: 0.394,
        confidence_stage: 'beta',
        id_verification_id: gov.id,
      },
      stage: 'beta',
      confidence: comparison?.metadata.confidence,
      provenance: { 'implementation-version': 2, thresholds: { threshold: 0.394 } },
    });
    expect(await getInquiry(db, environmentId, inquiryId)).toMatchObject({
      status: 'completed',
      completedAt: NOW,
    });
    expect(await eventNames(selfie.id)).toEqual(['verification.passed']);
    expect((await eventNames(inquiryId)).sort()).toEqual([
      'inquiry.completed',
      'inquiry.transitioned',
    ]);
  });

  it('uses a submitted ID that is still being processed', async () => {
    const inquiryId = await pendingInquiry();
    const gov = await verification(inquiryId, 'government_id');
    const selfie = await verification(inquiryId, 'selfie');
    const { deps } = setup();
    expect(await processVerification(job(selfie.id), deps)).toMatchObject({
      verificationStatus: 'passed',
      inquiryStatus: 'pending',
    });
    const stored = await getVerification(db, environmentId, selfie.id);
    expect(
      stored?.checks.find((check) => check.name === 'selfie_id_comparison')?.metadata,
    ).toMatchObject({
      id_verification_id: gov.id,
    });
  });

  it('fails a selfie of a different face and fails the inquiry', async () => {
    const inquiryId = await pendingInquiry();
    await verification(inquiryId, 'government_id', { status: 'passed' });
    const selfie = await verification(inquiryId, 'selfie');
    const { deps, vision } = setup();
    const analysis = selfieAnalysis();
    const other = visionFixture('embed-face') as { face: { embedding: number[] } };
    if (analysis.poses.center.face) {
      analysis.poses.center.face = {
        ...analysis.poses.center.face,
        embedding: other.face.embedding,
      };
    }
    vision.answers.selfie = analysis;

    expect(await processVerification(job(selfie.id), deps)).toMatchObject({
      verificationStatus: 'failed',
      inquiryStatus: 'failed',
    });
    const stored = await getVerification(db, environmentId, selfie.id);
    expect(stored?.checks.find((check) => check.name === 'selfie_id_comparison')).toMatchObject({
      status: 'failed',
      reasons: ['face_mismatch'],
    });
    expect((await eventNames(inquiryId)).sort()).toEqual([
      'inquiry.failed',
      'inquiry.transitioned',
    ]);
  });

  // C43 (owner decision 5): without a reference portrait the comparison is not_applicable with
  // no_reference_data (Phase 1 answered failed/id_portrait_not_present), so a required comparison
  // sends the selfie to review.
  it('has no reference when the inquiry has no usable ID', async () => {
    const inquiryId = await pendingInquiry();
    await verification(inquiryId, 'government_id', { status: 'failed' });
    const selfie = await verification(inquiryId, 'selfie');
    const { deps, vision } = setup();
    expect(await processVerification(job(selfie.id), deps)).toMatchObject({
      verificationStatus: 'needs_review',
    });
    expect(vision.calls.map((call) => call.endpoint)).toEqual(['selfie']);
    const stored = await getVerification(db, environmentId, selfie.id);
    expect(stored?.checks.find((check) => check.name === 'selfie_id_comparison')).toMatchObject({
      status: 'not_applicable',
      reasons: ['no_reference_data'],
      metadata: { reference: 'government_id' },
    });
  });

  it('has no reference when the ID has no front image', async () => {
    const inquiryId = await pendingInquiry();
    await verification(inquiryId, 'government_id', { status: 'passed', kinds: ['back'] });
    const selfie = await verification(inquiryId, 'selfie');
    const { deps, vision } = setup();
    await processVerification(job(selfie.id), deps);
    expect(vision.calls.map((call) => call.endpoint)).toEqual(['selfie']);
    const stored = await getVerification(db, environmentId, selfie.id);
    expect(stored?.checks.find((check) => check.name === 'selfie_id_comparison')).toMatchObject({
      status: 'not_applicable',
      reasons: ['no_reference_data'],
      metadata: { reference: 'portrait' },
    });
  });

  it('has no reference when the stored ID front shows no portrait', async () => {
    const inquiryId = await pendingInquiry();
    await verification(inquiryId, 'government_id', { status: 'passed' });
    const selfie = await verification(inquiryId, 'selfie');
    const { deps, vision } = setup();
    vision.answers.embedFace = embedFaceAnswer(null);
    await processVerification(job(selfie.id), deps);
    expect(vision.calls.map((call) => call.endpoint)).toEqual(['selfie', 'embed-face']);
    const stored = await getVerification(db, environmentId, selfie.id);
    expect(stored?.checks.find((check) => check.name === 'selfie_id_comparison')).toMatchObject({
      status: 'not_applicable',
      reasons: ['no_reference_data'],
      metadata: { reference: 'portrait' },
    });
  });

  it('does not decrypt the ID when the comparison is disabled', async () => {
    const config = structuredClone(defaults['verification-config']);
    config.selfie = {
      checks: {
        selfie_image_quality_detection: { enabled: true, required: true },
        selfie_id_comparison: { enabled: false, required: true },
      },
    };
    const inquiryId = await pendingInquiry(config);
    await verification(inquiryId, 'government_id', { status: 'passed' });
    const selfie = await verification(inquiryId, 'selfie');
    const { deps, vision } = setup();
    expect(await processVerification(job(selfie.id), deps)).toMatchObject({
      verificationStatus: 'passed',
    });
    expect(vision.calls.map((call) => call.endpoint)).toEqual(['selfie']);
  });

  it('never logs embeddings or image bytes', async () => {
    const inquiryId = await pendingInquiry();
    const gov = await verification(inquiryId, 'government_id', { status: 'passed' });
    const selfie = await verification(inquiryId, 'selfie');
    const { deps, logger } = setup();
    await processVerification(job(selfie.id), deps);

    const logged = JSON.stringify(logger.entries);
    expect(logger.entries.length).toBeGreaterThan(0);
    const embedding = selfieAnalysis().poses.center.face?.embedding ?? [];
    for (const value of embedding.slice(0, 5)) {
      expect(logged).not.toContain(String(value));
    }
    for (const bytes of [selfie.files['selfie-center']?.bytes, gov.files.front?.bytes]) {
      expect(logged).not.toContain(Buffer.from(bytes ?? []).toString('base64'));
      expect(logged).not.toContain(Buffer.from(bytes ?? []).toString('hex'));
    }
    expect(logged).not.toContain('embedding');
  });
});

// Idempotency and failures ----------------------------------------------------

describe('processVerification: idempotency', () => {
  it('skips a verification that does not exist', async () => {
    const { deps } = setup();
    expect(await processVerification(job(newId('ver')), deps)).toEqual({
      outcome: 'skipped',
      reason: 'not_found',
    });
  });

  it('does not process a verification twice, and publishes each event once', async () => {
    const inquiryId = await pendingInquiry();
    const gov = await verification(inquiryId, 'government_id');
    const { deps, vision } = setup();
    await processVerification(job(gov.id), deps);
    expect(await processVerification(job(gov.id), deps)).toEqual({
      outcome: 'skipped',
      reason: 'not_submitted',
      inquiryStatus: 'pending',
    });
    expect(vision.calls).toHaveLength(1);
    expect(await eventNames(gov.id)).toEqual(['verification.passed']);
  });

  it('completes the inquiry on a re-run when the earlier run stopped before that step', async () => {
    const inquiryId = await pendingInquiry();
    await verification(inquiryId, 'government_id', { status: 'passed' });
    const selfie = await verification(inquiryId, 'selfie', { status: 'passed' });
    const { deps } = setup();
    expect(await processVerification(job(selfie.id), deps)).toEqual({
      outcome: 'skipped',
      reason: 'not_submitted',
      inquiryStatus: 'completed',
    });
    expect((await eventNames(inquiryId)).sort()).toEqual([
      'inquiry.completed',
      'inquiry.transitioned',
    ]);
    await processVerification(job(selfie.id), deps);
    expect((await eventNames(inquiryId)).sort()).toEqual([
      'inquiry.completed',
      'inquiry.transitioned',
    ]);
  });

  it('leaves an inquiry that is not pending alone', async () => {
    const { inquiry } = await createTestInquiry(db, environmentId, {
      flow: defaults.flow,
      verificationConfig: defaults['verification-config'],
    });
    const gov = await verification(inquiry.id, 'government_id');
    const { deps } = setup();
    expect(await processVerification(job(gov.id), deps)).toMatchObject({
      verificationStatus: 'passed',
      inquiryStatus: 'created',
    });
  });
});

describe('processVerification: failures leave statuses unchanged', () => {
  async function expectUntouched(verificationId: string, inquiryId: string) {
    const stored = await getVerification(db, environmentId, verificationId);
    expect(stored).toMatchObject({ status: 'submitted', checks: [] });
    expect(await eventNames(verificationId)).toEqual([]);
    expect((await getInquiry(db, environmentId, inquiryId))?.status).toBe('pending');
  }

  it('rethrows a vision outage for a retry', async () => {
    const inquiryId = await pendingInquiry();
    const gov = await verification(inquiryId, 'government_id');
    const { deps, vision } = setup();
    vision.answers.governmentId = new VisionUnavailableError(
      '/v1/analyze/government-id',
      'timeout',
    );
    const error = await rejection(processVerification(job(gov.id), deps));
    expect(error).toBeInstanceOf(VisionUnavailableError);
    expect(isPermanentJobFailure(error)).toBe(false);
    await expectUntouched(gov.id, inquiryId);
  });

  it.each([
    [
      'the stored object is missing',
      async (image: StoredImage) => storage.delete(image.storageKey),
      'file_missing',
    ],
    [
      'the ciphertext was tampered with',
      async (image: StoredImage) => {
        const ciphertext = storage.objects.get(image.storageKey) ?? new Uint8Array();
        const tampered = Uint8Array.from(ciphertext);
        tampered[tampered.length - 1] = (tampered.at(-1) ?? 0) ^ 0xff;
        await storage.put(image.storageKey, tampered);
      },
      'file_undecryptable',
    ],
    [
      'the plaintext does not match its digest',
      async (image: StoredImage) => {
        const other = syntheticJpeg();
        const sealed = encryptBytes(other, keyring, { context: image.id });
        await storage.put(image.storageKey, sealed.ciphertext);
        await database.client.query('update files set wrapped_dek = $1 where id = $2', [
          sealed.wrappedDek,
          image.id,
        ]);
      },
      'file_integrity',
    ],
  ])('fails permanently when %s', async (_label, damage, reason) => {
    const inquiryId = await pendingInquiry();
    const gov = await verification(inquiryId, 'government_id');
    const { front } = gov.files;
    if (front === undefined) throw new Error('no front stored');
    await damage(front);
    const { deps, vision } = setup();
    const error = await rejection(processVerification(job(gov.id), deps));
    expect(error).toBeInstanceOf(PermanentJobError);
    expect(error).toMatchObject({ reason });
    expect(vision.calls).toEqual([]);
    await expectUntouched(gov.id, inquiryId);
  });

  it.each([
    ['government_id', 'missing_front', ['back']],
    ['selfie', 'missing_selfie_center', ['selfie-left']],
  ] as const)(
    'fails a %s verification without its required image permanently',
    async (type, reason, kinds) => {
      const inquiryId = await pendingInquiry();
      const created = await verification(inquiryId, type, { kinds: [...kinds] });
      const { deps } = setup();
      const error = await rejection(processVerification(job(created.id), deps));
      expect(error).toMatchObject({ name: 'PermanentJobError', reason });
      await expectUntouched(created.id, inquiryId);
    },
  );

  it('fails permanently, touching nothing, on a type the worker does not run yet (C50.6, C54)', async () => {
    const template = phase5TemplateAttributes();
    const { inquiry } = await createTestInquiry(db, environmentId, {
      flow: template.flow,
      verificationConfig: template['verification-config'],
    });
    await transitionInquiryStatus(db, environmentId, inquiry.id, {
      from: 'created',
      to: 'pending',
    });
    const id = newId('ver');
    await createVerification(db, environmentId, { id, inquiryId: inquiry.id, type: 'document' });
    await addFile(id, 'document');
    await setVerificationStatus(db, environmentId, id, { to: 'submitted' });
    const { deps, vision } = setup();

    const error = await rejection(processVerification(job(id), deps));

    expect(error).toMatchObject({ name: 'PermanentJobError', reason: 'unsupported_verification' });
    expect(vision.calls).toEqual([]);
    await expectUntouched(id, inquiry.id);
  });

  it('fails permanently on a template version that is not a valid flow', async () => {
    const { inquiry } = await createTestInquiry(db, environmentId, {
      flow: { not: 'a flow' },
      verificationConfig: defaults['verification-config'],
    });
    await transitionInquiryStatus(db, environmentId, inquiry.id, {
      from: 'created',
      to: 'pending',
    });
    const gov = await verification(inquiry.id, 'government_id');
    const error = await rejection(processVerification(job(gov.id), setup().deps));
    expect(error).toMatchObject({ name: 'PermanentJobError', reason: 'invalid_template' });
  });
});

describe('processVerification: an image vision cannot read', () => {
  const summary = async (verificationId: string) =>
    (await getVerification(db, environmentId, verificationId))?.checks.map((check) => [
      check.name,
      check.status,
      check.reasons,
    ]);

  it.each([413, 415, 422])(
    'fails the ID with a retryable image_unreadable hint when vision answers %i',
    async (status) => {
      const inquiryId = await pendingInquiry();
      const gov = await verification(inquiryId, 'government_id');
      const { deps, vision } = setup();
      vision.answers.governmentId = new VisionServiceError('/v1/analyze/government-id', status);

      expect(await processVerification(job(gov.id), deps)).toEqual({
        outcome: 'processed',
        verificationStatus: 'failed',
        inquiryStatus: 'pending',
      });
      expect(await getVerification(db, environmentId, gov.id)).toMatchObject({
        status: 'failed',
        completedAt: NOW,
      });
      // The image quality checks fail; every other check that reads vision stays pending, and a
      // check that needs only the extraction has no input (C29.4).
      expect(await summary(gov.id)).toEqual(
        (await summary(gov.id))?.map(([name]) => [
          name,
          ...(name === 'id_blur_detection' || name === 'id_glare_detection'
            ? ['failed', ['image_unreadable']]
            : getCheckDefinition(String(name))?.inputs.includes('vision') === true
              ? ['pending', ['image_unreadable']]
              : ['not_applicable', ['input_missing']]),
        ]),
      );
      expect((await summary(gov.id))?.length).toBe(
        DEFAULT_GOVERNMENT_ID_CHECKS.required.length + DEFAULT_GOVERNMENT_ID_CHECKS.advisory.length,
      );
      expect(await eventNames(gov.id)).toEqual(['verification.failed']);
      expect(await eventNames(inquiryId)).toEqual([]);
    },
  );

  it('fails the selfie the same way, without analysing the ID', async () => {
    const inquiryId = await pendingInquiry();
    await verification(inquiryId, 'government_id', { status: 'passed' });
    const selfie = await verification(inquiryId, 'selfie');
    const { deps, vision } = setup();
    vision.answers.selfie = new VisionServiceError('/v1/analyze/selfie', 422);

    expect(await processVerification(job(selfie.id), deps)).toMatchObject({
      verificationStatus: 'failed',
      inquiryStatus: 'pending',
    });
    expect(vision.calls.map((call) => call.endpoint)).toEqual(['selfie']);
    expect(await summary(selfie.id)).toEqual([
      ['selfie_id_comparison', 'pending', ['image_unreadable']],
      ['selfie_image_quality_detection', 'failed', ['image_unreadable']],
      ['selfie_multiple_faces_detection', 'pending', ['image_unreadable']],
    ]);
  });

  it('counts the attempt, so the inquiry fails after the last one', async () => {
    const inquiryId = await pendingInquiry();
    await verification(inquiryId, 'selfie', { status: 'failed' });
    await verification(inquiryId, 'selfie', { status: 'failed' });
    const third = await verification(inquiryId, 'selfie');
    const { deps, vision } = setup();
    vision.answers.selfie = new VisionServiceError('/v1/analyze/selfie', 415);

    expect(await processVerification(job(third.id), deps)).toMatchObject({
      verificationStatus: 'failed',
      inquiryStatus: 'failed',
    });
    expect((await eventNames(inquiryId)).sort()).toEqual([
      'inquiry.failed',
      'inquiry.transitioned',
    ]);
  });

  it('fails permanently when the template requires no image quality check', async () => {
    const config = structuredClone(defaults['verification-config']);
    config['government-id'] = {
      checks: { id_portrait_detection: { enabled: true, required: true } },
    };
    const inquiryId = await pendingInquiry(config);
    const gov = await verification(inquiryId, 'government_id');
    const { deps, vision } = setup();
    vision.answers.governmentId = new VisionServiceError('/v1/analyze/government-id', 415);

    const error = await rejection(processVerification(job(gov.id), deps));
    expect(error).toMatchObject({ name: 'PermanentJobError', reason: 'image_unreadable' });
    expect((await getVerification(db, environmentId, gov.id))?.status).toBe('submitted');
  });

  it.each([400, 401, 404])(
    'records a vision %i at once on the checks that needed vision: no retry can cure it (C30.3)',
    async (status) => {
      const inquiryId = await pendingInquiry();
      const gov = await verification(inquiryId, 'government_id');
      const { deps, vision } = setup();
      const failure = new VisionServiceError('/v1/analyze/government-id', status);
      vision.answers.governmentId = failure;

      expect(isPermanentJobFailure(failure)).toBe(true);
      expect(await processVerification(job(gov.id), deps)).toMatchObject({
        verificationStatus: 'needs_review',
      });
      const stored = await getVerification(db, environmentId, gov.id);
      expect(stored?.checks.map((check) => [check.name, check.status, check.reasons])).toEqual(
        stored?.checks.map((check) => [
          check.name,
          'not_applicable',
          [
            getCheckDefinition(check.name)?.inputs.includes('vision') === true
              ? 'execution_error'
              : 'input_missing',
          ],
        ]),
      );
      expect(stored?.checks.find((check) => check.name === 'id_blur_detection')?.reasons).toEqual([
        'execution_error',
      ]);
    },
  );
});

describe('failVerificationAfterError', () => {
  it('fails a submitted verification without inventing checks, and the inquiry with it', async () => {
    const inquiryId = await pendingInquiry();
    const gov = await verification(inquiryId, 'government_id');
    const { deps, logger } = setup();

    expect(await failVerificationAfterError(job(gov.id), deps, 'PermanentJobError')).toEqual({
      outcome: 'failed',
      inquiryStatus: 'failed',
    });

    expect(await getVerification(db, environmentId, gov.id)).toMatchObject({
      status: 'failed',
      completedAt: NOW,
      checks: [],
    });
    expect(await eventNames(gov.id)).toEqual(['verification.failed']);
    expect((await eventNames(inquiryId)).sort()).toEqual([
      'inquiry.failed',
      'inquiry.transitioned',
    ]);
    const [event] = (await listEvents(db, environmentId, { size: 100 })).items.filter(
      (candidate) => eventPayloadSchema.parse(candidate.payload).data.id === gov.id,
    );
    expect(eventPayloadSchema.parse(event?.payload).data).toMatchObject({
      attributes: { status: 'failed', checks: [] },
      relationships: {
        files: {
          data: [
            { type: 'file', id: gov.files.front?.id },
            { type: 'file', id: gov.files.back?.id },
          ],
        },
      },
    });
    expect(logger.entries).toContainEqual({
      level: 'warn',
      object: { verificationId: gov.id, inquiryId, cause: 'PermanentJobError' },
      message: 'verification failed: its processing cannot finish',
    });
  });

  it('leaves a verification that is no longer submitted alone, and settles the inquiry', async () => {
    const inquiryId = await pendingInquiry();
    await verification(inquiryId, 'government_id', { status: 'passed' });
    const selfie = await verification(inquiryId, 'selfie', { status: 'passed' });
    const { deps } = setup();

    expect(await failVerificationAfterError(job(selfie.id), deps, 'Error')).toEqual({
      outcome: 'skipped',
      reason: 'not_submitted',
      inquiryStatus: 'completed',
    });
    expect((await getVerification(db, environmentId, selfie.id))?.status).toBe('passed');
    expect(await eventNames(selfie.id)).toEqual([]);
  });

  it('still fails the verification when the template cannot be read', async () => {
    const { inquiry } = await createTestInquiry(db, environmentId, {
      flow: { not: 'a flow' },
      verificationConfig: defaults['verification-config'],
    });
    await transitionInquiryStatus(db, environmentId, inquiry.id, {
      from: 'created',
      to: 'pending',
    });
    const gov = await verification(inquiry.id, 'government_id');

    expect(
      await failVerificationAfterError(job(gov.id), setup().deps, 'PermanentJobError'),
    ).toEqual({ outcome: 'failed', inquiryStatus: 'pending' });
    expect((await getVerification(db, environmentId, gov.id))?.status).toBe('failed');
    expect(await eventNames(gov.id)).toEqual(['verification.failed']);
  });

  it('skips a verification that does not exist', async () => {
    const { deps } = setup();
    expect(await failVerificationAfterError(job(newId('ver')), deps, 'Error')).toEqual({
      outcome: 'skipped',
      reason: 'not_found',
    });
  });
});

describe('isPermanentJobFailure', () => {
  it.each([
    [new PermanentJobError('file_missing'), true],
    [new VisionResponseError('/v1/analyze/selfie', []), true],
    [new InvalidFaceEmbeddingError('a', 'length'), true],
    [new InvalidCheckConfigError('id_blur_detection', []), true],
    [new DomainError('anything', 'domain rule'), true],
    [new ZodError([]), true],
    [new VisionUnavailableError('/v1/analyze/selfie', 'network'), false],
    [new Error('connection terminated'), false],
    ['not an error', false],
  ])('%s → %s', (error, permanent) => {
    expect(isPermanentJobFailure(error)).toBe(permanent);
  });
});

// Phase 2: C10 lifecycle and C11 check configuration --------------------------------------------

describe('processVerification: C10 inquiry lifecycle', () => {
  it('announces the outcome with inquiry.transitioned and cancels the active sessions (F005)', async () => {
    const inquiryId = await pendingInquiry();
    await verification(inquiryId, 'government_id', { status: 'passed' });
    const selfie = await verification(inquiryId, 'selfie');
    const sessionId = newId('iqse');
    await createInquirySession(db, environmentId, {
      id: sessionId,
      inquiryId,
      tokenHash: sha256(randomBytes(16)),
      expiresAt: new Date(NOW.getTime() + 86_400_000),
    });
    const { deps } = setup();

    await processVerification(job(selfie.id), deps);

    const events = (await listEvents(db, environmentId, { size: 100 })).items.reverse();
    const transitioned = events.find(
      (event) =>
        event.name === 'inquiry.transitioned' &&
        eventPayloadSchema.parse(event.payload).data.id === inquiryId,
    );
    expect(eventPayloadSchema.parse(transitioned?.payload).meta).toEqual({
      from: 'pending',
      to: 'completed',
    });
    expect(await getInquirySession(db, environmentId, sessionId)).toMatchObject({
      status: 'canceled',
      canceledAt: NOW,
    });
    expect(await eventNames(sessionId)).toEqual(['inquiry-session.canceled']);
  });
});

describe('processVerification: C11 check configuration', () => {
  /** The default config with `config` set on one check. */
  function configWith(apiType: 'government-id' | 'selfie', check: string, config: object) {
    const verificationConfig = structuredClone(defaults['verification-config']);
    const typeConfig = verificationConfig[apiType];
    if (typeConfig === undefined) {
      throw new Error(`the default template configures ${apiType}`);
    }
    typeConfig.checks[check] = { enabled: true, required: true, config: { ...config } };
    return verificationConfig;
  }

  async function checkOf(verificationId: string, name: string) {
    return (await getVerification(db, environmentId, verificationId))?.checks.find(
      (check) => check.name === name,
    );
  }

  it('fails the ID blur check below a configured min-blur-score, recording it', async () => {
    const inquiryId = await pendingInquiry(
      configWith('government-id', 'id_blur_detection', { 'min-blur-score': 200 }),
    );
    const gov = await verification(inquiryId, 'government_id');
    const { deps, vision } = setup();
    const analysis = governmentIdAnalysis();
    analysis.sides.front.quality.blur_score = 150;
    vision.answers.governmentId = analysis;

    expect(await processVerification(job(gov.id), deps)).toMatchObject({
      verificationStatus: 'failed',
    });
    expect(await checkOf(gov.id, 'id_blur_detection')).toMatchObject({
      status: 'failed',
      reasons: ['image_blurry'],
      metadata: { front_blur_score: 150, blurry_sides: ['front'], min_blur_score: 200 },
    });
  });

  it('records a configured threshold in the provenance too (C29.2)', async () => {
    const inquiryId = await pendingInquiry(
      configWith('government-id', 'id_blur_detection', { 'min-blur-score': 200 }),
    );
    const gov = await verification(inquiryId, 'government_id');
    const { deps } = setup();
    await processVerification(job(gov.id), deps);

    expect(await checkOf(gov.id, 'id_blur_detection')).toMatchObject({
      provenance: { 'implementation-version': 1, thresholds: { 'min-blur-score': 200 } },
    });
    expect(await checkOf(gov.id, 'id_glare_detection')).toMatchObject({
      provenance: { 'implementation-version': 1, thresholds: {} },
    });
  });

  it('passes a blur score the vision default rejects when the configured minimum allows it', async () => {
    const inquiryId = await pendingInquiry(
      configWith('government-id', 'id_blur_detection', { 'min-blur-score': 50 }),
    );
    const gov = await verification(inquiryId, 'government_id');
    const { deps, vision } = setup();
    const analysis = governmentIdAnalysis();
    analysis.sides.front.quality.blur_score = 80;
    analysis.sides.front.quality.is_blurry = true;
    vision.answers.governmentId = analysis;

    expect(await processVerification(job(gov.id), deps)).toMatchObject({
      verificationStatus: 'passed',
    });
    expect((await checkOf(gov.id, 'id_blur_detection'))?.status).toBe('passed');
  });

  it('applies a configured max-glare-ratio to every side', async () => {
    const inquiryId = await pendingInquiry(
      configWith('government-id', 'id_glare_detection', { 'max-glare-ratio': 0.001 }),
    );
    const gov = await verification(inquiryId, 'government_id');
    const { deps } = setup();

    await processVerification(job(gov.id), deps);

    expect(await checkOf(gov.id, 'id_glare_detection')).toMatchObject({
      status: 'failed',
      reasons: ['glare_present'],
      metadata: { glare_sides: ['front'], max_glare_ratio: 0.001 },
    });
  });

  it('applies the configured selfie quality thresholds', async () => {
    const inquiryId = await pendingInquiry(
      configWith('selfie', 'selfie_image_quality_detection', {
        'min-blur-score': 500,
        'min-brightness': 0.4,
      }),
    );
    await verification(inquiryId, 'government_id', { status: 'passed' });
    const selfie = await verification(inquiryId, 'selfie');
    const { deps } = setup();

    await processVerification(job(selfie.id), deps);

    expect(await checkOf(selfie.id, 'selfie_image_quality_detection')).toMatchObject({
      status: 'failed',
      reasons: ['image_blurry', 'image_too_dark'],
      metadata: { min_blur_score: 500, min_brightness: 0.4 },
    });
  });

  it('applies a configured max-brightness', async () => {
    const inquiryId = await pendingInquiry(
      configWith('selfie', 'selfie_image_quality_detection', { 'max-brightness': 0.3 }),
    );
    await verification(inquiryId, 'government_id', { status: 'passed' });
    const selfie = await verification(inquiryId, 'selfie');
    const { deps } = setup();

    await processVerification(job(selfie.id), deps);

    expect(await checkOf(selfie.id, 'selfie_image_quality_detection')).toMatchObject({
      status: 'failed',
      reasons: ['image_too_bright'],
    });
  });

  it('compares faces with the configured threshold', async () => {
    const inquiryId = await pendingInquiry(
      configWith('selfie', 'selfie_id_comparison', { threshold: 0.5 }),
    );
    await verification(inquiryId, 'government_id', { status: 'passed' });
    const selfie = await verification(inquiryId, 'selfie');
    const { deps } = setup({ faceMatchThreshold: 0.3 });

    await processVerification(job(selfie.id), deps);

    expect(await checkOf(selfie.id, 'selfie_id_comparison')).toMatchObject({
      status: 'passed',
      metadata: { similarity: 0.72, threshold: 0.5 },
    });
  });

  it('keeps the vision verdicts and adds no threshold without config', async () => {
    const inquiryId = await pendingInquiry();
    const gov = await verification(inquiryId, 'government_id');
    const { deps, vision } = setup();
    const analysis = governmentIdAnalysis();
    analysis.sides.front.quality.blur_score = 150;
    vision.answers.governmentId = analysis;

    await processVerification(job(gov.id), deps);

    const blur = await checkOf(gov.id, 'id_blur_detection');
    expect(blur?.status).toBe('passed');
    expect(blur?.metadata).not.toHaveProperty('min_blur_score');
  });
});
