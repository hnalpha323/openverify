/**
 * Workflow 9A Stage 1b: a stub keeps its owner's whole signature, so it names every input; this
 * counts them (never reads a value), which is all a stub does with them until its owner builds it.
 */
export const stubInputs = (...inputs: readonly unknown[]): number => inputs.length;
