/**
 * Phase 9, Workflow 9B Stage 1a (`contracts-9b`): the error every analytics stub throws until
 * `analytics-logic` builds it (Workflow 9B Stage 2), so no figure is ever computed by a stub.
 */
export class AnalyticsNotBuiltError extends Error {
  readonly owner = 'analytics-logic';
  /** How many inputs the stub was given; their values are never kept. */
  readonly inputs: number;

  constructor(name: string, inputs = 0) {
    super(`${name} is not built yet (analytics-logic, Workflow 9B)`);
    this.name = 'AnalyticsNotBuiltError';
    this.inputs = inputs;
  }
}

/** The stubs' refusal, counting their inputs. */
export const analyticsNotBuilt = (
  name: string,
  ...inputs: readonly unknown[]
): AnalyticsNotBuiltError => new AnalyticsNotBuiltError(name, inputs.length);
