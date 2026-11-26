/**
 * C127.12 (V03): the `list-rescreen` job and the `list-rescreen-sweep`. The job inserts one
 * `list_update` run for every monitored custom-list report that selects the list, keyed by report,
 * list and version, and the report sweep runs them; the sweep here is the outbox. A watchlist's
 * `list_update` path (`trigger_sync_id`) is untouched.
 */
import {
  finishListRescreenRequest,
  insertListRescreenRuns,
  listDueListRescreenRequests,
  listMonitoredCustomListReports,
  markListRescreenRequestEnqueued,
  type Db,
} from '@openverify/db';
import type { ListRescreenJob, ListRescreenQueue } from '../../ports.js';
import type { WorkerLogger } from '../logger.js';

export interface ListRescreenDeps {
  db: Db;
  logger: WorkerLogger;
  rescreens: ListRescreenQueue;
}

/** The rows one tick reads, as every sweep does. */
const SWEEP_BATCH = 500;

export async function processListRescreen(
  job: ListRescreenJob,
  { db, logger }: ListRescreenDeps,
): Promise<void> {
  const { environmentId, listId, listVersion } = job;
  const reportIds = await listMonitoredCustomListReports(db, environmentId, listId);
  const at = new Date();
  const inserted = await db.transaction(async (tx) => {
    const runs = await insertListRescreenRuns(tx, environmentId, {
      listId,
      listVersion,
      reportIds,
      at,
    });
    await finishListRescreenRequest(tx, environmentId, { listId, listVersion }, at);
    return runs;
  });
  logger.info({ environmentId, listId, listVersion, inserted }, 'list re-screen runs inserted');
}

export async function runListRescreenSweep({ db, rescreens }: ListRescreenDeps): Promise<void> {
  const now = new Date();
  const due = await db.transaction(async (tx) => {
    const rows = await listDueListRescreenRequests(tx, { now, limit: SWEEP_BATCH });
    for (const { environmentId, listId, listVersion } of rows) {
      await markListRescreenRequestEnqueued(tx, environmentId, { listId, listVersion }, now);
    }
    return rows;
  });
  for (const { environmentId, listId, listVersion } of due) {
    await rescreens.enqueueListRescreen({ environmentId, listId, listVersion });
  }
}
