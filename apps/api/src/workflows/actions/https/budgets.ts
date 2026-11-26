/**
 * C124.7, C126, C143.3, P31: the egress and compute budgets, which fail closed, unlike the C12 route
 * limits: a store that cannot answer refuses the step with `rate_limited`, retryable after the
 * window, and a key names ids or an HMAC, never an address.
 */
import { RATE_LIMIT_DEFAULTS, RATE_LIMIT_POLICY_WINDOWS } from '@openverify/contracts';
import type { RateLimitPolicy } from '@openverify/contracts';
import type { RateLimiter, RateLimitRule } from '../../../ports.js';
import { ActionStepError } from '../../engine/action-port.js';

/** A policy's install default. */
export const workflowPolicyRule = (name: RateLimitPolicy): RateLimitRule => ({
  name,
  limit: RATE_LIMIT_DEFAULTS[name],
  windowSeconds: RATE_LIMIT_POLICY_WINDOWS[name],
});

/**
 * Counts one against `rule`.
 * @throws {ActionStepError} `rate_limited`, retryable, past the rule or when the store is down.
 */
export async function consumeBudget(
  limiter: RateLimiter,
  key: string,
  rule: RateLimitRule,
): Promise<void> {
  let allowed: boolean;
  let retryAfterSeconds: number;
  try {
    ({ allowed, retryAfterSeconds } = await limiter.consume(key, rule));
  } catch {
    throw new ActionStepError('rate_limited', {
      retryable: true,
      retryAfterSeconds: rule.windowSeconds,
    });
  }
  if (!allowed) {
    throw new ActionStepError('rate_limited', { retryable: true, retryAfterSeconds });
  }
}
