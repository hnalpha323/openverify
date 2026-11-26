/** A stub of Workflow 7B's transaction repositories: `foundation-7b` froze it, the owner builds it. */
export class TransactionRepositoryNotBuiltError extends Error {
  override name = 'TransactionRepositoryNotBuiltError';

  constructor(name: string) {
    super(`${name} is not built yet`);
  }
}

/** Rejects with {@link TransactionRepositoryNotBuiltError}: a stub's whole body. */
export const transactionRepositoryNotBuilt = (name: string): Promise<never> =>
  Promise.reject(new TransactionRepositoryNotBuiltError(name));
