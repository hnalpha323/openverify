/**
 * Workflow 11A Stage 1b (C, K): a stub of a Connect repository. `foundation-11a` declared it, and
 * its owner builds it: the Connect repositories pass to `api-connect`, the consent repositories to
 * `api-consent`. A stub rejects, so nothing reads as shared or consented before it is built.
 */
export class ConnectRepositoryNotBuiltError extends Error {
  override name = 'ConnectRepositoryNotBuiltError';

  constructor(name: string, owner: string) {
    super(`${name} is not built yet (${owner})`);
  }
}

/** Rejects with {@link ConnectRepositoryNotBuiltError}: a stub's whole body. */
export const connectRepositoryNotBuilt = (
  name: string,
  owner: 'api-connect' | 'api-consent' = 'api-connect',
): Promise<never> => Promise.reject(new ConnectRepositoryNotBuiltError(name, owner));
