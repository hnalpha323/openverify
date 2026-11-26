/**
 * C253.7, C233.5 (Workflow 11B Stage 1a, common; orchestrator decision 16 before 11B): the one
 * fail-closed path. A route policy that must not be served unlimited (`connect-peek`,
 * `account-export`: `RATE_LIMIT_FAIL_CLOSED_POLICIES`) is enforced by one helper beside
 * `enforceRoutePolicy`, which takes the policy, its caller key and the 503 problem the route answers
 * when the limiter's store does not answer. `enforceConnectPolicy` calls it for `connect-peek`, so
 * no second copy of the catch exists. The helper is read through the module's namespace, so this
 * file compiles before the name exists and fails at run time for the intended reason.
 */
import { readFileSync } from 'node:fs';
import { RATE_LIMIT_DEFAULTS, RATE_LIMIT_POLICY_WINDOWS } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { AppError, RateLimitedError } from '../errors.js';
import type { RateLimitDecision, RateLimiter, RateLimitRule } from '../ports.js';
import * as plugin from './rate-limit.js';

type FailClosed = (
  rateLimiter: RateLimiter,
  policy: 'connect-peek' | 'account-export',
  callerKey: string,
  unavailable: () => Error,
) => Promise<void>;

const helper = (): FailClosed => {
  const found = (plugin as Readonly<Record<string, unknown>>).enforceFailClosedPolicy;
  if (typeof found !== 'function') {
    throw new TypeError('enforceFailClosedPolicy is not exported by plugins/rate-limit.ts');
  }
  return found as FailClosed;
};

const decision = (allowed: boolean, retryAfterSeconds = 0): RateLimitDecision => ({
  allowed,
  limit: 10,
  remaining: allowed ? 9 : 0,
  resetAt: new Date('2026-11-13T12:00:00.000Z'),
  retryAfterSeconds,
});

function recording(answer: () => Promise<RateLimitDecision>) {
  const calls: { key: string; rule: RateLimitRule }[] = [];
  const limiter: RateLimiter = {
    consume: (key, rule) => {
      calls.push({ key, rule });
      return answer();
    },
  };
  return { limiter, calls };
}

const unavailable = () =>
  new AppError({ status: 503, detail: 'Synthetic: exports are unavailable right now.' });

describe('enforceFailClosedPolicy (C253.7)', () => {
  it('counts one use of the policy under the caller key it is given, unchanged', async () => {
    const { limiter, calls } = recording(() => Promise.resolve(decision(true)));

    await helper()(limiter, 'account-export', 'env_01M5CN0000000000000011B001', unavailable);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.key).toBe('env_01M5CN0000000000000011B001');
    expect(calls[0]?.rule).toMatchObject({
      name: 'account-export',
      limit: RATE_LIMIT_DEFAULTS['account-export' as keyof typeof RATE_LIMIT_DEFAULTS],
      windowSeconds:
        RATE_LIMIT_POLICY_WINDOWS['account-export' as keyof typeof RATE_LIMIT_POLICY_WINDOWS],
    });
  });

  it('throws the route-owned 503 when the store does not answer, never letting the call through', async () => {
    const { limiter } = recording(() => Promise.reject(new Error('synthetic store outage')));

    const refused = helper()(
      limiter,
      'account-export',
      'env_01M5CN0000000000000011B001',
      unavailable,
    );

    await expect(refused).rejects.toMatchObject({ status: 503 });
    await expect(refused).rejects.not.toThrow(/synthetic store outage/);
  });

  it('throws 429 with Retry-After past the limit, in the words connect-peek answered before', async () => {
    const { limiter } = recording(() => Promise.resolve(decision(false, 42)));

    const refused = helper()(limiter, 'connect-peek', 'key_x:env_y', unavailable);

    await expect(refused).rejects.toBeInstanceOf(RateLimitedError);
    await expect(refused).rejects.toMatchObject({ headers: { 'retry-after': '42' } });
    await expect(refused).rejects.toThrow(
      'Too many requests for the connect-peek limit of 60 per 60 seconds. Retry after 42 seconds.',
    );
  });
});

describe('one copy of the catch (orchestrator decision 16)', () => {
  it('leaves enforceConnectPolicy to the shared helper, with no catch of its own', () => {
    const source = readFileSync(
      new URL('../services/connect/rate-limits.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain('enforceFailClosedPolicy');
    expect(source).not.toMatch(/\bcatch\b/);
  });
});
