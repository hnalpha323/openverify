/**
 * C53.6, C40.6 against Postgres 17 row locks (Testcontainers), `api-nfc`: every writer of a chip
 * challenge or a chip read runs in one transaction that locks the inquiry (its status and
 * `redacted_at` re-checked), then the verification, then the challenge. Each test holds the
 * competing writer's locks in a transaction of its own connection, as a concurrent request, job,
 * expiry or redaction would, and runs the writer:
 * - the challenge create and its cap cancel wait for a redaction, then write nothing (410);
 * - a create waits for a submit and is refused (409); a submit waits for a create that
 *   superseded its challenge (409 `chip_challenge_invalid`); two creates serialize;
 * - a submit waits for a redaction (410) and for the inquiry's expiry, whose cancel hook
 *   superseded the challenge (409), consuming nothing;
 * - the job's decision waits for a redaction and writes no chip read; its processing-failure
 *   update waits for one and then processes the challenge; a redaction waits for a decision and
 *   then clears the read it wrote;
 * - the chip read index rebuild waits for a redaction of the row and leaves it unindexed.
 * Every chip, key and face is synthetic.
 */
import { createHash, randomBytes } from 'node:crypto';
import { CHIP_CHALLENGE_LIMIT, newId } from '@openverify/contracts';
import {
  createDatabase,
  createFile,
  createInquiry,
  createInquirySession,
  createInquiryTemplate,
  createKeyring,
  createVerification,
  encryptBytes,
  getChipChallenge,
  getChipRead,
  getVerification,
  hashSessionToken,
  listChipChallenges,
  openChipChallengeSubmission,
  openChipReadEvidence,
  rebuildChipReadIndexes,
  recordInquirySessionConsent,
  redactInquiryRecords,
  runMigrations,
  setDefaultKeyring,
  transitionInquiryStatus,
  type Database,
  type FileKind,
} from '@openverify/db';
import { createIntegrationPool, createTestTenant, startIntegrationPostgres, ifSet } from '@openverify/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FlowSession } from '../../auth/flow-session.js';
import { ConflictError, Phase5ProblemError, RedactedError } from '../../errors.js';
import { createEventPublisher, type TransactionalEventPublisher } from '../../events/index.js';
import { PermanentJobError } from '../../jobs/errors.js';
import {
  failVerificationAfterError,
  processVerification,
  type ProcessVerificationDeps,
} from '../../jobs/process-verification.js';
import {
  createCapturingLogger,
  createFakeVision,
  createMemoryStorage,
  createRecordingQueue as createRecordingJobQueue,
} from '../../jobs/testing.js';
import { ulidIdGenerator } from '../../ports.js';
import { createInMemoryFileStorage } from '../../storage/index.js';
import {
  createAllowAllRateLimiter,
  createCapturingMailer,
  createRecordingAuditLogger,
  createRecordingEventPublisher,
  createRecordingQueue,
  createRecordingRedactionService,
  fixedClock,
  phase5TestDependencies,
} from '../../test-support/fakes.js';
import { installSandboxTrustAnchor } from '../../trust-anchors/sandbox.js';
import { createWebhookDeliveryScheduler } from '../../webhooks/queue.js';
import { createAccountsService } from '../accounts.js';
import type { ApiDependencies } from '../context.js';
import { submitVerification } from '../flow.js';
import { createFlowChipChallenge } from './create.js';
import { chipUploads, nfcTemplateAttributes, seedNfcInquiry, testChip } from './testing.js';

const keyring = createKeyring(randomBytes(32));
/** Long enough for a writer that takes no lock to finish first. */
const WAIT_MS = 1_500;
const KEY = new Uint8Array(32).fill(0x5b);

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
let deps: ApiDependencies;
let environmentId: string;
let templateId: string;
let versionId: string;
const jobStorage = createMemoryStorage();

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 10 });
  db = createDatabase(pool);
  await runMigrations(db);
  setDefaultKeyring(keyring);
  const clock = fixedClock(new Date());
  const events = createRecordingEventPublisher();
  deps = {
    db,
    keyring,
    storage: createInMemoryFileStorage(),
    events,
    queue: createRecordingQueue(),
    clock,
    ids: ulidIdGenerator,
    flowPublicUrl: 'https://flow.example.test',
    flowCorsOrigins: ['https://flow.example.test'],
    accounts: createAccountsService({ events }),
    redaction: createRecordingRedactionService(clock),
    audit: createRecordingAuditLogger(),
    rateLimiter: createAllowAllRateLimiter(clock),
    mailer: createCapturingMailer(),
    ...phase5TestDependencies(clock),
  };
  environmentId = (await createTestTenant(db, { organizationName: 'Chip Race Org' })).environment
    .id;
  const attributes = nfcTemplateAttributes();
  const template = await createInquiryTemplate(db, environmentId, {
    id: newId('itmpl'),
    name: 'Chip races',
    version: {
      id: newId('itmplv'),
      flow: attributes.flow,
      verificationConfig: attributes['verification-config'],
    },
  });
  templateId = template.id;
  versionId = template.currentVersion.id;
  await installSandboxTrustAnchor(db, { now: new Date() });
}, 180_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(pool)?.end();
  await container?.stop();
});

