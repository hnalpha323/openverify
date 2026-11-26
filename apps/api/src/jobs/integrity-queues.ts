/**
 * C211.3, C211.4 (Workflow 10B Stage 1b (I)): the `integrity-decode` queue and its producer.
 *
 * - `integrity-decode`: one job per challenge, its id the challenge id, enqueued by
 *   `POST /api/v1/flow/integrity-tokens` (`routes/flow/integrity.ts`, `api-integrity`) once the
 *   transaction that sealed the token commits. The worker's processor is `processIntegrityDecode`
 *   (`jobs/integrity/decode.ts`, `api-integrity`): it reads the sealed token, decodes it through the
 *   environment's bound `deviceIntegrity` provider and the outbound client (15 s, no redirects), and
 *   stores the verdict's projection; the decode never runs in a request (C211.4).
 *
 * Jobs carry ids only (never a token: C211.4, rule 11) and are removed when they complete or fail.
 * Frozen by `foundation-10b`; a change is a plan amendment.
 */
import { isId } from '@openverify/contracts';
import type { JobsOptions } from 'bullmq';
import type { IntegrityDecodeJob, IntegrityDecodeQueue } from '../ports.js';
import { createBullQueue, type BullQueueOptions, type JobQueue } from './queue.js';

export const INTEGRITY_DECODE_QUEUE = 'integrity-decode';
export const INTEGRITY_DECODE_JOB = 'integrity-decode';

/**
 * Google's endpoint or the database may hiccup, so a decode is retried with exponential backoff and
 * jitter (about 5 s, 10 s, 20 s, 40 s; provisional, as `inquiry-signals`'): all within the C16 pass's
 * day before an undecoded challenge is deleted (`INTEGRITY_CHALLENGE_RETENTION_HOURS`).
 */
export const INTEGRITY_DECODE_JOB_OPTIONS = Object.freeze({
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000, jitter: 0.5 },
  removeOnComplete: true,
  removeOnFail: true,
} as const satisfies JobsOptions);

export type ClosableIntegrityDecodeQueue = IntegrityDecodeQueue & { close(): Promise<void> };

export type IntegrityDecodeQueueOptions =
  { queue: JobQueue<IntegrityDecodeJob> } | BullQueueOptions;

/** The producer of `integrity-decode`, over BullMQ or an injected queue. */
export function createIntegrityDecodeQueue(
  options: IntegrityDecodeQueueOptions,
): ClosableIntegrityDecodeQueue {
  // Opened on first use, so a process that never enqueues opens no Valkey connection.
  let queue = 'queue' in options ? options.queue : undefined;
  return {
    async enqueueIntegrityDecode({ environmentId, challengeId }) {
      if (!isId('env', environmentId) || !isId('ich', challengeId)) {
        throw new TypeError('integrity-decode jobs need an env_ and an ich_ id');
      }
      queue ??= createBullQueue<IntegrityDecodeJob>(
        INTEGRITY_DECODE_QUEUE,
        options as BullQueueOptions,
      );
      await queue.add(
        INTEGRITY_DECODE_JOB,
        { environmentId, challengeId },
        { ...INTEGRITY_DECODE_JOB_OPTIONS, jobId: challengeId },
      );
    },
    close: () => queue?.close() ?? Promise.resolve(),
  };
}
