/**
 * KP11-13 (Workflow 11B, integration-11b): why `pacing.integration.test.ts` once read 263 ms against
 * its lower bound of 380 ms at load 13.7. When a limiter command fails (under load, past the limiter
 * client's 500 ms command timeout) the pacer falls back to per-process turns, so the second process's
 * acquire waits for nothing and three acquires across two processes take one interval, not two. Made
 * deterministic here with a limiter that fails once and the pacer's injected clock and sleep: the
 * elapsed time alone would read that run as a pacing failure, so the integration test counts the
 * limiter's failures (`countingLimiter`) and asserts there were none before it reads the time.
 */
import { describe, expect, it } from 'vitest';
import type { RateLimiter } from '../../ports.js';
import { createAllowAllRateLimiter } from '../../test-support/fakes.js';
import { createProviderPacer, type PacingRule } from './pacing.js';
import { countingLimiter } from './pacing.test-support.js';

const RULE: PacingRule = { name: 'synthetic-register', intervalMs: 200 };

/** A GCRA stand-in on a virtual clock: one turn per interval per key; the `fail`th call rejects. */
function virtualLimiter(now: () => number, fail: number): RateLimiter {
  const nextFree = new Map<string, number>();
  let calls = 0;
  const base = createAllowAllRateLimiter();
  return {
    async consume(key, rule) {
      calls += 1;
      if (calls === fail) {
        throw new Error('Command timed out');
      }
      const decision = await base.consume(key, rule);
      const at = now();
      const free = nextFree.get(key) ?? at;
      if (free > at) {
        return { ...decision, allowed: false, resetAt: new Date(free) };
      }
      nextFree.set(key, at + RULE.intervalMs);
      return decision;
    },
  };
}

describe('pacing across two processes when a limiter command fails (KP11-13)', () => {
  it('falls back to per-process turns, which the counting limiter reports', async () => {
    let virtual = 0;
    const clock = { now: () => new Date(virtual) };
    const sleep = (ms: number) => {
      virtual += ms;
      return Promise.resolve();
    };
    const shared = virtualLimiter(() => virtual, 2);
    const counted = countingLimiter(shared);
    const [first, second] = [counted, counted].map((rateLimiter) =>
      createProviderPacer({ rateLimiter, clock, sleep }),
    );

    await first?.acquire(RULE, 'install-synthetic');
    await second?.acquire(RULE, 'install-synthetic');
    await first?.acquire(RULE, 'install-synthetic');

    // One interval waited, not two: the elapsed time alone would read this run as a pacing failure.
    expect(virtual).toBe(RULE.intervalMs);
    expect(counted.failures).toBe(1);
  });
});