interface ChipFlow {
  session: FlowSession;
  verificationId: string;
}

/** A pending inquiry whose session consented, with an `initiated` NFC verification and its files. */
async function consentedChip(): Promise<ChipFlow> {
  const inquiry = await createInquiry(db, environmentId, {
    id: newId('inq'),
    inquiryTemplateId: templateId,
    inquiryTemplateVersionId: versionId,
  });
  await transitionInquiryStatus(db, environmentId, inquiry.id, { from: 'created', to: 'pending' });
  const session = await createInquirySession(db, environmentId, {
    id: newId('iqse'),
    inquiryId: inquiry.id,
    tokenHash: hashSessionToken(`ovs_${randomBytes(16).toString('hex')}`),
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  await recordInquirySessionConsent(db, environmentId, session.id, {
    acceptedAt: new Date(),
    textKeys: ['consent.biometric', 'consent.processing'],
    optionalTextKeys: [],
    locale: 'en',
    ip: null,
    userAgent: null,
  });
  const verificationId = newId('ver');
  await createVerification(db, environmentId, {
    id: verificationId,
    inquiryId: inquiry.id,
    type: 'government_id_nfc',
  });
  for (const [kind, bytes] of chipUploads(testChip({ now: new Date(), seed: 'races/flow' }))) {
    const id = newId('file');
    const sealed = encryptBytes(bytes, keyring, { context: id });
    const storageKey = `${environmentId}/${id}`;
    await deps.storage.put(storageKey, sealed.ciphertext);
    await createFile(db, environmentId, {
      id,
      verificationId,
      kind: kind as FileKind,
      storageKey,
      mimeType: 'application/octet-stream',
      byteSize: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      wrappedDek: sealed.wrappedDek,
    });
  }
  return { session: { id: session.id, environmentId, inquiryId: inquiry.id }, verificationId };
}

const create = (flow: ChipFlow) => createFlowChipChallenge(deps, flow.session, flow.verificationId);

const submit = (flow: ChipFlow, challenge: { id: string; nonce: string }) =>
  submitVerification(deps, flow.session, flow.verificationId, {
    chip: { 'challenge-id': challenge.id, nonce: challenge.nonce },
  });

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

/**
 * Runs `statements` in a transaction of its own connection (the competing writer, holding the
 * inquiry's row lock first) and keeps it open while `writer` starts, then commits. Resolves with
 * whether `writer` waited for the commit, and its outcome (a value or the error it threw).
 */
async function whileHeld(
  inquiryId: string,
  statements: readonly [string, unknown[]][],
  writer: () => Promise<unknown>,
): Promise<{ waited: boolean; outcome: unknown }> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM inquiries WHERE id = $1 FOR UPDATE', [inquiryId]);
    for (const [text, values] of statements) {
      await client.query(text, values);
    }
    const running = writer().then(
      (value: unknown) => value,
      (error: unknown) => error,
    );
    const waited = !(await settlesWithin(running));
    await client.query('COMMIT');
    return { waited, outcome: await running };
  } finally {
    client.release();
  }
}

/** As a redaction does first (C16, G002): stamp the inquiry and clear its chip rows. */
const redaction = (inquiryId: string): [string, unknown[]][] => [
  ['UPDATE inquiries SET redacted_at = now() WHERE id = $1', [inquiryId]],
  [
    `UPDATE chip_challenges SET aa_response = NULL, device_report = NULL, redacted_at = now()
       WHERE inquiry_id = $1`,
    [inquiryId],
  ],
  [
    `UPDATE chip_reads SET fields = NULL, sod_signature = NULL, sod_signature_index = NULL,
       document_number_index = NULL, issuing_country = NULL, redacted_at = now()
       WHERE inquiry_id = $1`,
    [inquiryId],
  ],
];

const challengesOf = (flow: ChipFlow) => listChipChallenges(db, environmentId, flow.verificationId);

const statusOf = async (verificationId: string) =>
  (await getVerification(db, environmentId, verificationId))?.status;

