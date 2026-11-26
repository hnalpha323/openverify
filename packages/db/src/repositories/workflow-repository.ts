/**
 * Workflow 8A's repository stubs: `foundation-8a` (Stage 1b (E)) froze each signature, and the agent
 * a file names builds it.
 */

/** The Stage 3 agent that builds a stub. */
export type WorkflowRepositoryOwner =
  'api-engine' | 'api-workflows' | 'api-triggers' | 'api-actions' | 'api-egress';

/** A stub of Workflow 8A's repositories: its owner has not built it yet. */
export class WorkflowRepositoryNotBuiltError extends Error {
  override name = 'WorkflowRepositoryNotBuiltError';

  constructor(name: string, owner: WorkflowRepositoryOwner) {
    super(`${name} is not built yet (${owner})`);
  }
}

/** Rejects with {@link WorkflowRepositoryNotBuiltError}: a stub's whole body. */
export const workflowRepositoryNotBuilt = (
  name: string,
  owner: WorkflowRepositoryOwner,
): Promise<never> => Promise.reject(new WorkflowRepositoryNotBuiltError(name, owner));
