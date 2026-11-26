/**
 * The worker's selfie writers against Postgres 17 row locks (Testcontainers), in the pattern of
 * `redaction-race.integration.test.ts` (G002). Every writer takes the C40.6 lock order (the
 * inquiry, its `redacted_at` re-checked, then the verification, then the capture, then the face
 * data), so a concurrent redaction, decline, retention deletion or rebuild is serialized with it
 * whichever comes first:
 * - the decision write (checks, the capture to `processed` with its device cleared, the template
 *   and background row) and a redaction;
 * - the decision write and a decline that commits first;
 * - `failVerificationAfterError`'s capture update and a redaction, both ways;
 * - the retention deletion and a writer holding the inquiry;
 * - the rebuild and a redaction or a retention deletion that removes its row meanwhile.
 * It also checks C45.3 on Postgres: a passed verification with matching consent has a template
 * row, one without consent has none.
 * Vision answers are the synthetic golden fixtures; every value is synthetic.
 */
import { createHash, randomBytes } from 'node:crypto';
import { defaultInquiryTemplateAttributes, newId } from '@openverify/contracts';
import {
  createDatabase,
  createFile,
  createInquirySession,
  createKeyring,
  createVerification,
  deleteExpiredFaceData,
  encryptBytes,
  faceTemplates,
  getSelfieCapture,
  getVerification,
  recordInquirySessionConsent,
  redactInquiryRecords,
  runMigrations,
  selfieBackgrounds,
  setDefaultKeyring,
  setVerificationStatus,
  transitionInquiryStatus,
  type Database,
} from '@openverify/db';
import {
  createIntegrationPool,
  createTestInquiry,
  createTestTenant,
  startIntegrationPostgres,
  ifSet,
} from '@openverify/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEventPublisher, type TransactionalEventPublisher } from '../events/index.js';
import type { VisionClient } from '../ports.js';
import { createWebhookDeliveryScheduler } from '../webhooks/queue.js';
import { rebuildFaceIndex } from './face-index-rebuild.js';
import {
  failVerificationAfterError,
  processVerification,
  type ProcessVerificationDeps,
} from './process-verification.js';
import {
  WEBCAM_DEVICE,
  seedSubmittedCapture,
  syntheticJpeg,
  threePoseAnalysis,
} from './selfie-testing.js';
import {
  createCapturingLogger,
  createFakeVision,
  createMemoryStorage,
  createRecordingQueue,
} from './testing.js';

const NOW = new Date('2026-10-21T12:00:00.000Z');
const CAPTURED = new Date('2026-10-21T11:58:00.000Z');
const keyring = createKeyring(randomBytes(32));
const defaults = defaultInquiryTemplateAttributes();
/** Long enough for a statement that takes no lock to finish first. */
const WAIT_MS = 1_500;

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
let environmentId: string;
const storage = createMemoryStorage();

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 8 });
  db = createDatabase(pool);
  setDefaultKeyring(keyring);
  await runMigrations(db);
  environmentId = (await createTestTenant(db)).environment.id;
}, 180_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(pool)?.end();
  await container?.stop();
});

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/**
 * A pending inquiry of the C45.1 default template with matching consent, a passed government ID
 * with its front, and a selfie verification with a submitted three-pose capture and its device.
 */
