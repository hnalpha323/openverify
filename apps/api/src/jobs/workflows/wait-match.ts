/** C119.3: the `workflow-wait-match` processor. */
import type { WorkflowWaitMatchJob } from '../../ports.js';
import { dispatchEnvironment } from '../../workflows/engine/dispatcher.js';
import { matchWaitCandidate } from '../../workflows/engine/wait-resolution.js';
import { engineDepsOf } from '../../workflows/engine/worker-deps.js';
import type { WorkflowWorkerDeps } from '../../workflows/worker.js';

export async function processWorkflowWaitMatch(
  job: WorkflowWaitMatchJob,
  deps: WorkflowWorkerDeps,
): Promise<void> {
  const engine = engineDepsOf(deps);
  if (await matchWaitCandidate(engine, job)) {
    await dispatchEnvironment(engine, job.environmentId);
  }
}
