/**
 * C54.1, C59.6: the `process-verification` job drives a type only through its hooks. Two type
 * modules are replaced here by recording jobs: `document` (runnable, so the job judges it) and
 * `aamva` (a decision hook only, as the silent AAMVA attempt will be built).
 */
import { newId } from '@openverify/contracts';
import { getCheckDefinition, type CheckResult } from '@openverify/core';
import {
  createVerification,
  getVerification,
  listEvents,
  setVerificationStatus,
  transitionInquiryStatus,
  type Db,
  type Keyring,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEventPublisher } from '../events/index.js';
import { phase5TemplateAttributes } from '../test-support/phase5-templates.js';
import { createRecordingQueue as createRecordingVerificationQueue } from '../test-support/fakes.js';
import { createWebhookDeliveryScheduler, type WebhookDeliveryJob } from '../webhooks/queue.js';
import {
  failVerificationAfterError,
  processVerification,
  type ProcessVerificationDeps,
} from './process-verification.js';
import {
  createCapturingLogger,
  createFakeVision,
  createMemoryStorage,
  createRecordingQueue,
} from './testing.js';
import type {
  AfterCommitContext,
  DecisionContext,
  InquiryVerificationDecidedContext,
  TypeEvaluationJob,
  VerificationTypeJob,
} from './types/index.js';

/** What the recording jobs saw, and what the next evaluation answers. */
const recorded = vi.hoisted(() => ({
  evaluations: [] as TypeEvaluationJob[],
  decisions: [] as { status: string; state: unknown; inTransaction: boolean }[],
  afterCommits: [] as { status: string; state: unknown }[],
  decided: [] as { type: string; status: string; inquiryStatus: string | null }[],
  results: [] as CheckResult[],
  hookEvent: true,
  skip: false,
}));

vi.mock('./types/document.js', () => ({
  documentJob: {
    type: 'document',
    runnable: true,
    evaluate: (_deps: unknown, job: TypeEvaluationJob) => {
      recorded.evaluations.push(job);
      return Promise.resolve({
        results: recorded.results,
        state: { marker: 'document-state' },
        skip: recorded.skip,
      });
    },
    async persistInDecisionTx(_tx: Db, ctx: DecisionContext<unknown>) {
      recorded.decisions.push({ status: ctx.status, state: ctx.state, inTransaction: true });
      return ctx.verificationEvent();
    },
    afterCommit(ctx: AfterCommitContext<unknown>) {
      recorded.afterCommits.push({ status: ctx.status, state: ctx.state });
      return Promise.resolve();
    },
    onProcessingFailed: () => Promise.resolve([]),
  } satisfies VerificationTypeJob,
}));

vi.mock('./types/aamva.js', () => ({
  aamvaJob: {
    type: 'aamva',
    runnable: false,
    evaluate: () => Promise.reject(new Error('not judged here')),
    persistInDecisionTx: () => Promise.resolve([]),
    onProcessingFailed: () => Promise.resolve([]),
    async onInquiryVerificationDecided(tx: Db, ctx: InquiryVerificationDecidedContext) {
      recorded.decided.push({
        type: ctx.decided.type,
        status: ctx.decided.status,
        inquiryStatus: ctx.inquiryStatus,
      });
      const { stageVerificationEvent } = await import('../services/verifications.js');
      // A marker event about the decided verification: its name and order are what is read.
      const staged = recorded.hookEvent
        ? [
            await stageVerificationEvent(
              tx,
              ctx.deps.events,
              'verification.created',
              ctx.decided,
              [],
            ),
          ]
        : [];
      return {
        staged,
        enqueue: [{ environmentId: ctx.environmentId, verificationId: 'ver_hooked' }],
      };
    },
  } satisfies VerificationTypeJob,
}));

const NOW = new Date('2026-10-20T12:00:00.000Z');
let database: TestDatabase;
let db: Db;
let keyring: Keyring;
let environmentId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  keyring = database.keyring;
  environmentId = (await createTestTenant(db)).environment.id;
}, 60_000);

afterAll(async () => {
  await database.close();
});

beforeEach(() => {
  recorded.evaluations.length = 0;
  recorded.decisions.length = 0;
  recorded.afterCommits.length = 0;
  recorded.decided.length = 0;
  recorded.hookEvent = true;
  recorded.skip = false;
});

const attributes = phase5TemplateAttributes();
const documentConfig = attributes['verification-config'].document;

/** Every enabled document check answering `status`. */
function documentResults(status: CheckResult['status']): CheckResult[] {
  return Object.entries(documentConfig?.checks ?? {})
    .filter(([, check]) => check.enabled)
    .map(([name]) => {
      const definition = getCheckDefinition(name);
      return {
        name,
        status,
        type: definition?.checkType ?? 'fraud',
        reasons: [],
        metadata: {},
        stage: definition?.stage ?? 'ga',
        confidence: definition?.tier === 'H' ? 0.9 : null,
        provenance: { 'implementation-version': 1, thresholds: {} },
      };
    });
}

async function submittedDocument(): Promise<{ inquiryId: string; verificationId: string }> {
  const { inquiry } = await createTestInquiry(db, environmentId, {
    flow: attributes.flow,
    verificationConfig: attributes['verification-config'],
  });
  await transitionInquiryStatus(db, environmentId, inquiry.id, { from: 'created', to: 'pending' });
  const verificationId = newId('ver');
  await createVerification(db, environmentId, {
    id: verificationId,
    inquiryId: inquiry.id,
    type: 'document',
  });
  await setVerificationStatus(db, environmentId, verificationId, { to: 'submitted' });
  return { inquiryId: inquiry.id, verificationId };
}

