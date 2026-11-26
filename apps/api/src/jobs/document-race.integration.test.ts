/**
 * C53.6, C54.1 against Postgres 17 row locks (Testcontainers): the document job's decision
 * transaction, the one writer of `document_extractions` and of the `document-preview` file, locks
 * the inquiry first and re-checks it unredacted, as the C16 redaction locks it, so the two are
 * serialized whichever comes first:
 * - the job first: the redaction waits for its commit, then redacts the extraction it wrote and
 *   lists its preview among the files to delete;
 * - the redaction first: the job waits for its commit, then writes nothing (no extraction, no
 *   preview row) and fails for good (`inquiry_redacted`).
 * Two runs of the job on one verification at once leave one extraction and one preview. Vision
 * answers are the C60.1 golden fixture; every value is synthetic.
 */
import { createHash, randomBytes } from 'node:crypto';
import { newId } from '@openverify/contracts';
import { defaultTemplateConfig } from '@openverify/core';
import {
  createDatabase,
  createFile,
  createKeyring,
  createVerification,
  encryptBytes,
  getDocumentExtraction,
  listVerificationFiles,
  openDocumentExtractionFields,
  redactInquiryRecords,
  runMigrations,
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
import { flowSchema } from '@openverify/flow-spec';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEventPublisher, type TransactionalEventPublisher } from '../events/index.js';
import { createWebhookDeliveryScheduler } from '../webhooks/queue.js';
import { processVerification, type ProcessVerificationDeps } from './process-verification.js';
import {
  createCapturingLogger,
  createFakeVision,
  createMemoryStorage,
  createRecordingQueue,
  documentAnalysisFixture,
} from './testing.js';

const NOW = new Date('2026-10-23T12:00:00.000Z');
const keyring = createKeyring(randomBytes(32));
/** Long enough for a statement that takes no lock to finish first. */
const WAIT_MS = 1_500;

const FLOW = flowSchema.parse({
  metadata: { specVersion: 1, id: 'proof-of-address', version: 1, name: 'Proof of address' },
  steps: [
    { id: 'consent', type: 'consent', textKeys: ['consent.processing'], required: true },
    {
      id: 'proof-of-address',
      type: 'document',
      documentTypes: ['utility_bill'],
      captureMethods: ['upload'],
    },
    { id: 'completion', type: 'completion', messageKey: 'flow.completion' },
  ],
  transitions: [],
});

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

/** A pending inquiry of the holder of the golden bill, with a submitted document verification. */
async function submittedDocument(): Promise<{ inquiryId: string; verificationId: string }> {
  const { inquiry } = await createTestInquiry(db, environmentId, {
    flow: FLOW,
    verificationConfig: { document: defaultTemplateConfig('document') },
    fields: { name_first: 'Quinn', name_last: 'Valemont', address_country_code: 'US' },
  });
  await transitionInquiryStatus(db, environmentId, inquiry.id, { from: 'created', to: 'pending' });
  const verificationId = newId('ver');
  await createVerification(db, environmentId, {
    id: verificationId,
    inquiryId: inquiry.id,
    type: 'document',
  });
  const id = newId('file');
  const bytes = new TextEncoder().encode(`%PDF-1.7\n% synthetic ${id}\n%%EOF\n`);
  const sealed = encryptBytes(bytes, keyring, { context: id });
  const storageKey = `${environmentId}/${id}`;
  await storage.put(storageKey, sealed.ciphertext);
  await createFile(db, environmentId, {
    id,
    verificationId,
    kind: 'document',
    storageKey,
    mimeType: 'application/pdf',
    byteSize: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    wrappedDek: sealed.wrappedDek,
  });
  await setVerificationStatus(db, environmentId, verificationId, { to: 'submitted' });
  return { inquiryId: inquiry.id, verificationId };
}

/**
 * The job's dependencies. `inTransaction` runs once, inside the job's write transaction, when it
 * stages its first event (the `verification.*` event, after the extraction and the preview).
 */
function jobDeps(inTransaction?: () => Promise<void>): ProcessVerificationDeps {
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
  const vision = createFakeVision();
  vision.answers.analyzeDocument = documentAnalysisFixture();
  return {
    db,
    storage,
    keyring,
    vision: vision.client,
    events,
    clock: { now: () => NOW },
    logger,
  };
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

const previewsOf = async (verificationId: string) =>
  (await listVerificationFiles(db, environmentId, [verificationId])).filter(
    (file) => file.kind === 'document-preview',
  );

describe('the document job and a redaction of its inquiry (C53.6)', () => {
  it('a redaction during the write waits for its commit, then redacts the extraction and takes the preview', async () => {
    const { inquiryId, verificationId } = await submittedDocument();
    let redaction: ReturnType<typeof redactInquiryRecords> | undefined;
    let redactionWaited = false;

    await processVerification(
      { environmentId, verificationId },
      jobDeps(async () => {
        redaction = redactInquiryRecords(db, environmentId, inquiryId, { at: NOW });
        redactionWaited = !(await settlesWithin(redaction));
      }),
    );
    const redacted = await redaction;

    expect(redactionWaited).toBe(true);
    expect(await getDocumentExtraction(db, environmentId, verificationId)).toMatchObject({
      documentType: 'utility_bill',
      redactedAt: NOW,
    });
    expect(await openDocumentExtractionFields(db, environmentId, verificationId)).toBeNull();
    const [preview] = await previewsOf(verificationId);
    expect(preview).toBeDefined();
    expect(redacted?.files.map((file) => file.id)).toContain(preview?.id);
  });

  it('a job whose write follows a redaction waits for its commit, then writes nothing', async () => {
    const { inquiryId, verificationId } = await submittedDocument();
    const client = await pool.connect();
    let outcome: unknown;
    let jobWaited: boolean;
    try {
      await client.query('BEGIN');
      // As `redactInquiryRecords` does first: lock the inquiry and stamp it.
      await client.query('SELECT id FROM inquiries WHERE id = $1 FOR UPDATE', [inquiryId]);
      await client.query('UPDATE inquiries SET redacted_at = $2 WHERE id = $1', [inquiryId, NOW]);
      const job = processVerification({ environmentId, verificationId }, jobDeps()).then(
        (value: unknown) => value,
        (error: unknown) => error,
      );
      jobWaited = !(await settlesWithin(job));
      await client.query('COMMIT');
      outcome = await job;
    } finally {
      client.release();
    }

    expect(jobWaited).toBe(true);
    expect(outcome).toMatchObject({ name: 'PermanentJobError', reason: 'inquiry_redacted' });
    expect(await getDocumentExtraction(db, environmentId, verificationId)).toBeNull();
    expect(await previewsOf(verificationId)).toEqual([]);
  });
});

describe('two runs of the document job at once (C54.1)', () => {
  it('one decides; the other finds it decided and writes nothing: one extraction, one preview', async () => {
    const { verificationId } = await submittedDocument();

    const outcomes = await Promise.all([
      processVerification({ environmentId, verificationId }, jobDeps()),
      processVerification({ environmentId, verificationId }, jobDeps()),
    ]);

    expect(outcomes.map((outcome) => outcome.outcome).sort()).toEqual(['processed', 'skipped']);
    expect(await getDocumentExtraction(db, environmentId, verificationId)).toMatchObject({
      documentType: 'utility_bill',
    });
    expect(await previewsOf(verificationId)).toHaveLength(1);
  });
});
