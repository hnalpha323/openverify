/**
 * C117, C143.2: what the engine's jobs read, and the engine's start. Owner: `api-engine`;
 * `foundation-8a` wired it into `worker.ts` and froze these names. The worker binds the `workflow-step`,
 * `workflow-step-batch`, `workflow-trigger` and `workflow-wait-match` queues to their processors.
 */
import type { Db } from '@openverify/db';
import type { WorkerLogger } from '../jobs/logger.js';
import type {
  Clock,
  WorkflowStepQueue,
  WorkflowTriggerQueue,
  WorkflowWaitMatchQueue,
} from '../ports.js';
import type { EngineActions } from './engine/action-port.js';
import type { WorkflowServices } from './services.js';

/** What the engine's processors and sweeps read. */
export interface WorkflowWorkerDeps {
  db: Db;
  clock: Clock;
  logger: WorkerLogger;
  /** Built once by `createWorkflowServices` (F11). */
  services: WorkflowServices;
  steps: WorkflowStepQueue;
  triggers: WorkflowTriggerQueue;
  waitMatches: WorkflowWaitMatchQueue;
  /** C122.1: the catalogue and its handlers; the process's own when left out. */
  actions?: EngineActions;
  /** C117.8: `OPENVERIFY_WORKFLOW_IN_FLIGHT_CAP`, which an environment's setting overrides. */
  inFlightCap?: number;
  /** C117.4: a test's heartbeat; a third of the lease otherwise. */
  heartbeatMs?: number | undefined;
}
