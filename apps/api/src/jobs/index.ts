/**
 * The `process-verification` queue (BullMQ over the Redis protocol, served by Valkey). The
 * job id is the verification id, so submitting a verification twice never processes it
 * twice. Jobs carry ids only; the worker reads everything else from the database.
 */
import { isId } from '@openverify/contracts';
import type { JobsOptions } from 'bullmq';
import type { ProcessVerificationJob, VerificationQueue } from '../ports.js';
import { createBullQueue, type BullQueueOptions, type JobQueue } from './queue.js';

export { createBullQueue, type BullQueueOptions, type JobQueue } from './queue.js';

export const PROCESS_VERIFICATION_QUEUE = 'process-verification';
export const PROCESS_VERIFICATION_JOB = 'process-verification';

/**
 * Vision outages and database hiccups are retried five times with exponential backoff and
 * jitter (about 5 s, 10 s, 20 s, 40 s). Completed job ids are kept a day, so a repeated
 * submit within that time is a no-op; failed jobs are kept a week for inspection.
 */
export const PROCESS_VERIFICATION_JOB_OPTIONS = Object.freeze({
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000, jitter: 0.5 },
  removeOnComplete: { age: 86_400, count: 10_000 },
  removeOnFail: { age: 7 * 86_400 },
} as const satisfies JobsOptions);

export type VerificationQueueOptions =
  { queue: JobQueue<ProcessVerificationJob> } | BullQueueOptions;

export interface ClosableVerificationQueue extends VerificationQueue {
  close(): Promise<void>;
}

/** The producer side of `process-verification`, over BullMQ or an injected queue. */
export function createVerificationQueue(
  options: VerificationQueueOptions,
): ClosableVerificationQueue {
  const queue =
    'queue' in options
      ? options.queue
      : createBullQueue<ProcessVerificationJob>(PROCESS_VERIFICATION_QUEUE, options);
  return {
    async enqueueProcessVerification({ environmentId, verificationId }) {
      if (!isId('env', environmentId) || !isId('ver', verificationId)) {
        throw new TypeError('process-verification jobs need an env_ and a ver_ id');
      }
      await queue.add(
        PROCESS_VERIFICATION_JOB,
        { environmentId, verificationId },
        { ...PROCESS_VERIFICATION_JOB_OPTIONS, jobId: verificationId },
      );
    },
    close: () => queue.close(),
  };
}
