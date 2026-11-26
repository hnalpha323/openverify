/**
 * C251.1 (Phase 11, Workflow 11B Stage 2, `quotas`): the admission engine's stores over Postgres, for
 * the capped queues whose rows this release admits (`ADMISSION_ROW_QUEUES` of `@openverify/db`), and
 * the worker's quota passes over their producers.
 *
 * - `postgresQueueSlots`: the slot lock and the sweep's turn on `queue_slots`.
 * - `queueRowsOf(queue)`: the queue's `QueueRows` (in flight, held, stamp, release, environments);
 *   `lostRowsOf(queue)`: its admitted rows whose job may have been lost.
 * - `createQuotaAdmissionDeps`: the admission's dependencies with the cap in force (C251.2) and the
 *   at-cap watch (C251.4).
 * - `quotaQueuePasses(producers)`: one pass per queue the worker holds a producer for. The sweep
 *   enqueues through the UNWRAPPED producers (foundation-11b amendment 13): a wrapped one would ask
 *   the admission again. `process-verification` and `report-run` have no lost-work pass here: Phase
 *   5's repair sweep and Phase 6's report sweep re-enqueue their admitted rows (C251.1).
 */
import type { CappedQueue } from '@openverify/contracts';
import {
  ADMISSION_ROW_QUEUES,
  claimHeldQueueRows,
  countQueueInFlight,
  listHeldQueueEnvironments,
  listLostQueueRows,
  lockQueueSlot,
  markQueueRowsAdmitted,
  releaseQueueRows,
  touchQueueSlot,
  type AdmissionRowQueue,
  type Db,
  type QueueRowRef,
} from '@openverify/db';
import type { AccountExportJob, AccountExportQueue } from '../../jobs/account-export-queues.js';
import type { ConnectRedeemJob, ConnectRedeemQueue } from '../../jobs/connect-queues.js';
import type { WorkerLogger } from '../../jobs/logger.js';
import { quotaQueuePass, type QuotaQueuePass } from '../../jobs/quota-sweep.js';
import type {
  Clock,
  IntegrityDecodeJob,
  IntegrityDecodeQueue,
  ProcessVerificationJob,
  ReportRunJob,
  ReportRunQueue,
  VerificationQueue,
} from '../../ports.js';
import type { AdmissionDeps, LostRows, QueueRows, QueueSlots } from './admission.js';
import { createAtCapWatch } from './at-cap.js';
import { createCapOf } from './cap-of.js';
import type { InstallQueueLimits } from './caps.js';

/** The job each admitted queue's row enqueues. */
export interface AdmissionJobs {
  'process-verification': ProcessVerificationJob;
  'report-run': ReportRunJob;
  'connect-redeem': ConnectRedeemJob;
  'account-export': AccountExportJob;
  'integrity-decode': IntegrityDecodeJob;
}

/** A queue's job from its row. */
export function admissionJobOf<Q extends AdmissionRowQueue>(
  queue: Q,
  row: QueueRowRef,
): AdmissionJobs[Q] {
  const { environmentId, id } = row;
  const jobs: { [K in AdmissionRowQueue]: () => AdmissionJobs[K] } = {
    'process-verification': () => ({ environmentId, verificationId: id }),
    'report-run': () => ({ environmentId, reportId: row.extra ?? '', runId: id }),
    'connect-redeem': () => ({ environmentId, shareTokenId: id }),
    'account-export': () => ({ environmentId, exportId: id }),
    'integrity-decode': () => ({ environmentId, challengeId: id }),
  };
  return jobs[queue]();
}

/** The slots of `queue_slots`. */
export const postgresQueueSlots: QueueSlots = {
  lock: (tx, environmentId, queue) => lockQueueSlot(tx, environmentId, queue),
  touch: (tx, environmentId, queue, now) => touchQueueSlot(tx, environmentId, queue, now),
};

/** Whether `queue` is one whose rows this release admits. */
export function isAdmissionRowQueue(queue: string): queue is AdmissionRowQueue {
  return (ADMISSION_ROW_QUEUES as readonly string[]).includes(queue);
}

