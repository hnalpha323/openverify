/**
 * C90.5, C107.1 (Workflow 7A): the `inquiry-signals-sweep`, every 15 s. Owner: `api-signals`; the
 * signature is frozen by `foundation-7a` (Stage 1b (S)). It lists the pending outbox rows not
 * enqueued within {@link INQUIRY_SIGNALS_REENQUEUE_AFTER_MS} (`listPendingSignalComputations`),
 * enqueues each on `inquiry-signals` and records it (`markSignalComputationsEnqueued`), so a lost
 * enqueue recovers; the job id is the inquiry id, so a job still waiting is never added twice. The
 * row of an inquiry redacted after it was written is marked skipped, never enqueued (owner
 * decision 5 after Workflow 6C).
 */
import {
  listPendingSignalComputations,
  markSignalComputationsEnqueued,
  skipSignalComputation,
  type Db,
} from '@openverify/db';
import type { Clock, InquirySignalsQueue } from '../../ports.js';
import type { WorkerLogger } from '../logger.js';

/** A row enqueued this recently is left to its job; an older one is enqueued again. */
export const INQUIRY_SIGNALS_REENQUEUE_AFTER_MS = 2 * 60_000;
/** The rows one tick takes, oldest first. */
export const INQUIRY_SIGNALS_SWEEP_LIMIT = 500;

export interface InquirySignalsSweepDeps {
  db: Db;
  clock: Clock;
  logger: WorkerLogger;
  /** The `inquiry-signals` producer. */
  signals: InquirySignalsQueue;
}

/** Counts only. */
export interface InquirySignalsSweepResult {
  enqueued: number;
}

export async function runInquirySignalsSweep(
  deps: InquirySignalsSweepDeps,
): Promise<InquirySignalsSweepResult> {
  const { db, clock, logger, signals } = deps;
  const now = clock.now();
  const rows = await listPendingSignalComputations(db, {
    enqueuedBefore: new Date(now.getTime() - INQUIRY_SIGNALS_REENQUEUE_AFTER_MS),
    limit: INQUIRY_SIGNALS_SWEEP_LIMIT,
  });
  const enqueued: { environmentId: string; inquiryId: string }[] = [];
  let skipped = 0;
  for (const row of rows) {
    if (row.inquiryRedacted) {
      await skipSignalComputation(db, row.environmentId, row.inquiryId, now);
      skipped += 1;
      continue;
    }
    await signals.enqueueInquirySignals({
      environmentId: row.environmentId,
      inquiryId: row.inquiryId,
    });
    enqueued.push({ environmentId: row.environmentId, inquiryId: row.inquiryId });
  }
  await markSignalComputationsEnqueued(db, enqueued, now);
  if (enqueued.length > 0 || skipped > 0) {
    logger.info({ enqueued: enqueued.length, skipped }, 'inquiry signals sweep');
  }
  return { enqueued: enqueued.length };
}
