/**
 * C251.1, C251.4 (Phase 11, Workflow 11B Stage 2, `quotas`; decision 38, review F12, review H12): one
 * admission model over every queue that holds one environment's work, generalised from Phase 8's
 * workflow-step slots (C117.8; BullMQ's group fairness is commercial, so fairness is here).
 *
 * - **Admission.** A job is enqueued only while its environment has fewer than its cap of that
 *   queue's jobs queued or running, counted from the queue's own rows (`admitted_at`, or the
 *   `enqueued_at` an outbox already stamps), with no counter and no hot row. Admitting takes the
 *   environment's slot lock for the queue (so two producers of one environment cannot both take the
 *   last slot), counts, claims the oldest held rows up to the room left (`FOR UPDATE SKIP LOCKED`),
 *   stamps them and commits; the jobs are enqueued after the commit. A held row simply waits in its
 *   own `pending` or outbox state: nothing changes on the API (C251.3).
 * - **The fair sweep.** Every tick, each queue's environments with held work are taken in turn by
 *   their slot's `last_served_at` (never served first, then the longest unserved), and each is
 *   admitted up to its room. The visit is the environment's turn, admitted or not (Phase 8's R004),
 *   so a capped flooder goes to the back and never holds the head of the window. Only the sweep
 *   writes `last_served_at`: a producer that wrote it would make the slot a hot row.
 * - **A failed enqueue** releases its row (the stamp is cleared), so the next tick admits it again.
 * - **Lost work.** An admitted row whose enqueue after the commit was lost has no job; a recovery
 *   pass re-enqueues each admitted, unfinished row older than a grace period under the row's own
 *   BullMQ job id, so a job still waiting or running is not doubled. A held row is never enqueued by
 *   it (C251.1: the cap holds it back; the sweep admits it).
 * - **Metrics** (C251.4, C250.7): structured log events with a stable `metric`, a `value` and the
 *   labels `environmentId` and `queue` (never PII): in-flight and cap for each environment the sweep
 *   visits, the longest admission wait it ended, and a warn line when an environment with held work
 *   sits at its cap for more than five minutes.
 *
 * Honesty (C251.6): caps bound how much of the worker one tenant can hold; they add no capacity, and
 * a cap set too low delays that tenant's own work.
 */
import type { CappedQueue } from '@openverify/contracts';
import type { Db } from '@openverify/db';
import type { WorkerLogger } from '../../jobs/logger.js';
import { metrics } from '../../metrics-registry.js';
import type { Clock } from '../../ports.js';
import type { AtCapWatch } from './at-cap.js';

/** C251.4, C250.7: the metric names the sweep logs (registered in `metrics-registry.ts`). */
export const QUOTA_METRICS = Object.freeze({
  /** Admitted and unfinished jobs of one environment and queue, read at the sweep's visit. */
  inFlight: 'queue_in_flight',
  /** The cap in force for that environment and queue (C251.2). */
  cap: 'queue_in_flight_cap',
  /** The longest time a row the visit admitted had been held, in milliseconds. */
  admissionWait: 'queue_admission_wait_ms',
  /** The warn line: how long an environment with held work has sat at its cap, in milliseconds. */
  atCap: 'queue_at_cap_ms',
} as const);

/** C117.8's window: environments a sweep tick visits per queue, at most (Phase 8's 500). */
export const QUOTA_SWEEP_ENVIRONMENT_LIMIT = 500;
/** Rows a recovery pass re-enqueues per queue, at most (the repair sweep's batch). */
export const QUOTA_RECOVERY_LIMIT = 500;

/** A held row: its id, since when it waits, and the job admitting it enqueues. */
export interface HeldRow<J> {
  readonly id: string;
  readonly heldSince: Date;
  readonly job: J;
}

/**
 * One capped queue's rows, as admission sees them. Each implementation is SQL over the queue's own
 * table (`packages/db/src/repositories/queue-slots.ts`); a transaction argument is the admission's.
 */