describe('C53.6: the challenge writers and a redaction of the inquiry', () => {
  it('a create waits for the redaction, then refuses (410) and writes no challenge', async () => {
    const flow = await consentedChip();

    const { waited, outcome } = await whileHeld(
      flow.session.inquiryId,
      redaction(flow.session.inquiryId),
      () => create(flow),
    );

    expect(waited).toBe(true);
    expect(outcome).toBeInstanceOf(RedactedError);
    expect(await challengesOf(flow)).toEqual([]);
  });

  it('the cap cancel waits for the redaction, then refuses (410), canceling nothing', async () => {
    const flow = await consentedChip();
    for (let index = 0; index < CHIP_CHALLENGE_LIMIT; index += 1) {
      await create(flow);
    }

    const { waited, outcome } = await whileHeld(
      flow.session.inquiryId,
      [['UPDATE inquiries SET redacted_at = now() WHERE id = $1', [flow.session.inquiryId]]],
      () => create(flow),
    );

    expect(waited).toBe(true);
    expect(outcome).toBeInstanceOf(RedactedError);
    expect(await statusOf(flow.verificationId)).toBe('initiated');
    const challenges = await challengesOf(flow);
    expect(challenges).toHaveLength(CHIP_CHALLENGE_LIMIT);
    expect(challenges[0]?.status).toBe('initiated');
  });

  it('a submit waits for the redaction, then refuses (410), consuming nothing', async () => {
    const flow = await consentedChip();
    const challenge = await create(flow);

    const { waited, outcome } = await whileHeld(
      flow.session.inquiryId,
      redaction(flow.session.inquiryId),
      () => submit(flow, challenge),
    );

    expect(waited).toBe(true);
    expect(outcome).toBeInstanceOf(RedactedError);
    expect(await getChipChallenge(db, environmentId, challenge.id)).toMatchObject({
      status: 'initiated',
      submittedAt: null,
    });
    expect(await statusOf(flow.verificationId)).toBe('initiated');
  });
});

describe('C40.6: the challenge writers against each other', () => {
  it('a create waits for a submit that commits first, then refuses (409), superseding nothing', async () => {
    const flow = await consentedChip();
    const challenge = await create(flow);

    const { waited, outcome } = await whileHeld(
      flow.session.inquiryId,
      [
        ["UPDATE verifications SET status = 'submitted' WHERE id = $1", [flow.verificationId]],
        ["UPDATE chip_challenges SET status = 'submitted' WHERE id = $1", [challenge.id]],
      ],
      () => create(flow),
    );

    expect(waited).toBe(true);
    expect(outcome).toBeInstanceOf(ConflictError);
    expect((await challengesOf(flow)).map((one) => [one.id, one.status])).toEqual([
      [challenge.id, 'submitted'],
    ]);
  });

  it('a submit waits for a create that superseded its challenge, then refuses (409 chip_challenge_invalid)', async () => {
    const flow = await consentedChip();
    const challenge = await create(flow);

    const { waited, outcome } = await whileHeld(
      flow.session.inquiryId,
      [["UPDATE chip_challenges SET status = 'superseded' WHERE id = $1", [challenge.id]]],
      () => submit(flow, challenge),
    );

    expect(waited).toBe(true);
    expect(outcome).toBeInstanceOf(Phase5ProblemError);
    expect(outcome).toMatchObject({ status: 409, code: 'chip_challenge_invalid' });
    expect(await statusOf(flow.verificationId)).toBe('initiated');
    expect(await openChipChallengeSubmission(db, environmentId, challenge.id)).toEqual({
      nonce: null,
      aaResponse: null,
      deviceReport: null,
    });
  });

  it('two creates serialize on the inquiry: one challenge stays open, the other is superseded', async () => {
    const flow = await consentedChip();

    const answers = await Promise.all([create(flow), create(flow)]);

    const challenges = await challengesOf(flow);
    expect(challenges).toHaveLength(2);
    expect(challenges.filter((one) => one.status === 'initiated')).toHaveLength(1);
    expect(challenges.filter((one) => one.status === 'superseded')).toHaveLength(1);
    expect(new Set(answers.map((answer) => answer.id))).toEqual(
      new Set(challenges.map((one) => one.id)),
    );
  });

  it('a submit waits for the inquiry’s expiry, whose cancel superseded the challenge, then refuses (409)', async () => {
    const flow = await consentedChip();
    const challenge = await create(flow);

    const { waited, outcome } = await whileHeld(
      flow.session.inquiryId,
      [
        ["UPDATE inquiries SET status = 'expired' WHERE id = $1", [flow.session.inquiryId]],
        ["UPDATE verifications SET status = 'canceled' WHERE id = $1", [flow.verificationId]],
        [
          "UPDATE chip_challenges SET status = 'superseded' WHERE verification_id = $1 AND status = 'initiated'",
          [flow.verificationId],
        ],
      ],
      () => submit(flow, challenge),
    );

    expect(waited).toBe(true);
    expect(outcome).toBeInstanceOf(ConflictError);
    expect((await getChipChallenge(db, environmentId, challenge.id))?.status).toBe('superseded');
  });
});

