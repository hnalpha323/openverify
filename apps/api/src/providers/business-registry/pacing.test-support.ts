/**
 * KP11-13 (Workflow 11B, integration-11b): a limiter that counts the commands it could not run, so a
 * pacing test can tell a run that fell back to per-process turns (a limiter command failed, as under
 * load past its 500 ms command timeout) from a pacing failure, instead of reading the shorter wait
 * as one.
 */
import type { RateLimiter } from '../../ports.js';

export interface CountingLimiter extends RateLimiter {
  /** How many `consume` calls rejected. */
  readonly failures: number;
}

export function countingLimiter(inner: RateLimiter): CountingLimiter {
  let failures = 0;
  return {
    get failures() {
      return failures;
    },
    async consume(key, rule) {
      try {
        return await inner.consume(key, rule);
      } catch (error) {
        failures += 1;
        throw error;
      }
    },
  };
}