export interface QueueRows<J> {
  readonly queue: CappedQueue;
  /** Admitted (or stamped) and unfinished rows of the environment: the slot count. */
  countInFlight(tx: Db, environmentId: string): Promise<number>;
  /** Held rows, oldest first, at most `limit`, locked `FOR UPDATE SKIP LOCKED`. */
  claimHeld(tx: Db, environmentId: string, limit: number): Promise<readonly HeldRow<J>[]>;
  markAdmitted(tx: Db, environmentId: string, ids: readonly string[], at: Date): Promise<void>;
  /** Clears the stamp of rows whose enqueue failed, so they are held again. */
  release(db: Db, environmentId: string, ids: readonly string[]): Promise<void>;
  /** Environments with held rows, never served first, then by `last_served_at`, then by id. */
  listHeldEnvironments(db: Db, limit: number): Promise<readonly string[]>;
}

/** The slot of each environment and queue: its lock and its turn. */
export interface QueueSlots {
  /** Serialises admissions of one environment and queue until the transaction ends. */
  lock(tx: Db, environmentId: string, queue: CappedQueue): Promise<void>;
  /** The sweep's visit: `last_served_at = now` (the row made on first use). */
  touch(tx: Db, environmentId: string, queue: CappedQueue, now: Date): Promise<void>;
}

/** What admission needs. */
export interface AdmissionDeps {
  readonly db: Db;
  readonly clock: Clock;
  readonly logger: WorkerLogger;
  readonly slots: QueueSlots;
  /** The cap in force (C251.2: the environment's setting, never above the install ceiling). */
  capOf(tx: Db, environmentId: string, queue: CappedQueue): Promise<number>;
  /** The sweep's at-cap watch (C251.4); a producer's admission passes none. */
  readonly watch?: AtCapWatch | undefined;
}

/** One environment's admission: counts and ids only. */
export interface AdmissionResult {
  readonly queue: CappedQueue;
  readonly environmentId: string;
  /** Admitted and unfinished before this admission. */
  readonly inFlight: number;
  readonly cap: number;
  /** Rows admitted and enqueued, oldest first. */
  readonly admitted: readonly string[];
  /** Rows admitted whose enqueue failed; each was held again. */
  readonly failed: readonly string[];
}

interface Claimed<J> {
  readonly inFlight: number;
  readonly cap: number;
  readonly held: readonly HeldRow<J>[];
}

function metric(
  logger: WorkerLogger,
  name: string,
  value: number,
  labels: { environmentId: string; queue: CappedQueue },
): void {
  metrics.emit(logger, name, value, labels);
}

/**
 * Admits an environment's held rows of one queue, oldest first, up to its cap, and enqueues their
 * jobs after the commit. A producer calls it right after writing its row (the row is held until
 * this admits it); the sweep calls it with `rotate`, which also takes the environment's turn and
 * logs the metrics.
 */
export async function admitEnvironment<J>(
  deps: AdmissionDeps,
  rows: QueueRows<J>,
  enqueue: (job: J) => Promise<void>,
  environmentId: string,
  options: { readonly rotate?: boolean } = {},
): Promise<AdmissionResult> {
  const { queue } = rows;
  const rotate = options.rotate === true;
  const now = deps.clock.now();
  const claimed = await deps.db.transaction(async (tx): Promise<Claimed<J>> => {
    await deps.slots.lock(tx, environmentId, queue);
    if (rotate) {
      await deps.slots.touch(tx, environmentId, queue, now);
    }
    const cap = await deps.capOf(tx, environmentId, queue);
    const inFlight = await rows.countInFlight(tx, environmentId);
    const room = cap - inFlight;
    if (room <= 0) {
      return { inFlight, cap, held: [] };
    }
    const held = await rows.claimHeld(tx, environmentId, room);
    if (held.length > 0) {
      await rows.markAdmitted(
        tx,
        environmentId,
        held.map(({ id }) => id),
        now,
      );
    }
    return { inFlight, cap, held };
  });
  const labels = { environmentId, queue };
  if (rotate) {
    metric(deps.logger, QUOTA_METRICS.inFlight, claimed.inFlight, labels);
    metric(deps.logger, QUOTA_METRICS.cap, claimed.cap, labels);
    if (claimed.held.length > 0) {
      const waited = Math.max(
        ...claimed.held.map((row) => now.getTime() - row.heldSince.getTime()),
      );
      metric(deps.logger, QUOTA_METRICS.admissionWait, waited, labels);
    }
    const warning = deps.watch?.observe({
      environmentId,
      queue,
      inFlight: claimed.inFlight + claimed.held.length,
      cap: claimed.cap,
    });
    if (warning !== undefined && warning !== null) {
      metric(deps.logger, QUOTA_METRICS.atCap, warning.atCapMs, labels);
      deps.logger.warn(
        { ...labels, inFlight: warning.inFlight, cap: warning.cap, atCapMs: warning.atCapMs },
        'environment at its queue in-flight cap for more than five minutes',
      );
    }
  }
  const admitted: string[] = [];
  const failed: string[] = [];
  for (const row of claimed.held) {
    try {
      await enqueue(row.job);
      admitted.push(row.id);
    } catch (error) {
      failed.push(row.id);
      deps.logger.warn(
        { queue, environmentId, id: row.id, error: (error as Error).name },
        'admitted job not enqueued; held again',
      );
    }
  }
  if (failed.length > 0) {
    await rows.release(deps.db, environmentId, failed);
  }
  return { queue, environmentId, inFlight: claimed.inFlight, cap: claimed.cap, admitted, failed };
}