async function submittedSelfie(options: { matching?: boolean } = {}) {
  const { inquiry } = await createTestInquiry(db, environmentId, {
    flow: defaults.flow,
    verificationConfig: defaults['verification-config'],
  });
  await transitionInquiryStatus(db, environmentId, inquiry.id, { from: 'created', to: 'pending' });
  const session = await createInquirySession(db, environmentId, {
    id: newId('iqse'),
    inquiryId: inquiry.id,
    tokenHash: sha256(randomBytes(16)),
    expiresAt: new Date(NOW.getTime() + 86_400_000),
  });
  await recordInquirySessionConsent(db, environmentId, session.id, {
    acceptedAt: CAPTURED,
    textKeys: ['consent.biometric', 'consent.processing'],
    optionalTextKeys: options.matching === false ? [] : ['consent.biometric-matching'],
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
  const id = newId('file');
  const bytes = syntheticJpeg();
  const sealed = encryptBytes(bytes, keyring, { context: id });
  await storage.put(`${environmentId}/${id}`, sealed.ciphertext);
  await createFile(db, environmentId, {
    id,
    verificationId: governmentId,
    kind: 'front',
    storageKey: `${environmentId}/${id}`,
    mimeType: 'image/jpeg',
    byteSize: bytes.length,
    sha256: sha256(bytes),
    wrappedDek: sealed.wrappedDek,
  });
  await setVerificationStatus(db, environmentId, governmentId, { to: 'submitted' });
  await setVerificationStatus(db, environmentId, governmentId, { to: 'passed' });
  const verificationId = newId('ver');
  await createVerification(db, environmentId, {
    id: verificationId,
    inquiryId: inquiry.id,
    type: 'selfie',
  });
  const capture = await seedSubmittedCapture({ db, keyring, storage }, environmentId, {
    inquiryId: inquiry.id,
    verificationId,
    createdAt: CAPTURED,
    device: WEBCAM_DEVICE,
  });
  return { inquiryId: inquiry.id, verificationId, captureId: capture.captureId };
}

/**
 * The job's dependencies. `inTransaction` runs once, inside the writer's transaction, when it
 * stages its first event (after the checks or the verification move, before the capture and the
 * face data).
 */
function jobDeps(
  inTransaction?: () => Promise<void>,
  vision: VisionClient = goldenVision(),
): ProcessVerificationDeps {
  const logger = createCapturingLogger();
  const publisher = createEventPublisher({
    db,
    deliveries: createWebhookDeliveryScheduler(createRecordingQueue()),
    logger,
  });
  let pending = inTransaction;
  const events: TransactionalEventPublisher = {
    publish: (input) => publisher.publish(input),
    stage: async (tx, input) => {
      const hook = pending;
      pending = undefined;
      await hook?.();
      return publisher.stage(tx, input);
    },
    dispatch: (staged) => publisher.dispatch(staged),
  };
  return { db, storage, keyring, vision, events, clock: { now: () => NOW }, logger };
}

function goldenVision(): VisionClient {
  const fake = createFakeVision();
  fake.answers.selfie = threePoseAnalysis();
  return fake.client;
}

/** Whether `promise` settles within {@link WAIT_MS}. */
async function settlesWithin(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  const watched = promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await Promise.race([watched, new Promise((resolve) => setTimeout(resolve, WAIT_MS))]);
  return settled;
}

async function faceRows(verificationId: string) {
  const templates = await db
    .select({ id: faceTemplates.id })
    .from(faceTemplates)
    .where(eq(faceTemplates.verificationId, verificationId));
  const backgrounds = await db
    .select({ id: selfieBackgrounds.id })
    .from(selfieBackgrounds)
    .where(eq(selfieBackgrounds.verificationId, verificationId));
  return { templates: templates.length, backgrounds: backgrounds.length };
}

/** Runs `during` while a raw client holds the inquiry row lock with `statements` applied. */
async function holdingInquiry<T>(
  inquiryId: string,
  statements: readonly [string, unknown[]][],
  during: () => Promise<T>,
): Promise<{ outcome: unknown; waited: boolean }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM inquiries WHERE id = $1 FOR UPDATE', [inquiryId]);
    for (const [text, values] of statements) {
      await client.query(text, values);
    }
    const running = during().then(
      (value: unknown) => value,
      (error: unknown) => error,
    );
    const waited = !(await settlesWithin(running));
    await client.query('COMMIT');
    return { outcome: await running, waited };
  } finally {
    client.release();
  }
}

describe('the template write (C42.2, C45.3)', () => {
  it('stores a template for a passed verification with matching consent, and none without it', async () => {
    const consented = await submittedSelfie();
    const declined = await submittedSelfie({ matching: false });

    for (const { verificationId } of [consented, declined]) {
      expect(await processVerification({ environmentId, verificationId }, jobDeps())).toMatchObject(
        {
          verificationStatus: 'passed',
        },
      );
    }

    expect(await faceRows(consented.verificationId)).toEqual({ templates: 1, backgrounds: 1 });
    expect(await faceRows(declined.verificationId)).toEqual({ templates: 0, backgrounds: 0 });
  });
});

