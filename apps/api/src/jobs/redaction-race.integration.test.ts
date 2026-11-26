/**
 * Workflow 3B review G002 against Postgres 17 row locks (Testcontainers): a government ID job and
 * a C16 redaction of its inquiry, at the same time. The job writes its results, the C31.7
 * extraction and its `verification.*` event in one transaction that first locks the inquiry, as
 * the redaction does, so the two are serialized whichever comes first:
 * - the job's transaction first: the redaction waits for its commit, then redacts the extraction
 *   it wrote and stubs its event;
 * - the redaction first: the job waits for its commit, then writes nothing and fails for good
 *   (`inquiry_redacted`), so the worker fails the verification without data.
 * Vision answers are the recorded C32 golden fixtures; every value is synthetic.
 */
import { createHash, randomBytes } from 'node:crypto';
import { defaultInquiryTemplateAttributes, newId } from '@openverify/contracts';
import {
  createDatabase,
  createFile,
  createKeyring,
  createVerification,
  encryptBytes,
  getGovernmentIdExtraction,
  getVerification,
  listEvents,
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
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createEventPublisher, type TransactionalEventPublisher } from '../events/index.js';
import type { GovernmentIdAnalysis } from '../ports.js';
import { createWebhookDeliveryScheduler } from '../webhooks/queue.js';
import { processVerification, type ProcessVerificationDeps } from './process-verification.js';
import {
  createCapturingLogger,
  createFakeVision,
  createMemoryStorage,
  createRecordingQueue,
  governmentIdFixture,
} from './testing.js';

const NOW = new Date('2026-10-20T12:00:00.000Z');
const keyring = createKeyring(randomBytes(32));
const defaults = defaultInquiryTemplateAttributes();
/** A public test key (bytes 0x00..0x1f), never a deployment's. */
const BLIND_INDEX_KEY = Uint8Array.from({ length: 32 }, (_, index) => index);
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

/**
 * A pending inquiry with a submitted government ID, of the default flow with only
 * `id_blur_detection` required, so the card below passes and its event is staged.
 */
async function submittedGovernmentId(): Promise<{ inquiryId: string; verificationId: string }> {
  const { inquiry } = await createTestInquiry(db, environmentId, {
    flow: defaults.flow,
    verificationConfig: {
      'government-id': { checks: { id_blur_detection: { enabled: true, required: true } } },
      selfie: defaults['verification-config'].selfie,
    },
  });
  await transitionInquiryStatus(db, environmentId, inquiry.id, { from: 'created', to: 'pending' });
  const verificationId = newId('ver');
  await createVerification(db, environmentId, {
    id: verificationId,
    inquiryId: inquiry.id,
    type: 'government_id',
  });
  for (const kind of ['front', 'back'] as const) {
    const id = newId('file');
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...randomBytes(48)]);
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
      sha256: createHash('sha256').update(bytes).digest('hex'),
      wrappedDek: sealed.wrappedDek,
    });
  }
  await setVerificationStatus(db, environmentId, verificationId, { to: 'submitted' });
  return { inquiryId: inquiry.id, verificationId };
}

/**
 * The golden card with no MRZ and no class keyword: the visual zone still gives an extraction,
 * but no class or country is established, so the job's transaction writes the verification row
 * once only. (A second write of that row in the transaction, as filling an established class
 * does, makes Postgres check its inquiry foreign key, which locks the inquiry row `FOR KEY SHARE`
 * by chance; this card shows the order without that.)
 */
function unclassifiedCard(): GovernmentIdAnalysis {
  const analysis = governmentIdFixture();
  const back = analysis.sides.back;
  if (back === null) {
    throw new Error('the golden fixture has a back');
  }
  back.mrz = { found: false, format_guess: null, lines: [], line_confidences: [], box: null };
  analysis.sides.front.text = analysis.sides.front.text.filter(
    (line) => line.text !== 'IDENTITY CARD',
  );
  return analysis;
}

/**
 * The job's dependencies. `inTransaction` runs once, inside the job's write transaction, when it
 * stages its first event (the `verification.*` event, after the checks and the extraction).
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
  vision.answers.governmentId = unclassifiedCard();
  return {
    db,
    storage,
    keyring,
    vision: vision.client,
    events,
    clock: { now: () => NOW },
    logger,
    blindIndexKey: BLIND_INDEX_KEY,
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

/** A stored event payload: a resource, or the C16 stub of one. */
const storedPayloadSchema = z.object({
  data: z.object({ id: z.string(), attributes: z.record(z.string(), z.unknown()) }),
});

/** The stored payloads of the events about the verification, whole or stubbed. */
async function payloadsAbout(verificationId: string) {
  return (await listEvents(db, environmentId, { size: 100 })).items
    .map((event) => storedPayloadSchema.parse(event.payload))
    .filter((payload) => payload.data.id === verificationId);
}

describe('G002: a government ID job and a redaction of its inquiry', () => {
  it('a redaction during the write waits for its commit, then redacts the extraction and the event', async () => {
    const { inquiryId, verificationId } = await submittedGovernmentId();
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

    expect(await getVerification(db, environmentId, verificationId)).toMatchObject({
      status: 'passed',
      country: null,
      idClass: null,
    });
    expect(await getGovernmentIdExtraction(db, environmentId, verificationId)).toMatchObject({
      fields: null,
      identificationNumberIndex: null,
      frontPhash: null,
      redactedAt: NOW,
    });
    expect(redactionWaited).toBe(true);
    const payloads = await payloadsAbout(verificationId);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.data.attributes).toEqual({ 'redacted-at': NOW.toISOString() });
  });

  it('a job whose write follows a redaction waits for its commit, then writes nothing', async () => {
    const { inquiryId, verificationId } = await submittedGovernmentId();
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

    expect(await getGovernmentIdExtraction(db, environmentId, verificationId)).toBeNull();
    expect(await payloadsAbout(verificationId)).toEqual([]);
    expect(outcome).toMatchObject({ name: 'PermanentJobError', reason: 'inquiry_redacted' });
    expect(jobWaited).toBe(true);
  });
});
