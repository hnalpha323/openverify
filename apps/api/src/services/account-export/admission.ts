/**
 * C251.1 (Workflow 11B, `dsar-export`): the admission of an export just created, after the create's
 * commit: its `admitted_at` stamped, then its `account-export` job enqueued under its own id; an
 * enqueue that fails clears the stamp again, so the export is held (still `pending`) for the fair
 * sweep.
 *
 * integration-11b: admitted through quotas' `admitEnvironment` over `queueRowsOf('account-export')`,
 * oldest held export first, under the environment's account-export cap (C251.1); at the cap, or
 * when the enqueue fails, the export stays pending and unstamped for the worker's quota sweep.
 * Without a producer nothing is enqueued.
 */
import { QUEUE_IN_FLIGHT_CAP } from '@openverify/contracts';
import type { Db } from '@openverify/db';
import type { AccountExportQueue } from '../../jobs/account-export-queues.js';
import type { Clock } from '../../ports.js';
import { admitEnvironment } from '../quotas/admission.js';
import { createQuotaAdmissionDeps, queueRowsOf } from '../quotas/queue-rows.js';

/** What admission needs. */
export interface AccountExportAdmissionDeps {
  db: Db;
  clock: Clock;
  producer?: AccountExportQueue | undefined;
  /** C251.2: the install's ceiling (`OPENVERIFY_QUEUE_IN_FLIGHT_CAP_MAX`); absent, 50. */
  queueInFlightCapMax?: number | undefined;
}

/** The service's `admit` over the rows and the producer, under the environment's cap (C251.1). */
export function createAccountExportAdmission(
  deps: AccountExportAdmissionDeps,
): (environmentId: string, exportId: string) => Promise<void> {
  return async (environmentId) => {
    const { producer } = deps;
    if (producer === undefined) {
      return;
    }
    await admitEnvironment(
      createQuotaAdmissionDeps({
        db: deps.db,
        clock: deps.clock,
        logger: SILENT_LOGGER,
        limits: { ceiling: deps.queueInFlightCapMax ?? QUEUE_IN_FLIGHT_CAP.ceilingDefault },
      }),
      queueRowsOf('account-export'),
      (job) => producer.enqueueAccountExport(job),
      environmentId,
    );
  };
}

/** The request's admission logs nothing: the worker's quota sweep logs the queue's metrics. */
const SILENT_LOGGER = { info: () => undefined, warn: () => undefined, error: () => undefined };