describe('the decision write and a redaction (C40.6)', () => {
  it('a redaction during the write waits for its commit, then removes the face data and the device', async () => {
    const { inquiryId, verificationId, captureId } = await submittedSelfie();
    let redaction: Promise<unknown> | undefined;
    let redactionWaited = false;

    await processVerification(
      { environmentId, verificationId },
      jobDeps(async () => {
        redaction = redactInquiryRecords(db, environmentId, inquiryId, { at: NOW });
        redactionWaited = !(await settlesWithin(redaction));
      }),
    );
    await redaction;

    expect(redactionWaited).toBe(true);
    expect((await getVerification(db, environmentId, verificationId))?.status).toBe('passed');
    expect(await faceRows(verificationId)).toEqual({ templates: 0, backgrounds: 0 });
    expect(await getSelfieCapture(db, environmentId, captureId)).toMatchObject({
      status: 'processed',
      hasDevice: false,
      redactedAt: NOW,
    });
  });

  it('a write after a redaction waits for its commit, then writes nothing; the failure path then errors the capture', async () => {
    const { inquiryId, verificationId, captureId } = await submittedSelfie();

    const { outcome, waited } = await holdingInquiry(
      inquiryId,
      [
        ['UPDATE inquiries SET redacted_at = $2 WHERE id = $1', [inquiryId, NOW]],
        ['UPDATE selfie_captures SET device = NULL WHERE inquiry_id = $1', [inquiryId]],
      ],
      () => processVerification({ environmentId, verificationId }, jobDeps()),
    );

    expect(waited).toBe(true);
    expect(outcome).toMatchObject({ name: 'PermanentJobError', reason: 'inquiry_redacted' });
    expect(await faceRows(verificationId)).toEqual({ templates: 0, backgrounds: 0 });
    expect(await getSelfieCapture(db, environmentId, captureId)).toMatchObject({
      status: 'submitted',
      hasDevice: false,
    });

    expect(
      await failVerificationAfterError(
        { environmentId, verificationId },
        jobDeps(),
        'inquiry_redacted',
      ),
    ).toMatchObject({ outcome: 'failed' });
    expect(await getSelfieCapture(db, environmentId, captureId)).toMatchObject({
      status: 'errored',
      errorCode: 'processing_failed',
      hasDevice: false,
    });
  });
});

describe('the decision write and a decline (C42.2)', () => {
  it('a decline that commits while the write waits leaves no template', async () => {
    const { inquiryId, verificationId } = await submittedSelfie();

    const { waited } = await holdingInquiry(
      inquiryId,
      [["UPDATE inquiries SET status = 'declined' WHERE id = $1", [inquiryId]]],
      // The analysis runs; only the write waits for the inquiry lock.
      () => processVerification({ environmentId, verificationId }, jobDeps()),
    );

    expect(waited).toBe(true);
    expect((await getVerification(db, environmentId, verificationId))?.status).toBe('passed');
    expect(await faceRows(verificationId)).toEqual({ templates: 0, backgrounds: 0 });
  });
});

describe("failVerificationAfterError's capture update and a redaction (C40.6)", () => {
  it('waits for a redaction holding the inquiry, then fails the verification and errors the capture', async () => {
    const { inquiryId, verificationId, captureId } = await submittedSelfie();

    const { outcome, waited } = await holdingInquiry(
      inquiryId,
      [
        ['UPDATE inquiries SET redacted_at = $2 WHERE id = $1', [inquiryId, NOW]],
        ['UPDATE selfie_captures SET device = NULL WHERE inquiry_id = $1', [inquiryId]],
      ],
      () => failVerificationAfterError({ environmentId, verificationId }, jobDeps(), 'Error'),
    );

    expect(waited).toBe(true);
    expect(outcome).toMatchObject({ outcome: 'failed' });
    expect(await getSelfieCapture(db, environmentId, captureId)).toMatchObject({
      status: 'errored',
      errorCode: 'processing_failed',
      hasDevice: false,
    });
  });

  it('holds the inquiry while it writes, so a redaction waits for its commit', async () => {
    const { inquiryId, verificationId, captureId } = await submittedSelfie();
    let redaction: Promise<unknown> | undefined;
    let redactionWaited = false;

    await failVerificationAfterError(
      { environmentId, verificationId },
      jobDeps(async () => {
        redaction = redactInquiryRecords(db, environmentId, inquiryId, { at: NOW });
        redactionWaited = !(await settlesWithin(redaction));
      }),
      'Error',
    );
    await redaction;

    expect(redactionWaited).toBe(true);
    expect(await getSelfieCapture(db, environmentId, captureId)).toMatchObject({
      status: 'errored',
      hasDevice: false,
      redactedAt: NOW,
    });
  });
});

