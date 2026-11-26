/**
 * C97.5, C99.4, C107.3 (Workflow 7B): the C12 policies the list routes enforce, as
 * `consumeReportRate` does: `lists-write` per environment and `lists-match` per key. The limiter
 * failing open, as C12 does.
 */
import { RateLimitedError } from '../../errors.js';
import { rateLimitRules } from '../../plugins/rate-limit.js';
import type { ApiDependencies } from '../context.js';

async function consume(
  deps: Pick<ApiDependencies, 'rateLimiter'>,
  policy: 'lists-write' | 'lists-match',
  subject: string,
  detail: string,
): Promise<void> {
  let decision;
  try {
    decision = await deps.rateLimiter.consume(`${policy}:${subject}`, rateLimitRules()[policy]);
  } catch {
    return;
  }
  if (!decision.allowed) {
    throw new RateLimitedError(detail, decision.retryAfterSeconds);
  }
}

/**
 * C97.5: one item write of the environment.
 * @throws {RateLimitedError} 429 with `Retry-After` beyond the limit.
 */
export function consumeListWrite(
  deps: Pick<ApiDependencies, 'rateLimiter'>,
  environmentId: string,
): Promise<void> {
  return consume(
    deps,
    'lists-write',
    environmentId,
    'This environment wrote too many list items; retry later.',
  );
}

/**
 * C99.4: one on-demand match of the key.
 * @throws {RateLimitedError} 429 with `Retry-After` beyond the limit.
 */
export function consumeListMatch(
  deps: Pick<ApiDependencies, 'rateLimiter'>,
  actorId: string,
): Promise<void> {
  return consume(deps, 'lists-match', actorId, 'This key matched too many values; retry later.');
}
