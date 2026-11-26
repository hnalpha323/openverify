/**
 * C59.6, C53.6, C40.6 against Postgres 17 row locks (Testcontainers), for the AAMVA writers, in the
 * pattern of `selfie-race.integration.test.ts`:
 * - the silent attempt's creation (the copy of the ID's values) runs in the government ID's
 *   decision transaction, after its extraction is written: a redaction that starts during that
 *   write waits for its commit, then nulls the extraction and the copied values together; a
 *   decision after a redaction writes neither;
 * - the AAMVA skip takes the inquiry lock and re-checks `redacted_at` first: it waits for a
 *   redaction, then skips nothing; two jobs of one verification skip it once.
 * Vision answers are the synthetic golden barcode fixture; every value is synthetic.
 */
import { createHash, randomBytes } from 'node:crypto';
import { eventPayloadSchema, newId } from '@openverify/contracts';
import { defaultTemplateConfig } from '@openverify/core';
import {
  createDatabase,
  createFile,
  createKeyring,
  createVerification,
  encryptBytes,
  getGovernmentIdExtraction,
  getVerification,
  getVerificationInputs,
  listEvents,
  listInquiryVerifications,
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
  seedVerificationInputs,
  startIntegrationPostgres,
  ifSet,
} from '@openverify/db/testing';
import { flowSchema } from '@openverify/flow-spec';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEventPublisher, type TransactionalEventPublisher } from '../events/index.js';
import type { GovernmentIdAnalysis, ProcessVerificationJob } from '../ports.js';
import { createSandboxAamvaProvider } from '../providers/sandbox.js';
import { createWebhookDeliveryScheduler } from '../webhooks/queue.js';
import { processVerification, type ProcessVerificationDeps } from './process-verification.js';
import {
  createCapturingLogger,
  createFakeVision,
  createMemoryStorage,
  createRecordingQueue,
  visionFixture,
} from './testing.js';

const NOW = new Date('2026-10-23T12:00:00.000Z');
const keyring = createKeyring(randomBytes(32));
/** Long enough for a statement that takes no lock to finish first. */
const WAIT_MS = 1_500;