/** `queue`'s rows as the admission engine sees them. */
export function queueRowsOf<Q extends AdmissionRowQueue>(queue: Q): QueueRows<AdmissionJobs[Q]> {
  return {
    queue: queue satisfies CappedQueue,
    countInFlight: (tx: Db, environmentId) => countQueueInFlight(tx, queue, environmentId),
    claimHeld: async (tx, environmentId, limit) =>
      (await claimHeldQueueRows(tx, queue, environmentId, limit)).map((row) => ({
        id: row.id,
        heldSince: row.since,
        job: admissionJobOf(queue, row),
      })),
    markAdmitted: (tx, environmentId, ids, at) =>
      markQueueRowsAdmitted(tx, queue, environmentId, ids, at),
    release: (db, environmentId, ids) => releaseQueueRows(db, queue, environmentId, ids),
    listHeldEnvironments: (db, limit) => listHeldQueueEnvironments(db, queue, limit),
  };
}

/** `queue`'s admitted rows whose job may have been lost. */
export function lostRowsOf<Q extends AdmissionRowQueue>(queue: Q): LostRows<AdmissionJobs[Q]> {
  return {
    queue,
    listLost: async (db, options) =>
      (await listLostQueueRows(db, queue, options)).map((row) => ({
        environmentId: row.environmentId,
        id: row.id,
        job: admissionJobOf(queue, row),
      })),
  };
}

/** The admission's dependencies over Postgres, the install's limits and a fresh at-cap watch. */
export function createQuotaAdmissionDeps(input: {
  db: Db;
  clock: Clock;
  logger: WorkerLogger;
  limits: InstallQueueLimits;
}): AdmissionDeps {
  return {
    db: input.db,
    clock: input.clock,
    logger: input.logger,
    slots: postgresQueueSlots,
    capOf: createCapOf(input.limits),
    watch: createAtCapWatch(input.clock),
  };
}

/** The producers the worker's quota passes enqueue through: never the admission-wrapped ones. */
export interface QuotaProducers {
  verifications?: VerificationQueue | undefined;
  reportRuns?: ReportRunQueue | undefined;
  connectRedeems?: ConnectRedeemQueue | undefined;
  accountExports?: AccountExportQueue | undefined;
  integrityDecodes?: IntegrityDecodeQueue | undefined;
}

/**
 * One pass per queue with a producer, in `ADMISSION_ROW_QUEUES` order. `connect-redeem`,
 * `account-export` and `integrity-decode` also recover lost work (KP11-17, KP10-27); the other two
 * are recovered by their own sweeps.
 */
export function quotaQueuePasses(producers: QuotaProducers): QuotaQueuePass[] {
  const passes: QuotaQueuePass[] = [];
  const { verifications, reportRuns, connectRedeems, accountExports, integrityDecodes } = producers;
  if (verifications !== undefined) {
    passes.push(
      quotaQueuePass({
        rows: queueRowsOf('process-verification'),
        enqueue: (job) => verifications.enqueueProcessVerification(job),
      }),
    );
  }
  if (reportRuns !== undefined) {
    passes.push(
      quotaQueuePass({
        rows: queueRowsOf('report-run'),
        enqueue: (job) => reportRuns.enqueueReportRun(job),
      }),
    );
  }
  if (connectRedeems !== undefined) {
    passes.push(
      quotaQueuePass({
        rows: queueRowsOf('connect-redeem'),
        lost: lostRowsOf('connect-redeem'),
        enqueue: (job) => connectRedeems.enqueueConnectRedeem(job),
      }),
    );
  }
  if (accountExports !== undefined) {
    passes.push(
      quotaQueuePass({
        rows: queueRowsOf('account-export'),
        lost: lostRowsOf('account-export'),
        enqueue: (job) => accountExports.enqueueAccountExport(job),
      }),
    );
  }
  if (integrityDecodes !== undefined) {
    passes.push(
      quotaQueuePass({
        rows: queueRowsOf('integrity-decode'),
        lost: lostRowsOf('integrity-decode'),
        enqueue: (job) => integrityDecodes.enqueueIntegrityDecode(job),
      }),
    );
  }
  return passes;
}
