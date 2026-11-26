/**
 * Workflow 7A (S): the error the signal and device repository stubs reject with until their owner
 * (`api-signals`) builds them (`devices.ts`, `session-signals.ts`, `signal-computations.ts`).
 */
export class SignalRepositoryNotBuiltError extends Error {
  override name = 'SignalRepositoryNotBuiltError';

  constructor(what: string) {
    super(`${what} is not built yet (api-signals)`);
  }
}
