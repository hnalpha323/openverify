/**
 * C147.6 (Workflow 9A Stage 1a): a problem a flow check finds, by RFC 6901 pointer into the flow
 * (`/steps/3/routes/0/condition`), with its rule's snake_case `code`. Warnings never block.
 */
export interface FlowProblem {
  readonly pointer: string;
  readonly code: string;
  readonly detail: string;
  readonly severity: 'error' | 'warning';
}

/** What a frozen export answers until its owner builds it (Workflow 9A Stage 2). */
export class FlowSpecNotBuiltError extends Error {
  /** How many inputs the stub was given; their values are never kept (they may hold a flow). */
  readonly inputs: number;

  constructor(name: string, owner: string, inputs = 0) {
    super(`${name} is not built yet (${owner}, Workflow 9A)`);
    this.name = 'FlowSpecNotBuiltError';
    this.inputs = inputs;
  }
}

/** The error a frozen stub throws, given its inputs so that none goes unused. */
export function notBuilt(
  name: string,
  owner: string,
  ...inputs: readonly unknown[]
): FlowSpecNotBuiltError {
  return new FlowSpecNotBuiltError(name, owner, inputs.length);
}