/**
 * An event publisher that, at the decision's first staged event (inside its transaction, after
 * the inquiry lock), says so and waits for `gate`.
 */
function pausingEvents(entered: () => void, gate: Promise<void>): TransactionalEventPublisher {
  const logger = createCapturingLogger();
  const publisher = createEventPublisher({
    db,
    deliveries: createWebhookDeliveryScheduler(createRecordingJobQueue()),
    logger,
  });
  let paused = false;
  return {
    publish: (input) => publisher.publish(input),
    stage: async (tx, input) => {
      if (!paused) {
        paused = true;
        entered();
        await gate;
      }
      return publisher.stage(tx, input);
    },
    dispatch: (staged) => publisher.dispatch(staged),
  };
}

/** The job's dependencies: the golden face for the selfie and the chip, the blind index key. */
function jobDeps(): ProcessVerificationDeps {
  const logger = createCapturingLogger();
  return {
    db,
    storage: jobStorage,
    keyring,
    vision: createFakeVision().client,
    events: createEventPublisher({
      db,
      deliveries: createWebhookDeliveryScheduler(createRecordingJobQueue()),
      logger,
    }),
    clock: { now: () => new Date() },
    logger,
    blindIndexKey: KEY,
  };
}

/** A submitted NFC verification with a passed selfie and ID, its challenge consumed. */
async function submittedChip(seed: string) {
  return seedNfcInquiry(db, {
    environmentId,
    storage: jobStorage,
    keyring,
    now: new Date(),
    chip: testChip({ now: new Date(), seed }),
  });
}

describe('C53.6: the job’s writers and a redaction', () => {
  it('the decision waits for the redaction, then writes nothing (inquiry_redacted)', async () => {
    const seeded = await submittedChip('races/decision');

    const { waited, outcome } = await whileHeld(seeded.inquiryId, redaction(seeded.inquiryId), () =>
      processVerification({ environmentId, verificationId: seeded.verificationId }, jobDeps()),
    );

    expect(waited).toBe(true);
    expect(outcome).toBeInstanceOf(PermanentJobError);
    expect(outcome).toMatchObject({ reason: 'inquiry_redacted' });
    expect(await statusOf(seeded.verificationId)).toBe('submitted');
    expect(await getChipRead(db, environmentId, seeded.verificationId)).toBeNull();
  });

  it('the processing-failure update waits for the redaction, then processes the challenge', async () => {
    const seeded = await submittedChip('races/failure');

    const { waited, outcome } = await whileHeld(seeded.inquiryId, redaction(seeded.inquiryId), () =>
      failVerificationAfterError(
        { environmentId, verificationId: seeded.verificationId },
        jobDeps(),
        'SyntheticError',
      ),
    );

    expect(waited).toBe(true);
    expect(outcome).toMatchObject({ outcome: 'failed' });
    expect(await statusOf(seeded.verificationId)).toBe('failed');
    expect((await getChipChallenge(db, environmentId, seeded.challengeId))?.status).toBe(
      'processed',
    );
  });

  it('a redaction waits for a decision that holds the inquiry, then clears the read it wrote', async () => {
    const seeded = await submittedChip('races/redact-after');
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: () => void = () => undefined;
    const holding = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const deciding = processVerification(
      { environmentId, verificationId: seeded.verificationId },
      { ...jobDeps(), events: pausingEvents(entered, gate) },
    );
    await holding;

    const redacting = redactInquiryRecords(db, environmentId, seeded.inquiryId);
    const waited = !(await settlesWithin(redacting));
    release();
    await deciding;
    await redacting;

    expect(waited).toBe(true);
    expect(await statusOf(seeded.verificationId)).toBe('passed');
    expect(await getChipRead(db, environmentId, seeded.verificationId)).toMatchObject({
      sodSignatureIndex: null,
      documentNumberIndex: null,
      redactedAt: expect.any(Date) as unknown,
    });
    expect(await openChipReadEvidence(db, environmentId, seeded.verificationId)).toBeNull();
  });
});

describe('C53.4: the chip read index rebuild and a redaction', () => {
  it('waits for the redaction of a row it would index, then leaves it unindexed', async () => {
    const seeded = await submittedChip('races/rebuild');
    await processVerification({ environmentId, verificationId: seeded.verificationId }, jobDeps());
    expect(
      (await getChipRead(db, environmentId, seeded.verificationId))?.sodSignatureIndex,
    ).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/u));

    const { waited } = await whileHeld(seeded.inquiryId, redaction(seeded.inquiryId), () =>
      rebuildChipReadIndexes(db, new Uint8Array(32).fill(0x2a), { batchSize: 1_000 }),
    );

    expect(waited).toBe(true);
    expect(await getChipRead(db, environmentId, seeded.verificationId)).toMatchObject({
      sodSignatureIndex: null,
      documentNumberIndex: null,
    });
  });
});