const flowOf = (aamva: 'government_id' | 'form') =>
  flowSchema.parse({
    metadata: { specVersion: 1, id: 'aamva-races', version: 1, name: 'AAMVA races' },
    steps: [
      { id: 'consent', type: 'consent', textKeys: ['consent.processing'], required: true },
      {
        id: 'government_id',
        type: 'government_id',
        sides: 'front',
        maxAttempts: 2,
        captureMethods: ['upload'],
      },
      { id: 'aamva', type: 'aamva', source: aamva },
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

/** A pending inquiry of the silent (or form) AAMVA flow. */
async function pendingInquiry(aamva: 'government_id' | 'form' = 'government_id') {
  const { inquiry } = await createTestInquiry(db, environmentId, {
    flow: flowOf(aamva),
    verificationConfig: {
      // Only the synthetic card's printed expiry is judged, which it passes.
      'government-id': { checks: { id_expired_detection: { enabled: true, required: true } } },
      aamva: defaultTemplateConfig('aamva'),
    },
  });
  await transitionInquiryStatus(db, environmentId, inquiry.id, { from: 'created', to: 'pending' });
  return inquiry.id;
}

/** A submitted government ID verification with a sealed synthetic front. */
async function submittedId(inquiryId: string): Promise<string> {
  const id = newId('ver');
  await createVerification(db, environmentId, { id, inquiryId, type: 'government_id' });
  const fileId = newId('file');
  const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...randomBytes(48)]);
  const sealed = encryptBytes(bytes, keyring, { context: fileId });
  await storage.put(`${environmentId}/${fileId}`, sealed.ciphertext);
  await createFile(db, environmentId, {
    id: fileId,
    verificationId: id,
    kind: 'front',
    storageKey: `${environmentId}/${fileId}`,
    mimeType: 'image/jpeg',
    byteSize: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    wrappedDek: sealed.wrappedDek,
  });
  await setVerificationStatus(db, environmentId, id, { to: 'submitted' });
  return id;
}

/**
 * The job's dependencies. `inTransaction` runs once, inside the writer's transaction, when it
 * stages its first event (for an ID decision: after the extraction, before the AAMVA attempt).
 */
function jobDeps(inTransaction?: () => Promise<void>) {
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
  vision.answers.governmentId = visionFixture(
    'analyze-government-id-barcode' as 'analyze-government-id',
  ) as GovernmentIdAnalysis;
  const enqueued: ProcessVerificationJob[] = [];
  const deps: ProcessVerificationDeps = {
    db,
    storage,
    keyring,
    vision: vision.client,
    events,
    clock: { now: () => NOW },
    logger,
    providers: { sandbox: { aamva: createSandboxAamvaProvider() }, production: {} },
    queue: {
      enqueueProcessVerification: (job) => {
        enqueued.push(job);
        return Promise.resolve();
      },
    },
  };
  return { deps, enqueued };
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

const aamvaAttempts = async (inquiryId: string) =>
  (await listInquiryVerifications(db, environmentId, inquiryId)).filter(
    (verification) => verification.type === 'aamva',
  );

describe('C59.6: the silent attempt in the ID decision, and a redaction (C53.6, C40.6)', () => {
  it('copies the licence in the decision transaction; a redaction that starts then waits and nulls both', async () => {
    const inquiryId = await pendingInquiry();
    const governmentId = await submittedId(inquiryId);
    let redaction: Promise<unknown> | undefined;
    let redactionWaited = false;
    const { deps, enqueued } = jobDeps(async () => {
      redaction = redactInquiryRecords(db, environmentId, inquiryId, { at: NOW });
      redactionWaited = !(await settlesWithin(redaction));
    });

    await processVerification({ environmentId, verificationId: governmentId }, deps);
    await redaction;

    expect(redactionWaited).toBe(true);
    const [attempt] = await aamvaAttempts(inquiryId);
    expect(attempt?.status).toBe('submitted');
    expect(enqueued).toEqual([{ environmentId, verificationId: attempt?.id }]);
    expect(await getGovernmentIdExtraction(db, environmentId, governmentId)).toMatchObject({
      fields: null,
    });
    expect(await getVerificationInputs(db, environmentId, attempt?.id ?? '')).toMatchObject({
      values: null,
      source: 'government_id',
      sourceVerificationId: governmentId,
      redactedAt: NOW,
    });
  });

  it('a decision after a redaction waits for it, then writes neither the extraction nor an attempt', async () => {
    const inquiryId = await pendingInquiry();
    const governmentId = await submittedId(inquiryId);

    const { outcome, waited } = await holdingInquiry(
      inquiryId,
      [['UPDATE inquiries SET redacted_at = $2 WHERE id = $1', [inquiryId, NOW]]],
      () => processVerification({ environmentId, verificationId: governmentId }, jobDeps().deps),
    );

    expect(waited).toBe(true);
    expect(outcome).toMatchObject({ name: 'PermanentJobError', reason: 'inquiry_redacted' });
    expect(await getGovernmentIdExtraction(db, environmentId, governmentId)).toBeNull();
    expect(await aamvaAttempts(inquiryId)).toEqual([]);
  });
});

describe('C50.7: the AAMVA skip (C40.6)', () => {
  /** A submitted silent attempt of a jurisdiction outside DLDV (the sandbox's 5555). */
  async function nonParticipating() {
    const inquiryId = await pendingInquiry();
    const governmentId = newId('ver');
    await createVerification(db, environmentId, {
      id: governmentId,
      inquiryId,
      type: 'government_id',
    });
    await setVerificationStatus(db, environmentId, governmentId, { to: 'submitted' });
    await setVerificationStatus(db, environmentId, governmentId, { to: 'passed' });
    const id = newId('ver');
    await createVerification(db, environmentId, { id, inquiryId, type: 'aamva' });
    await seedVerificationInputs(db, environmentId, {
      verificationId: id,
      inquiryId,
      values: {
        'name-first': 'Avery',
        'name-last': 'Example',
        birthdate: '1990-04-12',
        'identification-number': 'D1235555',
        'issuing-authority': 'CA',
      },
      source: 'government_id',
      sourceVerificationId: governmentId,
    });
    await setVerificationStatus(db, environmentId, id, { to: 'submitted' });
    return { inquiryId, id };
  }

  it('waits for a redaction, then skips nothing', async () => {
    const { inquiryId, id } = await nonParticipating();

    const { outcome, waited } = await holdingInquiry(
      inquiryId,
      [['UPDATE inquiries SET redacted_at = $2 WHERE id = $1', [inquiryId, NOW]]],
      () => processVerification({ environmentId, verificationId: id }, jobDeps().deps),
    );

    expect(waited).toBe(true);
    expect(outcome).toMatchObject({ name: 'PermanentJobError', reason: 'inquiry_redacted' });
    expect((await getVerification(db, environmentId, id))?.status).toBe('submitted');
  });

  it('two jobs of one verification skip it once, with one verification.skipped', async () => {
    const { id } = await nonParticipating();

    const outcomes = await Promise.allSettled([
      processVerification({ environmentId, verificationId: id }, jobDeps().deps),
      processVerification({ environmentId, verificationId: id }, jobDeps().deps),
    ]);

    expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled']);
    expect((await getVerification(db, environmentId, id))?.status).toBe('skipped');
    const page = await listEvents(db, environmentId, { size: 100 });
    const skipped = page.items.filter(
      (event) =>
        event.name === 'verification.skipped' &&
        eventPayloadSchema.parse(event.payload).data.id === id,
    );
    expect(skipped).toHaveLength(1);
  });
});
