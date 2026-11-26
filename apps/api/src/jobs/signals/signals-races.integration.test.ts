/**
 * Owner decision 5 after Workflow 6C, for the `inquiry-signals` job (Workflow 7A, C90.7), against
 * Postgres 17 row locks (Testcontainers, started without bind-parameter logging, C73.8). The 6D
 * guard leaves `completed → needs_review` unguarded, so `on-signal` must never move a redacted
 * inquiry itself. The job takes the inquiry's row lock first (`SELECT … FOR UPDATE`), as
 * redaction does, so whichever transaction locks first wins:
 * - **the redaction first:** the job waits for its commit, then finds the inquiry redacted: it
 *   skips the row, computes nothing and moves nothing. The inquiry stays `completed`;
 * - **the job first:** the redaction waits for its commit, then redacts the inquiry the job froze
 *   and moved to `needs_review`.
 *
 * Each order is held inside its transaction at its first staged event, as
 * `services/inquiry-redaction-races.integration.test.ts` holds its writers. Synthetic values only.
 */
import { randomBytes } from 'node:crypto';
import { defaultInquiryTemplateAttributes } from '@openverify/contracts';
import {
  createDatabase,
  createKeyring,
  createSignalComputation,
  getInquiry,
  runMigrations,
  setDefaultKeyring,
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
import { createEventPublisher, type TransactionalEventPublisher } from '../../events/index.js';
import { createRedactionService } from '../../services/redaction.js';
import { createInMemoryFileStorage } from '../../storage/index.js';
import { createWebhookDeliveryScheduler } from '../../webhooks/queue.js';
import { createCapturingLogger, createRecordingQueue } from '../testing.js';
import { processInquirySignals } from './process.js';

const keyring = createKeyring(randomBytes(32));
const NOW = new Date('2026-10-30T12:00:00.000Z');
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

/**
 * A completed inquiry (no session) with its pending outbox row, whose pinned `signal-config` sends
 * it to review: `session_count` is 0, so the rule matches a value.
 */
async function completedInquiry(): Promise<string> {
  const { inquiry } = await createTestInquiry(db, environmentId, {
    flow: defaultInquiryTemplateAttributes().flow,
  });
  await pool.query('update inquiry_template_versions set signal_config = $1 where id = $2', [
    JSON.stringify({
      'on-signal': 'needs_review',
      'review-rules': [{ signal: 'inquiry/session_count', lte: 0 }],
    }),
    inquiry.inquiryTemplateVersionId,
  ]);
  await transitionInquiryStatus(db, environmentId, inquiry.id, { from: 'created', to: 'pending' });
  await transitionInquiryStatus(db, environmentId, inquiry.id, {
    from: 'pending',
    to: 'completed',
  });
  await createSignalComputation(db, environmentId, {
    inquiryId: inquiry.id,
    triggerStatus: 'completed',
  });
  return inquiry.id;
}

const runJob = (inquiryId: string, events: TransactionalEventPublisher) =>
  processInquirySignals(
    { environmentId, inquiryId },
    { db, clock, logger: createCapturingLogger(), events, keyring },
  );

const redact = (inquiryId: string, events: TransactionalEventPublisher) =>
  createRedactionService({ db, storage: createInMemoryFileStorage(), events, clock }).redactInquiry(
    { organizationId, environmentId },
    inquiryId,
    null,
  );

async function rowState(inquiryId: string): Promise<string | undefined> {
  const { rows } = await pool.query<{ state: string }>(
    'select state from inquiry_signal_computations where inquiry_id = $1',
    [inquiryId],
  );
  return rows[0]?.state;
}

describe('the inquiry-signals job and a redaction of its inquiry (C90.7, owner decision 5)', () => {
  it('a job that meets the redaction waits for its commit, then skips: nothing computed, not moved', async () => {
    const inquiryId = await completedInquiry();
    // Held inside the redaction's transaction at its first staged event: the inquiry is locked
    // and stamped, not yet committed.
    const redaction = heldAtFirstEvent(tableEvents());
    const redacting = redact(inquiryId, redaction.publisher);
    await redaction.reached;
    const computing = runJob(inquiryId, tableEvents());
    expect(await within(computing, WAIT_MS)).toBe('pending');
    redaction.release();
    await redacting;

    expect(await computing).toEqual({ outcome: 'skipped', signals: 0, markedForReview: false });
    expect(await getInquiry(db, environmentId, inquiryId)).toMatchObject({
      status: 'completed',
      redactedAt: NOW,
      signals: null,
    });
    expect(await rowState(inquiryId)).toBe('skipped');
  });

  it('a redaction that meets the job waits for its commit, then redacts the reviewed inquiry', async () => {
    const inquiryId = await completedInquiry();
    // Held inside the job's transaction at its first staged event: the move to needs_review.
    const job = heldAtFirstEvent(tableEvents());
    const computing = runJob(inquiryId, job.publisher);
    await job.reached;
    const redacting = redact(inquiryId, tableEvents());
    expect(await within(redacting, WAIT_MS)).toBe('pending');
    job.release();

    // Workflow 10B: the five device-integrity signals join the defaults (C210.4, C211.5).
    expect(await computing).toEqual({ outcome: 'computed', signals: 18, markedForReview: true });
    await redacting;
    expect(await getInquiry(db, environmentId, inquiryId)).toMatchObject({
      status: 'needs_review',
      redactedAt: NOW,
    });
    expect(await rowState(inquiryId)).toBe('computed');
  });
});
