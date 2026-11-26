/**
 * Workflow 5C review K1: the repair sweep of verifications left `submitted` without a job. A
 * verification a decision hook creates (the silent AAMVA attempt, C59.6) is enqueued after the
 * decision commits; when that enqueue fails (Valkey briefly unreachable) nothing else would ever
 * enqueue it, so it would wait in `submitted` and its inquiry would never settle. Every minute,
 * the sweep enqueues each verification submitted more than two minutes ago and still
 * `submitted`, under the verification's own BullMQ job id (`jobs/index.ts`), so a verification
 * whose job is still waiting, delayed or running is not enqueued twice.
 *
 * C251.1 (Workflow 11B, quotas' named borrowed edit; review F12): only an ADMITTED verification is
 * enqueued again, once two minutes have passed since its admission; one the per-environment cap
 * holds back (`admitted_at` null) is never enqueued here: the fair sweep admits it when a slot frees.
 */
import { listLostQueueRows } from '@openverify/db';
import type { VerificationQueue } from '../../ports.js';
import type { RepeatableJob } from '../../worker.js';
import type { RepeatableJobDeps } from './index.js';

/** The job's name, which is also its queue's and its scheduler's. */
export const SUBMITTED_VERIFICATION_SWEEP_QUEUE = 'submitted-verification-sweep';

/** How often the sweep runs. */
export const SUBMITTED_VERIFICATION_SWEEP_INTERVAL_MS = 60_000;

/** How long after its submission a verification still `submitted` is taken to have no job. */
export const SUBMITTED_VERIFICATION_GRACE_MS = 2 * 60_000;

/** Verifications one run enqueues again, at most (the next run takes the rest). */
export const SUBMITTED_VERIFICATION_SWEEP_LIMIT = 500;

export interface SubmittedVerificationSweepResult {
  /** Verifications found `submitted` past the grace period. */
  readonly selected: number;
  readonly enqueued: number;
  /** Enqueues that failed this run; each is logged and tried again on the next run. */
  readonly failed: number;
}

/** The sweep over `queue` (`process-verification`). */
export function submittedVerificationSweepJob(
  deps: RepeatableJobDeps,
  queue: VerificationQueue,
): RepeatableJob {
  return {
    name: SUBMITTED_VERIFICATION_SWEEP_QUEUE,
    repeat: { every: SUBMITTED_VERIFICATION_SWEEP_INTERVAL_MS },
    run: async (): Promise<SubmittedVerificationSweepResult> => {
      const before = new Date(deps.clock.now().getTime() - SUBMITTED_VERIFICATION_GRACE_MS);
      const stale = await listLostQueueRows(deps.db, 'process-verification', {
        before,
        limit: SUBMITTED_VERIFICATION_SWEEP_LIMIT,
      });
      let failed = 0;
      for (const { environmentId, id } of stale) {
        try {
          await queue.enqueueProcessVerification({ environmentId, verificationId: id });
        } catch (error) {
          failed += 1;
          deps.logger.error(
            {
              queue: SUBMITTED_VERIFICATION_SWEEP_QUEUE,
              environmentId,
              verificationId: id,
              error: (error as Error).name,
            },
            'submitted verification not re-enqueued',
          );
        }
      }
      if (stale.length > 0) {
        deps.logger.info(
          { queue: SUBMITTED_VERIFICATION_SWEEP_QUEUE, selected: stale.length, failed },
          'submitted verifications enqueued again',
        );
      }
      return { selected: stale.length, enqueued: stale.length - failed, failed };
    },
  };
}
