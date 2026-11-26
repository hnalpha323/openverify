/**
 * C53.6, C40.6 against Postgres 17 row locks (Testcontainers), `api-crypto`: every writer of a
 * wallet challenge runs in one transaction that locks the inquiry (its status and `redacted_at`
 * re-checked), then the verification, then the challenge. Each test holds the competing
 * writer's locks in a transaction of its own connection, as a concurrent request, job, expiry or
 * redaction would, and runs the writer:
 * - the challenge create and its cap cancel wait for a redaction, then write nothing (410);
 * - a create waits for a submit and is refused (409); a submit waits for a create that
 *   superseded its challenge and is refused (409 `crypto_challenge_invalid`); two creates
 *   serialize, leaving one open challenge;
 * - a submit waits for a redaction (410) and for the inquiry's expiry, whose cancel hook
 *   superseded the challenge (409), consuming nothing;
 * - the job's decision waits for a redaction and writes nothing; its processing-failure update
 *   waits for one and then marks the challenge processed;
 * - the address index rebuild waits for a redaction of the row and leaves it unindexed.
 * Every key is a labelled test wallet; every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { CRYPTO_CHALLENGE_LIMIT, newId } from '@openverify/contracts';
import {
  createDatabase,
  createInquiry,
  createInquirySession,
  createInquiryTemplate,
  createKeyring,
  createVerification,
  getCryptoChallenge,
  getVerification,
  hashSessionToken,
  listCryptoChallenges,
  openCryptoChallengeEvidence,
  rebuildCryptoAddressIndexes,
  redactInquiryRecords,
  recordInquirySessionConsent,
  runMigrations,
  setDefaultKeyring,
  transitionInquiryStatus,
  type Database,
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
import { createWebhookDeliveryScheduler } from '../../webhooks/queue.js';
import { createAccountsService } from '../accounts.js';
import type { ApiDependencies } from '../context.js';
import { submitVerification } from '../flow.js';
import { createFlowCryptoChallenge } from './create.js';
import {
  cryptoWalletTemplateAttributes,
  signTestPersonalMessage,
  testWalletAddress,
  TEST_CHAINS,
} from './testing.js';

const keyring = createKeyring(randomBytes(32));
/** Long enough for a writer that takes no lock to finish first. */
const WAIT_MS = 1_500;
const LABEL = 'races/alice';

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
let deps: ApiDependencies;
let environmentId: string;
let templateId: string;
let versionId: string;

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
  environmentId = (await createTestTenant(db, { organizationName: 'Race Org' })).environment.id;
  const attributes = cryptoWalletTemplateAttributes();
  const template = await createInquiryTemplate(db, environmentId, {
    id: newId('itmpl'),
    name: 'Wallet races',
    version: {
      id: newId('itmplv'),
      flow: attributes.flow,
      verificationConfig: attributes['verification-config'],
    },
  });
  templateId = template.id;
  versionId = template.currentVersion.id;
}, 180_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(pool)?.end();
  await container?.stop();
});

interface WalletFlow {
  session: FlowSession;
  verificationId: string;
}

/** A pending inquiry whose session consented, with an `initiated` crypto wallet verification. */
async function consentedWallet(): Promise<WalletFlow> {
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
    type: 'crypto_wallet',
  });
  return { session: { id: session.id, environmentId, inquiryId: inquiry.id }, verificationId };
}

const create = (flow: WalletFlow) =>
  createFlowCryptoChallenge(deps, flow.session, flow.verificationId, {
    'chain-id': TEST_CHAINS.ethereum,
    'wallet-address': testWalletAddress(LABEL),
  });

