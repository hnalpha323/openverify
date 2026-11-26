/**
 * Workflow 9A Stage 1b (S): the flow actions' stubs, each built by `api-flow-actions` behind the
 * name `foundation-9a` froze.
 */

/** A flow action stub its owner has not built yet. */
export class FlowActionNotBuiltError extends Error {
  override name = 'FlowActionNotBuiltError';

  constructor(name: string) {
    super(`${name} is not built yet (api-flow-actions)`);
  }
}

/** Rejects with {@link FlowActionNotBuiltError}: a stub's whole body. */
export const flowActionNotBuilt = (name: string): Promise<never> =>
  Promise.reject(new FlowActionNotBuiltError(name));