describe('the retention deletion and the rebuild (C42.6, C42.7)', () => {
  /** A processed selfie with its template and background row, created `daysAgo` days ago. */
  async function storedTemplate(daysAgo: number) {
    const selfie = await submittedSelfie();
    await processVerification(
      { environmentId: environmentId, verificationId: selfie.verificationId },
      jobDeps(),
    );
    const at = new Date(Date.now() - daysAgo * 86_400_000);
    await db
      .update(faceTemplates)
      .set({ createdAt: at })
      .where(eq(faceTemplates.verificationId, selfie.verificationId));
    expect(await faceRows(selfie.verificationId)).toEqual({ templates: 1, backgrounds: 1 });
    return selfie;
  }

  it('the retention deletion waits for a writer holding the inquiry, then deletes', async () => {
    const { inquiryId, verificationId } = await storedTemplate(400);

    const { outcome, waited } = await holdingInquiry(inquiryId, [], () =>
      deleteExpiredFaceData(db, { limit: 10_000 }),
    );

    expect(waited).toBe(true);
    expect(outcome).toMatchObject({ templates: expect.any(Number) as number });
    expect(await faceRows(verificationId)).toEqual({ templates: 0, backgrounds: 0 });
  });

  /** A vision client whose re-embedding runs `meanwhile` first, as a concurrent writer would. */
  function visionDuring(meanwhile: () => Promise<unknown>): VisionClient {
    const golden = goldenVision();
    let ran = false;
    return {
      ...golden,
      embedFace: async (input) => {
        if (!ran) {
          ran = true;
          await meanwhile();
        }
        return golden.embedFace(input);
      },
    };
  }

  it('a rebuild whose row a redaction removed meanwhile creates nothing', async () => {
    const { inquiryId, verificationId } = await storedTemplate(1);

    const report = await rebuildFaceIndex(
      {
        db,
        storage,
        keyring,
        vision: visionDuring(() => redactInquiryRecords(db, environmentId, inquiryId, { at: NOW })),
      },
      { dryRun: false, batchSize: 1000 },
    );

    expect(report.failed).toBe(0);
    expect(await faceRows(verificationId)).toEqual({ templates: 0, backgrounds: 0 });
  });

  it('a rebuild whose row the retention deletion removed meanwhile creates nothing', async () => {
    const { verificationId } = await storedTemplate(500);

    await rebuildFaceIndex(
      {
        db,
        storage,
        keyring,
        vision: visionDuring(() => deleteExpiredFaceData(db, { limit: 10_000 })),
      },
      { dryRun: false, batchSize: 1000 },
    );

    expect(await faceRows(verificationId)).toEqual({ templates: 0, backgrounds: 0 });
  });

  it('a rebuild row transaction waits for a redaction holding the inquiry, then deletes the row', async () => {
    const { inquiryId, verificationId } = await storedTemplate(2);

    const { outcome, waited } = await holdingInquiry(
      inquiryId,
      [['UPDATE inquiries SET redacted_at = $2 WHERE id = $1', [inquiryId, NOW]]],
      () =>
        rebuildFaceIndex(
          { db, storage, keyring, vision: goldenVision() },
          { dryRun: false, batchSize: 1000 },
        ),
    );

    expect(waited).toBe(true);
    expect(outcome).toMatchObject({ failed: 0 });
    expect(await faceRows(verificationId)).toEqual({ templates: 0, backgrounds: 0 });
  });
});