const submit = (flow: WalletFlow, challenge: { id: string; message: string }) =>
  submitVerification(deps, flow.session, flow.verificationId, {
    crypto: {
      'challenge-id': challenge.id,
      signature: signTestPersonalMessage(challenge.message, LABEL),
    },
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

/** As a redaction does first (C16, G002): stamp the inquiry and clear its challenges. */
const redaction = (inquiryId: string): [string, unknown[]][] => [
  ['UPDATE inquiries SET redacted_at = now() WHERE id = $1', [inquiryId]],
  [
    `UPDATE crypto_challenges SET wallet_address = NULL, address_index = NULL, message = NULL,
       signature = NULL, signed_message = NULL, redacted_at = now() WHERE inquiry_id = $1`,
    [inquiryId],
  ],
];

const challengesOf = (flow: WalletFlow) =>
  listCryptoChallenges(db, environmentId, flow.verificationId);

const statusOf = async (flow: WalletFlow) =>
  (await getVerification(db, environmentId, flow.verificationId))?.status;

describe('C53.6: the challenge writers and a redaction of the inquiry', () => {
  it('a create waits for the redaction, then refuses (410) and writes no challenge', async () => {
    const flow = await consentedWallet();

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
    const flow = await consentedWallet();
    for (let index = 0; index < CRYPTO_CHALLENGE_LIMIT; index += 1) {
      await create(flow);
    }

    const { waited, outcome } = await whileHeld(
      flow.session.inquiryId,
      [['UPDATE inquiries SET redacted_at = now() WHERE id = $1', [flow.session.inquiryId]]],
      () => create(flow),
    );

    expect(waited).toBe(true);
    expect(outcome).toBeInstanceOf(RedactedError);
    expect(await statusOf(flow)).toBe('initiated');
    const challenges = await challengesOf(flow);
    expect(challenges).toHaveLength(CRYPTO_CHALLENGE_LIMIT);
    expect(challenges[0]?.status).toBe('initiated');
  });

  it('a submit waits for the redaction, then refuses (410), consuming nothing', async () => {
    const flow = await consentedWallet();
    const challenge = await create(flow);

    const { waited, outcome } = await whileHeld(
      flow.session.inquiryId,
      redaction(flow.session.inquiryId),
      () => submit(flow, challenge),
    );

    expect(waited).toBe(true);
    expect(outcome).toBeInstanceOf(RedactedError);
    expect(await getCryptoChallenge(db, environmentId, challenge.id)).toMatchObject({
      status: 'initiated',
      submittedAt: null,
    });
    expect(await statusOf(flow)).toBe('initiated');
  });
});

describe('C40.6: the challenge writers against each other', () => {
  it('a create waits for a submit that commits first, then refuses (409), superseding nothing', async () => {
    const flow = await consentedWallet();
    const challenge = await create(flow);

    const { waited, outcome } = await whileHeld(
      flow.session.inquiryId,
      [
        ["UPDATE verifications SET status = 'submitted' WHERE id = $1", [flow.verificationId]],
        ["UPDATE crypto_challenges SET status = 'submitted' WHERE id = $1", [challenge.id]],
      ],
      () => create(flow),
    );

    expect(waited).toBe(true);
    expect(outcome).toBeInstanceOf(ConflictError);
    expect((await challengesOf(flow)).map((one) => [one.id, one.status])).toEqual([
      [challenge.id, 'submitted'],
    ]);
  });

  it('a submit waits for a create that superseded its challenge, then refuses (409 crypto_challenge_invalid)', async () => {
    const flow = await consentedWallet();
    const challenge = await create(flow);

    const { waited, outcome } = await whileHeld(
      flow.session.inquiryId,
      [["UPDATE crypto_challenges SET status = 'superseded' WHERE id = $1", [challenge.id]]],
      () => submit(flow, challenge),
    );

    expect(waited).toBe(true);
    expect(outcome).toBeInstanceOf(Phase5ProblemError);
    expect(outcome).toMatchObject({ status: 409, code: 'crypto_challenge_invalid' });
    expect(await statusOf(flow)).toBe('initiated');
    expect((await getCryptoChallenge(db, environmentId, challenge.id))?.status).toBe(
      'superseded',
    );
  });

  it('two creates serialize on the inquiry: one challenge stays open, the other is superseded', async () => {
    const flow = await consentedWallet();

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
    const flow = await consentedWallet();
    const challenge = await create(flow);

    const { waited, outcome } = await whileHeld(
      flow.session.inquiryId,
      [
        ["UPDATE inquiries SET status = 'expired' WHERE id = $1", [flow.session.inquiryId]],
        ["UPDATE verifications SET status = 'canceled' WHERE id = $1", [flow.verificationId]],
        [
          "UPDATE crypto_challenges SET status = 'superseded' WHERE verification_id = $1 AND status = 'initiated'",
          [flow.verificationId],
        ],
      ],
      () => submit(flow, challenge),
    );

    expect(waited).toBe(true);
    expect(outcome).toBeInstanceOf(ConflictError);
    expect((await getCryptoChallenge(db, environmentId, challenge.id))?.status).toBe(
      'superseded',
    );
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

/** The job's dependencies, with the sandbox environment's evmRpc unbound. */
function jobDeps(): ProcessVerificationDeps {
  const logger = createCapturingLogger();
  return {
    db,
    storage: createMemoryStorage(),
    keyring,
    vision: createFakeVision().client,
    events: createEventPublisher({
      db,
      deliveries: createWebhookDeliveryScheduler(createRecordingJobQueue()),
      logger,
    }),
    clock: { now: () => new Date() },
    logger,
  };
}

/** A crypto wallet verification submitted through the flow, its challenge consumed. */
async function submittedWallet() {
  const flow = await consentedWallet();
  const challenge = await create(flow);
  await submit(flow, challenge);
  return { flow, challenge };
}

describe('C53.6: the job’s writers and a redaction', () => {
  it('the decision waits for the redaction, then writes nothing (inquiry_redacted)', async () => {
    const { flow, challenge } = await submittedWallet();

    const { waited, outcome } = await whileHeld(
      flow.session.inquiryId,
      redaction(flow.session.inquiryId),
      () =>
        processVerification(
          { environmentId, verificationId: flow.verificationId },
          jobDeps(),
        ),
    );

    expect(waited).toBe(true);
    expect(outcome).toBeInstanceOf(PermanentJobError);
    expect(outcome).toMatchObject({ reason: 'inquiry_redacted' });
    expect(await statusOf(flow)).toBe('submitted');
    expect(await getCryptoChallenge(db, environmentId, challenge.id)).toMatchObject({
      status: 'submitted',
      redactedAt: expect.any(Date) as unknown,
    });
  });

  it('the processing-failure update waits for the redaction, then fails the verification and processes its challenge', async () => {
    const { flow, challenge } = await submittedWallet();

    const { waited, outcome } = await whileHeld(
      flow.session.inquiryId,
      redaction(flow.session.inquiryId),
      () =>
        failVerificationAfterError(
          { environmentId, verificationId: flow.verificationId },
          jobDeps(),
          'SyntheticError',
        ),
    );

    expect(waited).toBe(true);
    expect(outcome).toMatchObject({ outcome: 'failed' });
    expect(await statusOf(flow)).toBe('failed');
    expect((await getCryptoChallenge(db, environmentId, challenge.id))?.status).toBe('processed');
  });

  it('a redaction waits for a decision that holds the inquiry, then clears what it wrote', async () => {
    const { flow, challenge } = await submittedWallet();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: () => void = () => undefined;
    const holding = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const deciding = processVerification(
      { environmentId, verificationId: flow.verificationId },
      { ...jobDeps(), events: pausingEvents(entered, gate) },
    );
    await holding;

    const redacting = redactInquiryRecords(db, environmentId, flow.session.inquiryId);
    const waited = !(await settlesWithin(redacting));
    release();
    await deciding;
    await redacting;

    expect(waited).toBe(true);
    expect(await statusOf(flow)).toBe('passed');
    expect(await getCryptoChallenge(db, environmentId, challenge.id)).toMatchObject({
      status: 'processed',
      scheme: 'eip191',
      addressIndex: null,
      redactedAt: expect.any(Date) as unknown,
    });
    expect(await openCryptoChallengeEvidence(db, environmentId, challenge.id)).toEqual({
      walletAddress: null,
      message: null,
      signature: null,
      signedMessage: null,
    });
  });
});

describe('C53.4: the address index rebuild and a redaction', () => {
  it('waits for the redaction of a row it would index, then leaves it unindexed', async () => {
    const { flow, challenge } = await submittedWallet();
    const key = new Uint8Array(32).fill(0x2a);

    const { waited } = await whileHeld(
      flow.session.inquiryId,
      redaction(flow.session.inquiryId),
      () => rebuildCryptoAddressIndexes(db, key, { batchSize: 1_000 }),
    );

    expect(waited).toBe(true);
    expect(await getCryptoChallenge(db, environmentId, challenge.id)).toMatchObject({
      addressIndex: null,
    });
  });
});