/** One sweep tick over one queue: counts only. */
export interface QueueSweepResult {
  readonly queue: CappedQueue;
  /** Environments visited. */
  readonly environments: number;
  readonly admitted: number;
  readonly failed: number;
}

/**
 * C251.1's fair sweep of one queue: every environment with held rows, never served first, then the
 * longest unserved, at most `environmentLimit` a tick, each admitted up to its room. The at-cap watch
 * forgets every environment of the queue this tick did not visit (nothing of it waits any more).
 */
export async function sweepQueue<J>(
  deps: AdmissionDeps,
  rows: QueueRows<J>,
  enqueue: (job: J) => Promise<void>,
  options: { readonly environmentLimit?: number } = {},
): Promise<QueueSweepResult> {
  const environments = await rows.listHeldEnvironments(
    deps.db,
    options.environmentLimit ?? QUOTA_SWEEP_ENVIRONMENT_LIMIT,
  );
  let admitted = 0;
  let failed = 0;
  for (const environmentId of environments) {
    const result = await admitEnvironment(deps, rows, enqueue, environmentId, { rotate: true });
    admitted += result.admitted.length;
    failed += result.failed.length;
  }
  deps.watch?.retain(rows.queue, new Set(environments));
  return { queue: rows.queue, environments: environments.length, admitted, failed };
}

/** An admitted row whose job may have been lost. */
export interface LostRow<J> {
  readonly environmentId: string;
  readonly id: string;
  readonly job: J;
}

/** A queue's admitted, unfinished rows admitted before a time (never a held one). */
export interface LostRows<J> {
  readonly queue: CappedQueue;
  listLost(db: Db, options: { before: Date; limit: number }): Promise<readonly LostRow<J>[]>;
}

/** One recovery pass: counts only. */
export interface RecoveryResult {
  readonly queue: CappedQueue;
  readonly selected: number;
  readonly enqueued: number;
  readonly failed: number;
}

/**
 * Re-enqueues each admitted, unfinished row admitted more than `graceMs` ago (the pattern of Phase
 * 5's repair sweep, `jobs/repeatable/submitted-verifications.ts`), under its own job id, so a job
 * still waiting or running is one job. A failed enqueue is logged by id and tried on the next pass.
 */
export async function recoverLostWork<J>(
  deps: Pick<AdmissionDeps, 'db' | 'clock' | 'logger'>,
  rows: LostRows<J>,
  enqueue: (job: J) => Promise<void>,
  options: { readonly graceMs: number; readonly limit?: number },
): Promise<RecoveryResult> {
  const { queue } = rows;
  const before = new Date(deps.clock.now().getTime() - options.graceMs);
  const lost = await rows.listLost(deps.db, {
    before,
    limit: options.limit ?? QUOTA_RECOVERY_LIMIT,
  });
  let failed = 0;
  for (const row of lost) {
    try {
      await enqueue(row.job);
    } catch (error) {
      failed += 1;
      deps.logger.error(
        { queue, environmentId: row.environmentId, id: row.id, error: (error as Error).name },
        'admitted work not enqueued again',
      );
    }
  }
  if (lost.length > 0) {
    deps.logger.info({ queue, selected: lost.length, failed }, 'admitted work enqueued again');
  }
  return { queue, selected: lost.length, enqueued: lost.length - failed, failed };
}
