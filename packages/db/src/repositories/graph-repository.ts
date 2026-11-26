/** A stub of Workflow 7B's graph repositories: `foundation-7b` froze it, `api-graph` builds it. */
export class GraphRepositoryNotBuiltError extends Error {
  override name = 'GraphRepositoryNotBuiltError';

  constructor(name: string) {
    super(`${name} is not built yet (api-graph)`);
  }
}

/** Rejects with {@link GraphRepositoryNotBuiltError}: a stub's whole body. */
export const graphRepositoryNotBuilt = (name: string): Promise<never> =>
  Promise.reject(new GraphRepositoryNotBuiltError(name));
