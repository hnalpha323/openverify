/**
 * C251.1 (Workflow 11B Stage 1b (P)): the producer's admission, called by `foundation-11b`'s hook at
 * every enqueue of a capped queue's job that the API or the worker makes after writing its row
 * (`jobs/admitted-producers.ts` wraps the `process-verification` and `report-run` producers, so every
 * enqueue site of inventory 2.6 goes through it; `workflow-step` keeps Phase 8's dispatcher over the
 * generalised `queue_slots`, and `connect-redeem` is integration-11b's, KP11-12).
 *
 * `admitOnProduce` answers whether the row's job may be enqueued now (`quotas`, Workflow 11B Stage 2):
 *
 * - under the environment's slot lock for the queue (so two producers cannot both take its last
 *   slot), a HELD row (unfinished, not admitted) is stamped `admitted_at` and answered true while the
 *   environment has fewer than its cap (C251.2) of that queue's rows in flight; at the cap it stays
 *   held, unstamped, and is answered false: the fair sweep (`jobs/quota-sweep.ts`) admits it when a
 *   slot frees, and nothing changes on the API (a held verification stays `submitted`, C251.3);
 * - an ADMITTED row is answered true, keeping its first stamp: its job goes again under its own job
 *   id (the repair and report sweeps' recovery of a lost enqueue);
 * - a row the admission cannot see (not committed yet, or another environment's) or a FINISHED one is
 *   answered true and left unstamped: its job is enqueued as before, and finds nothing to do.
 *
 * Honesty (C251.6): a cap bounds how much of the worker one environment holds; it adds no capacity.
 */
import { QUEUE_IN_FLIGHT_CAP } from '@openverify/contracts';
import {
  countQueueInFlight,
  getQueueRowState,
  lockQueueSlot,
  markQueueRowsAdmitted,
  type AdmissionRowQueue,
  type Db,
} from '@openverify/db';
import type { Clock } from '../../ports.js';
import { createCapOf } from './cap-of.js';
import type { InstallQueueLimits } from './caps.js';

/**
 * The queues whose producers ask the admission: the two `foundation-11b` wraps, and the ones whose
 * own producer calls it (`integrity-decode`, KP10-27; `connect-redeem`, KP11-12; `account-export`).
 */
export type ProducedQueue = AdmissionRowQueue;

/** A row its producer just wrote (or a sweep found), whose job waits for admission. */
export interface ProducedRow {
  queue: ProducedQueue;
  environmentId: string;
  /** The row's id: `ver_`, `rpr_`, `cnst_`, `aexp_` or `ich_`. */
  id: string;
}

export interface AdmitOnProduceDeps {
  db: Db;
  clock: Clock;
  /**
   * The install's limits (`OPENVERIFY_QUEUE_IN_FLIGHT_CAP_MAX`); absent, the contract's default
   * ceiling (50).
   */
  limits?: InstallQueueLimits | undefined;
}

/** C251.1: whether the row's job is enqueued now. */
export async function admitOnProduce(deps: AdmitOnProduceDeps, row: ProducedRow): Promise<boolean> {
  const capOf = createCapOf(deps.limits ?? { ceiling: QUEUE_IN_FLIGHT_CAP.ceilingDefault });
  const { queue, environmentId, id } = row;
  return deps.db.transaction(async (tx) => {
    await lockQueueSlot(tx, environmentId, queue);
    const state = await getQueueRowState(tx, queue, environmentId, id);
    if (state !== 'held') {
      return true;
    }
    const cap = await capOf(tx, environmentId, queue);
    if ((await countQueueInFlight(tx, queue, environmentId)) >= cap) {
      return false;
    }
    await markQueueRowsAdmitted(tx, queue, environmentId, [id], deps.clock.now());
    return true;
  });
}
