/**
 * C99.4, C107.1 (Workflow 7B): the `list-screen-sweep`, every 15 s. Owner: `api-lists`. It enqueues
 * the pending screenings not enqueued within {@link LIST_SCREEN_REENQUEUE_AFTER_MS}, so a lost
 * enqueue recovers; the job id is the inquiry id, so a job still waiting is never added twice. The
 * row of an inquiry redacted after it was written ends `errored`, never enqueued (owner decision 5
 * after Workflow 6C).
 */
import {
  failListScreening,
  listPendingListScreenings,
  markListScreeningsEnqueued,
  type Db,
} from '@openverify/db';
import type { Clock, ListScreenQueue } from '../../ports.js';
import type { WorkerLogger } from '../logger.js';

/** A row enqueued this recently is left to its job. */
export const LIST_SCREEN_REENQUEUE_AFTER_MS = 2 * 60_000;
/** The rows one tick takes, oldest first. */
export const LIST_SCREEN_SWEEP_LIMIT = 500;

export interface ListScreenSweepDeps {
  db: Db;
  clock: Clock;
  logger: WorkerLogger;
  screens: ListScreenQueue;
}

export type RunListScreenSweep = (deps: ListScreenSweepDeps) => Promise<void>;

export const runListScreenSweep: RunListScreenSweep = async ({ db, clock, logger, screens }) => {
  const now = clock.now();
  const rows = await listPendingListScreenings(db, {
    olderThan: new Date(now.getTime() - LIST_SCREEN_REENQUEUE_AFTER_MS),
    limit: LIST_SCREEN_SWEEP_LIMIT,
  });
  const enqueued: { environmentId: string; inquiryId: string }[] = [];
  let ended = 0;
  for (const { environmentId, inquiryId, inquiryRedacted } of rows) {
    if (inquiryRedacted) {
      await failListScreening(db, environmentId, inquiryId, { code: 'inquiry_redacted', at: now });
      ended += 1;
      continue;
    }
    await screens.enqueueListScreen({ environmentId, inquiryId });
    enqueued.push({ environmentId, inquiryId });
  }
  await markListScreeningsEnqueued(db, enqueued, now);
  if (enqueued.length > 0 || ended > 0) {
    logger.info({ enqueued: enqueued.length, ended }, 'list screen sweep');
  }
};
