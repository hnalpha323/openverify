/**
 * Workflow 8B's repository stubs: `foundation-8b` (Stage 1b (C)) froze each name, and the agent a
 * file names builds it. A builder may widen a stub's signature while nothing calls it.
 */

/** The Stage 3 agent that builds a stub. */
export type CaseRepositoryOwner =
  'api-cases' | 'api-queues-sla' | 'api-case-files' | 'api-case-workflows';

/** A stub of Workflow 8B's repositories: its owner has not built it yet. */
export class CaseRepositoryNotBuiltError extends Error {
  override name = 'CaseRepositoryNotBuiltError';

  constructor(name: string, owner: CaseRepositoryOwner) {
    super(`${name} is not built yet (${owner})`);
  }
}

/** Rejects with {@link CaseRepositoryNotBuiltError}: a stub's whole body. */
export const caseRepositoryNotBuilt = (name: string, owner: CaseRepositoryOwner): Promise<never> =>
  Promise.reject(new CaseRepositoryNotBuiltError(name, owner));
