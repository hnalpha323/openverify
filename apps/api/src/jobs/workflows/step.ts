/** C117.3: the `workflow-step` and `workflow-step-batch` processor. */
import type { WorkflowStepJob } from '../../ports.js';
import { runStepJob } from '../../workflows/engine/executor.js';
import { engineDepsOf } from '../../workflows/engine/worker-deps.js';
import type { WorkflowWorkerDeps } from '../../workflows/worker.js';

export const processWorkflowStep = (
  job: WorkflowStepJob,
  deps: WorkflowWorkerDeps,
): Promise<void> => runStepJob(engineDepsOf(deps), job);
