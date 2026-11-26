/**
 * What the engine reads, in the worker and in the API: the run routes (cancel, resume, rerun) and the
 * trigger routes start and end runs too, so nothing here needs a worker. A process with no step
 * producer leaves a run a route starts to the 15 s sweep (`workflow-step-sweep`).
 */
import type { Db } from '@openverify/db';
import { sql } from 'drizzle-orm';
import type { TransactionalEventPublisher } from '../../events/index.js';
import type { WorkerLogger } from '../../jobs/logger.js';
import type { Clock, IdGenerator, WorkflowStepQueue } from '../../ports.js';
import type { WorkflowServices } from '../services.js';
import type { EngineActions } from './action-port.js';

export interface EngineDeps {
  db: Db;
  clock: Clock;
  ids: IdGenerator;
  events: TransactionalEventPublisher;
  /** Without it the sweep enqueues what is ready. */
  steps?: WorkflowStepQueue | undefined;
  actions: EngineActions;
  inFlightCap?: number | undefined;
  /** C251.2 (Workflow 11B): `OPENVERIFY_QUEUE_IN_FLIGHT_CAP_MAX`, the ceiling of every cap. */
  queueInFlightCapMax?: number | undefined;
  /** C117.4: test seam; a third of the lease otherwise. */
  heartbeatMs?: number | undefined;
  /** What a handler reaches; only the worker runs handlers. */
  services?: WorkflowServices | undefined;
  /** C117.11: ids, node ids, action keys, attempts and lag, never a value. */
  logger?: Pick<WorkerLogger, 'info' | 'warn'> | undefined;
}

/**
 * C119.2: the database's clock, so a due time and the sweep that reads it never disagree. Inside a
 * transaction it is the transaction's start, as `now()` is.
 */
export async function databaseNow(db: Db): Promise<Date> {
  const result = await db.execute(sql`select now() as now`);
  const [row] = (result as { rows: { now: Date | string }[] }).rows;
  return row === undefined ? new Date() : new Date(row.now);
}