function setup() {
  const logger = createCapturingLogger();
  const events = createEventPublisher({
    db,
    deliveries: createWebhookDeliveryScheduler(createRecordingQueue<WebhookDeliveryJob>()),
    logger,
  });
  const queue = createRecordingVerificationQueue();
  const deps: ProcessVerificationDeps = {
    db,
    storage: createMemoryStorage(),
    keyring,
    vision: createFakeVision().client,
    events,
    clock: { now: () => NOW },
    logger,
    queue,
  };
  return { deps, queue };
}

/** Names of the environment's events, oldest first. */
async function eventNames(): Promise<string[]> {
  const page = await listEvents(db, environmentId, { size: 100 });
  return page.items.map((event) => event.name).reverse();
}

describe('the process-verification job through the type hooks (C54.1)', () => {
  it('evaluates with the type job, persists in the decision transaction, then runs afterCommit', async () => {
    recorded.results = documentResults('passed');
    const { inquiryId, verificationId } = await submittedDocument();
    const { deps } = setup();

    await expect(
      processVerification({ environmentId, verificationId }, deps),
    ).resolves.toMatchObject({ outcome: 'processed', verificationStatus: 'passed' });

    expect(recorded.evaluations).toHaveLength(1);
    expect(recorded.evaluations[0]).toMatchObject({
      environmentId,
      verificationId,
      config: documentConfig,
      flow: attributes.flow,
      lastAttempt: false,
      now: NOW,
    });
    expect(recorded.evaluations[0]?.inquiry.id).toBe(inquiryId);
    expect(recorded.decisions).toEqual([
      { status: 'passed', state: { marker: 'document-state' }, inTransaction: true },
    ]);
    expect(recorded.afterCommits).toEqual([
      { status: 'passed', state: { marker: 'document-state' } },
    ]);
    expect((await getVerification(db, environmentId, verificationId))?.status).toBe('passed');
  });
});

describe('onInquiryVerificationDecided (C59.6)', () => {
  it('runs every type decision hook in the decision transaction, after the verification event, and enqueues its jobs after commit', async () => {
    recorded.results = documentResults('passed');
    const { verificationId } = await submittedDocument();
    const { deps, queue } = setup();
    const before = (await eventNames()).length;

    await processVerification({ environmentId, verificationId }, deps);

    expect(recorded.decided).toEqual([
      { type: 'document', status: 'passed', inquiryStatus: 'pending' },
    ]);
    const names = (await eventNames()).slice(before);
    expect(names.slice(0, 2)).toEqual(['verification.passed', 'verification.created']);
    expect(queue.jobs).toEqual([{ environmentId, verificationId: 'ver_hooked' }]);
  });

  it('runs on a verification failed because its processing cannot finish', async () => {
    recorded.hookEvent = false;
    const { verificationId } = await submittedDocument();
    const { deps, queue } = setup();

    await failVerificationAfterError({ environmentId, verificationId }, deps, 'SyntheticError');

    expect(recorded.decided).toEqual([
      { type: 'document', status: 'failed', inquiryStatus: 'pending' },
    ]);
    expect(queue.jobs).toEqual([{ environmentId, verificationId: 'ver_hooked' }]);
  });
});

describe('a type evaluation that asks for a skip (C50.7, C59.5)', () => {
  it('moves the verification submitted to skipped with its checks and verification.skipped, runs the type and decision hooks, then settles', async () => {
    // A passing set of checks: the skip wins over what they would decide.
    recorded.results = documentResults('passed');
    recorded.skip = true;
    const { verificationId } = await submittedDocument();
    const { deps, queue } = setup();
    const before = (await eventNames()).length;

    await expect(
      processVerification({ environmentId, verificationId }, deps),
    ).resolves.toMatchObject({
      outcome: 'processed',
      verificationStatus: 'skipped',
      inquiryStatus: 'pending',
    });

    const stored = await getVerification(db, environmentId, verificationId);
    expect(stored).toMatchObject({ status: 'skipped', completedAt: NOW });
    expect(stored?.checks.map((check) => check.name).sort()).toEqual(
      recorded.results.map((result) => result.name).sort(),
    );
    expect(recorded.decisions).toEqual([
      { status: 'skipped', state: { marker: 'document-state' }, inTransaction: true },
    ]);
    expect(recorded.afterCommits).toEqual([
      { status: 'skipped', state: { marker: 'document-state' } },
    ]);
    expect(recorded.decided).toEqual([
      { type: 'document', status: 'skipped', inquiryStatus: 'pending' },
    ]);
    const names = (await eventNames()).slice(before);
    expect(names.slice(0, 2)).toEqual(['verification.skipped', 'verification.created']);
    expect(queue.jobs).toEqual([{ environmentId, verificationId: 'ver_hooked' }]);
  });

  it('skips nothing another job decided first: that decision stands', async () => {
    recorded.results = documentResults('passed');
    recorded.skip = true;
    const { verificationId } = await submittedDocument();
    const { deps } = setup();
    await setVerificationStatus(db, environmentId, verificationId, {
      from: 'submitted',
      to: 'failed',
    });

    await expect(
      processVerification({ environmentId, verificationId }, deps),
    ).resolves.toMatchObject({ outcome: 'skipped', reason: 'not_submitted' });
    expect((await getVerification(db, environmentId, verificationId))?.status).toBe('failed');
  });
});
