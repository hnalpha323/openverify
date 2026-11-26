/**
 * Owner decision 5 after Workflow 6C against Postgres 17 row locks (Testcontainers, started without
 * bind-parameter logging, C73.8): a settlement of a pending inquiry and a C16 redaction of it, at
 * the same time. Redaction locks the inquiry (`redactInquiryRecords`: `SELECT … FOR UPDATE`, then
 * the update that sets `redacted_at`); settlement moves it with one conditional update. Under read
 * committed, Postgres re-checks that update's WHERE clause against the row the redaction committed,
 * so whichever commits first wins:
 * - **the redaction first:** the settlement waits for its commit, then moves nothing, as
 *   `transitionInquiryStatus` refuses `completed` and `failed` once `redacted_at` is set. The
 *   inquiry stays `pending` and redacted until it expires; only the redaction's own
 *   `inquiry-session.canceled` and `inquiry.redacted` are written;
 * - **the settlement first:** the redaction waits for its commit, then redacts the decided inquiry.
 *
 * Each order is held inside its transaction at its first staged event, as
 * `report-races.integration.test.ts` holds its writers. Synthetic values only.
 */
import { randomBytes } from 'node:crypto';
import { defaultInquiryTemplateAttributes, newId } from '@openverify/contracts';
import {
  createDatabase,
  createInquirySession,
  createKeyring,
  createVerification,
  getInquiry,
  hashSessionToken,
  runMigrations,
  setDefaultKeyring,
  setVerificationStatus,
  transitionInquiryStatus,
  type Database,
} from '@openverify/db';
import { createIntegrationPool, createTestInquiry, createTestTenant, startIntegrationPostgres, ifSet } from '@openverify/db/testing';
import type { Flow } from '@openverify/flow-spec';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEventPublisher, type TransactionalEventPublisher } from '../events/index.js';
import { createCapturingLogger, createRecordingQueue } from '../jobs/testing.js';
import { createInMemoryFileStorage } from '../storage/index.js';
import { createWebhookDeliveryScheduler } from '../webhooks/queue.js';
import { settleInquiry } from './inquiry-settlement.js';
import { createRedactionService } from './redaction.js';

const keyring = createKeyring(randomBytes(32));
const NOW = new Date('2026-10-29T12:00:00.000Z');
const clock = { now: () => NOW };
/** Long enough for a statement that takes no lock to finish first. */
const WAIT_MS = 1_500;

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
let environmentId: string;
let organizationId: string;

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 8 });
  db = createDatabase(pool);
  setDefaultKeyring(keyring);
  await runMigrations(db);
  const tenant = await createTestTenant(db);
  environmentId = tenant.environment.id;
  organizationId = tenant.organization.id;
}, 180_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(pool)?.end();
  await container?.stop();
});

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const sleep = (ms: number) =>
  new Promise((done) => {
    setTimeout(done, ms);
  });

/** Settles to `'pending'` when `promise` has not settled within `ms`. */
const within = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([promise.then(() => 'settled' as const), sleep(ms).then(() => 'pending' as const)]);

/** The event publisher of the API and the worker, writing the `events` table. */
const tableEvents = (): TransactionalEventPublisher =>
  createEventPublisher({
    db,
    deliveries: createWebhookDeliveryScheduler(createRecordingQueue()),
    logger: createCapturingLogger(),
  });

/** `publisher`, held inside the caller's transaction at its first staged event until `release`. */
function heldAtFirstEvent(publisher: TransactionalEventPublisher) {
  const reached = deferred();
  const released = deferred();
  let armed = true;
  const held: TransactionalEventPublisher = {
    publish: (input) => publisher.publish(input),
    dispatch: (staged) => publisher.dispatch(staged),
    stage: async (tx, input) => {
      if (armed) {
        armed = false;
        reached.resolve();
        await released.promise;
      }
      return publisher.stage(tx, input);
    },
  };
  return { reached: reached.promise, release: released.resolve, publisher: held };
}

/** Consent, a government ID step and the completion step: the default flow without its selfie. */
const FLOW: Flow = (() => {
  const { flow } = defaultInquiryTemplateAttributes();
  return { ...flow, steps: flow.steps.filter((step) => step.type !== 'selfie') };
})();

/** What a settlement decides from the government ID's status, and the events it writes. */
const OUTCOMES = {
  completed: {
    verification: 'passed',
    events: ['inquiry.completed', 'inquiry.transitioned', 'inquiry-session.canceled'],
  },
  failed: {
    // No check failed for the user: the failure is not retryable, so the step is exhausted.
    verification: 'failed',
    events: ['inquiry.failed', 'inquiry.transitioned', 'inquiry-session.canceled'],
  },
  needs_review: {
    verification: 'needs_review',
    events: [
      'inquiry.completed',
      'inquiry.transitioned',
      'inquiry-session.canceled',
      'inquiry.marked-for-review',
      'inquiry.transitioned',
    ],
  },
} as const;

