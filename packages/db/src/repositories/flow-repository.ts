/**
 * Workflow 9A's repository stubs: `foundation-9a` (Stage 1b (S)) froze each name, and the agent a
 * file names builds it. A builder may widen a stub's signature while nothing calls it.
 */

/** The Stage 3 agent that builds a stub. */
export type FlowRepositoryOwner = 'api-flow-engine' | 'api-flow-actions' | 'api-templates';

/** A stub of Workflow 9A's repositories: its owner has not built it yet. */
export class FlowRepositoryNotBuiltError extends Error {
  override name = 'FlowRepositoryNotBuiltError';

  /** How many arguments the stub was called with (never their values). */
  readonly inputs: number;

  constructor(name: string, owner: FlowRepositoryOwner, inputs = 0) {
    super(`${name} is not built yet (${owner})`);
    this.inputs = inputs;
  }
}

/** Rejects with {@link FlowRepositoryNotBuiltError}: a stub's whole body, given its inputs. */
export const flowRepositoryNotBuilt = (
  name: string,
  owner: FlowRepositoryOwner,
  ...inputs: readonly unknown[]
): Promise<never> => Promise.reject(new FlowRepositoryNotBuiltError(name, owner, inputs.length));
