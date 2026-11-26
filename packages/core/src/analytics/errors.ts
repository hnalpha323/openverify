/**
 * Phase 9, Workflow 9B (`analytics-logic`): the error every analytics function throws for an input
 * outside its domain (a negative count, a histogram of the wrong length, a value outside a signal's
 * bins). It is a `RangeError`, and its message names the input, never its value, so no figure, bin
 * value or count reaches a log through it. Re-exported through `metrics.ts` (the index is frozen).
 */
export class AnalyticsInputError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = 'AnalyticsInputError';
  }
}

/** A whole, non-negative count, or the refusal naming `what`. */
export function assertCount(value: number, what: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AnalyticsInputError(`${what} must be a whole number of at least 0`);
  }
  return value;
}