type Outcome = keyof typeof OUTCOMES;

/** A pending inquiry with an active session and a decided government ID that settles to `outcome`. */
async function settlingInquiry(outcome: Outcome) {
  const { inquiry } = await createTestInquiry(db, environmentId, {
    flow: FLOW,
    fields: { name_first: 'Avery', name_last: 'Quillfeather' },
  });
  await transitionInquiryStatus(db, environmentId, inquiry.id, { from: 'created', to: 'pending' });
  const sessionId = newId('iqse');
  await createInquirySession(db, environmentId, {
    id: sessionId,
    inquiryId: inquiry.id,
    tokenHash: hashSessionToken(randomBytes(16).toString('hex')),
    expiresAt: new Date(NOW.getTime() + 86_400_000),
  });
  const verificationId = newId('ver');
  await createVerification(db, environmentId, {
    id: verificationId,
    inquiryId: inquiry.id,
    type: 'government_id',
  });
  await setVerificationStatus(db, environmentId, verificationId, { to: 'submitted' });
  await setVerificationStatus(db, environmentId, verificationId, {
    to: OUTCOMES[outcome].verification,
  });
  return { inquiryId: inquiry.id, sessionId };
}

const settle = (inquiryId: string, events: TransactionalEventPublisher) =>
  settleInquiry({ db, events, clock, logger: createCapturingLogger() }, environmentId, inquiryId, FLOW);

const redact = (inquiryId: string, events: TransactionalEventPublisher) =>
  createRedactionService({ db, storage: createInMemoryFileStorage(), events, clock }).redactInquiry(
    { organizationId, environmentId },
    inquiryId,
    null,
  );

/** The names of the events written about the inquiry and its session, sorted. */
async function eventNames(inquiryId: string, sessionId: string): Promise<string[]> {
  const rows = await pool.query<{ name: string }>(
    'select name from events where environment_id = $1 and object_id = any($2::text[])',
    [environmentId, [inquiryId, sessionId]],
  );
  return rows.rows.map((row) => row.name).sort();
}

describe('a settlement and a redaction of its pending inquiry (owner decision 5 after Workflow 6C)', () => {
  it.each(Object.keys(OUTCOMES) as Outcome[])(
    'a settlement to %s that meets the redaction waits for its commit, then moves nothing: pending and redacted',
    async (outcome) => {
      const { inquiryId, sessionId } = await settlingInquiry(outcome);
      // Held inside the redaction's transaction at its first staged event (the session's
      // cancellation): the inquiry row is locked and stamped, not yet committed.
      const redaction = heldAtFirstEvent(tableEvents());
      const redacting = redact(inquiryId, redaction.publisher);
      await redaction.reached;
      // The settlement reads the inquiry before the redaction commits, as the worker does, and its
      // conditional update waits for the row.
      const settling = settle(inquiryId, tableEvents());
      expect(await within(settling, WAIT_MS)).toBe('pending');
      redaction.release();
      await redacting;

      expect(await settling).toBe('pending');
      expect(await getInquiry(db, environmentId, inquiryId)).toMatchObject({
        status: 'pending',
        completedAt: null,
        failedAt: null,
        redactedAt: NOW,
      });
      expect(await eventNames(inquiryId, sessionId)).toEqual([
        'inquiry-session.canceled',
        'inquiry.redacted',
      ]);
    },
  );

  it.each(Object.keys(OUTCOMES) as Outcome[])(
    'a redaction that meets a settlement to %s waits for its commit, then redacts the settled inquiry',
    async (outcome) => {
      const { inquiryId, sessionId } = await settlingInquiry(outcome);
      // Held inside the settlement's transaction at its first staged event: the move is written,
      // not yet committed.
      const settlement = heldAtFirstEvent(tableEvents());
      const settling = settle(inquiryId, settlement.publisher);
      await settlement.reached;
      const redacting = redact(inquiryId, tableEvents());
      expect(await within(redacting, WAIT_MS)).toBe('pending');
      settlement.release();

      expect(await settling).toBe(outcome);
      await redacting;
      expect(await getInquiry(db, environmentId, inquiryId)).toMatchObject({
        status: outcome,
        redactedAt: NOW,
      });
      expect(await eventNames(inquiryId, sessionId)).toEqual(
        [...OUTCOMES[outcome].events, 'inquiry.redacted'].sort(),
      );
    },
  );
});
