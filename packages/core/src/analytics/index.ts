/**
 * C163, C164 (Phase 9, Workflow 9B): the analytics logic of `packages/core`. Frozen by
 * `contracts-9b` (Stage 1a), one line per module, and a shared file once Stage 2 starts (V10, V16):
 * `analytics-logic` builds `metrics.ts`, `suppression.ts`, `durations.ts` and `signal-bins.ts`'
 * functions behind these lines; `definitions.ts`, `rows.ts`, `SIGNAL_BINS` and the duration
 * constants are frozen contracts, changed only by `integration-9b`.
 */
export * from './definitions.js';
export * from './rows.js';
export * from './not-built.js';
export * from './metrics.js';
export * from './suppression.js';
export * from './durations.js';
export * from './signal-bins.js';
