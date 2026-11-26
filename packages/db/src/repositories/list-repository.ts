/** A stub of Workflow 7B's list repositories: `foundation-7b` froze the name, the owner builds it. */
export class ListRepositoryNotBuiltError extends Error {
  override name = 'ListRepositoryNotBuiltError';

  constructor(name: string) {
    super(`${name} is not built yet`);
  }
}

/** Rejects with {@link ListRepositoryNotBuiltError}: a stub's whole body. */
export const listRepositoryNotBuilt = (name: string): Promise<never> =>
  Promise.reject(new ListRepositoryNotBuiltError(name));
