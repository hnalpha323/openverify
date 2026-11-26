/**
 * C117.8, C118.8 (P31): whether a run may start now, by the defer-mode limiters. A refusal says when
 * to try again, and a limiter that cannot answer defers too: it never fails open, and nothing is
 * dropped.
 */
import { rateLimitRules } from '../../plugins/rate-limit.js';
import type { RateLimiter } from '../../ports.js';

/** How long to wait when the limiter cannot answer. */
const DEFER_WHEN_DOWN_SECONDS = 60;
const MIN_DEFER_SECONDS = 1;
const MS_PER_SECOND = 1_000;

export const runGuard = (environmentId: string) =>
  [`workflow-runs:${environmentId}`, 'workflow-runs'] as const;

export const subjectGuard = (workflowId: string, subjectId: string) =>
  [`workflow-subject:${workflowId}:${subjectId}`, 'workflow-subject'] as const;

type Guard = ReturnType<typeof runGuard> | ReturnType<typeof subjectGuard>;

/** `null` when every guard admits, else when to try again. */
export async function deferredUntil(
  limiter: RateLimiter,
  now: Date,
  guards: readonly Guard[],
): Promise<Date | null> {
  const rules = rateLimitRules();
  for (const [key, policy] of guards) {
    let seconds: number;
    try {
      const decision = await limiter.consume(key, rules[policy]);
      seconds = decision.allowed ? 0 : Math.max(decision.retryAfterSeconds, MIN_DEFER_SECONDS);
    } catch {
      seconds = DEFER_WHEN_DOWN_SECONDS;
    }
    if (seconds > 0) {
      return new Date(now.getTime() + seconds * MS_PER_SECOND);
    }
  }
  return null;
}
