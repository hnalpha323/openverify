/** C143.1: the engine's two sweeps. */
import { sweepWaitCandidates, sweepWorkflowSteps } from '../../workflows/engine/sweep.js';
import { engineDepsOf } from '../../workflows/engine/worker-deps.js';
import type { WorkflowWorkerDeps } from '../../workflows/worker.js';

/** Ready steps not enqueued, expired leases, due timers, timed-out waits and past deadlines. */
export const runWorkflowStepSweep = (deps: WorkflowWorkerDeps): Promise<void> =>
  sweepWorkflowSteps(engineDepsOf(deps));

/** The outbox behind every unprocessed `workflow_wait_candidates` row. */
export const runWorkflowWaitMatchSweep = (deps: WorkflowWorkerDeps): Promise<void> =>
  sweepWaitCandidates(engineDepsOf(deps), deps.waitMatches);
