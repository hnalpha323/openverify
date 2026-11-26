/**
 * Workflow 5C review K1: the repair sweep. A verification a decision hook created is enqueued
 * after the decision commits; when that enqueue failed, nothing else enqueued it, so it waited in
 * `submitted` and its inquiry never settled. The sweep enqueues every verification submitted more
 * than two minutes ago and still `submitted`, under its own job id. Every row is synthetic.
 *
 * C251.1 (Workflow 11B, quotas' named borrowed edit; review F12): only an ADMITTED verification is
 * enqueued again, two minutes after its admission; one the cap holds back (`admitted_at` null) waits
 * for the fair sweep. The helper admits each submitted verification at its submission, as a
 * producer within its cap does.
 */
import { createVerification, markQueueRowsAdmitted, setVerificationStatus } from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProcessVerificationJob, VerificationQueue } from '../../ports.js';
import { createRecordingQueue } from '../../test-support/fakes.js';
import { createVerificationQueue, type JobQueue } from '../index.js';
import { createCapturingLogger } from '../testing.js';
import {
  SUBMITTED_VERIFICATION_GRACE_MS,
  SUBMITTED_VERIFICATION_SWEEP_INTERVAL_MS,
  SUBMITTED_VERIFICATION_SWEEP_QUEUE,
  submittedVerificationSweepJob,
} from './submitted-verifications.js';

const NOW = new Date('2026-10-24T12:00:00.000Z');
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

/** A new environment and inquiry, so each test reads only its own verifications. */
async function inquiry() {
  const { environment } = await createTestTenant(database.db);
  const created = await createTestInquiry(database.db, environment.id);
  return { environmentId: environment.id, inquiryId: created.inquiry.id };
}

async function verification(
  { environmentId, inquiryId }: { environmentId: string; inquiryId: string },
  submittedAt: Date | null,
  decided?: 'passed' | 'failed' | 'needs_review' | 'skipped',
  admitted = true,
): Promise<string> {
  const id = testId('ver');
  await createVerification(database.db, environmentId, { id, inquiryId, type: 'aamva' });
  if (submittedAt !== null) {
    await setVerificationStatus(database.db, environmentId, id, {
      to: 'submitted',
      at: submittedAt,
    });
    if (admitted) {
      await markQueueRowsAdmitted(
        database.db,
        'process-verification',
        environmentId,
        [id],
        submittedAt,
      );
    }
  }
  if (decided !== undefined) {
    await setVerificationStatus(database.db, environmentId, id, { to: decided, at: NOW });
  }
  return id;
}

function sweep(queue: VerificationQueue, logger = createCapturingLogger()) {
  return submittedVerificationSweepJob(
    { db: database.db, clock: { now: () => NOW }, logger },
    queue,
  );
}

const mine = (jobs: readonly ProcessVerificationJob[], environmentId: string) =>
  jobs.filter((job) => job.environmentId === environmentId);

describe('submittedVerificationSweepJob', () => {
  it('runs every minute on a queue of its own, taking two minutes as the grace', () => {
    const job = sweep(createRecordingQueue());
    expect(job.name).toBe(SUBMITTED_VERIFICATION_SWEEP_QUEUE);
    expect(job.name).toBe('submitted-verification-sweep');
    expect(job.repeat).toEqual({ every: SUBMITTED_VERIFICATION_SWEEP_INTERVAL_MS });
    expect(SUBMITTED_VERIFICATION_SWEEP_INTERVAL_MS).toBe(60_000);
    expect(SUBMITTED_VERIFICATION_GRACE_MS).toBe(120_000);
  });

  it('enqueues a verification left submitted past the grace, and no other', async () => {
    const at = await inquiry();
    const stale = await verification(at, minutesAgo(3));
    await verification(at, minutesAgo(1));
    await verification(at, null);
    for (const decided of ['passed', 'failed', 'needs_review', 'skipped'] as const) {
      await verification(at, minutesAgo(10), decided);
    }
    const queue = createRecordingQueue();

    await sweep(queue).run();

    expect(mine(queue.jobs, at.environmentId)).toEqual([
      { environmentId: at.environmentId, verificationId: stale },
    ]);
  });

  it('never enqueues a verification the cap holds back, only an admitted one (C251.1)', async () => {
    const at = await inquiry();
    const admitted = await verification(at, minutesAgo(3));
    await verification(at, minutesAgo(30), undefined, false);
    const queue = createRecordingQueue();

    await sweep(queue).run();

    expect(mine(queue.jobs, at.environmentId)).toEqual([
      { environmentId: at.environmentId, verificationId: admitted },
    ]);
  });

  it('keeps going past a failed enqueue, logs it with ids only, and enqueues it on the next run', async () => {
    const at = await inquiry();
    const first = await verification(at, minutesAgo(4));
    const second = await verification(at, minutesAgo(5));
    const enqueued: string[] = [];
    let refused = false;
    // Valkey drops the connection while the sweep enqueues `first`, once.
    const queue: VerificationQueue = {
      enqueueProcessVerification: (job) => {
        if (job.verificationId === first && !refused) {
          refused = true;
          return Promise.reject(new Error('Connection is closed.'));
        }
        enqueued.push(job.verificationId);
        return Promise.resolve();
      },
    };
    const logger = createCapturingLogger();
    const job = sweep(queue, logger);

    await job.run();
    const afterFailure = [...enqueued];
    await job.run();

    expect(afterFailure.filter((id) => id === first || id === second)).toEqual([second]);
    expect(enqueued.filter((id) => id === first || id === second).sort()).toEqual(
      [second, first, second].sort(),
    );
    const failures = logger.entries.filter(
      (entry) => entry.message === 'submitted verification not re-enqueued',
    );
    expect(failures).toEqual([
      {
        level: 'error',
        object: {
          queue: SUBMITTED_VERIFICATION_SWEEP_QUEUE,
          environmentId: at.environmentId,
          verificationId: first,
          error: 'Error',
        },
        message: 'submitted verification not re-enqueued',
      },
    ]);
    expect(JSON.stringify(logger.entries)).not.toContain('Connection is closed');
  });

  it('adds one job however often it runs: the job id is the verification id', async () => {
    const at = await inquiry();
    const stale = await verification(at, minutesAgo(3));
    const added = new Map<string, ProcessVerificationJob>();
    const bull: JobQueue<ProcessVerificationJob> = {
      // BullMQ ignores an add under an id that still exists.
      add: (_name, data, options) => {
        const jobId = options?.jobId ?? '';
        if (!added.has(jobId)) {
          added.set(jobId, data);
        }
        return Promise.resolve();
      },
      close: () => Promise.resolve(),
    };
    const job = sweep(createVerificationQueue({ queue: bull }));

    await job.run();
    await job.run();

    expect([...added].filter(([, data]) => data.environmentId === at.environmentId)).toEqual([
      [stale, { environmentId: at.environmentId, verificationId: stale }],
    ]);
  });
});
