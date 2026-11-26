/**
 * C240.3 (V11; Stage 1a amendment 5; Workflow 11A Stage 1b (C)): the Connect route policies
 * `connect-redeem` and `connect-peek` (60 a minute each, provisional, with the basis that a
 * destination redeems about one share per onboarding), beside the `api` policy. Each keeps one bucket
 * per principal and environment pair: the caller key is `<principal id>:<environment id>`, where the
 * principal id is the API key's or the user session's, so a user session acting in two environments
 * has two buckets and an API key (bound to one environment) one.
 *
 * `connect-redeem` fails open when the store does not answer, as C12's limits do; `connect-peek`
 * fails closed (503 `connect_peek_unavailable`, C233.5, review P27): a peek is personal data, so an
 * unlimited peek is never served. Wired by `foundation-11a` on the redeem route and on the retrieve
 * route with `peek-source-data=true`.
 */
import { enforceFailClosedPolicy, enforceKeyedPolicyFailOpen } from '../../plugins/rate-limit.js';
import type { Principal, RateLimiter } from '../../ports.js';
import { ConnectProblemError } from './problems.js';

export type ConnectRatePolicy = 'connect-redeem' | 'connect-peek';

/** The caller key of a Connect policy: one bucket per principal and environment. */
export const connectRateLimitKey = (principal: Principal): string =>
  `${principal.kind === 'api-key' ? principal.apiKeyId : principal.userSessionId}:${principal.environmentId}`;

/**
 * One use of a Connect policy for the principal. Past the limit it throws 429 `rate-limited` with
 * `Retry-After`; when the store does not answer, `connect-redeem` lets the request through and
 * `connect-peek` refuses it with 503 `connect_peek_unavailable`, through the one fail-closed helper
 * (C253.7, Workflow 11B).
 */
export async function enforceConnectPolicy(
  rateLimiter: RateLimiter,
  policy: ConnectRatePolicy,
  principal: Principal,
): Promise<void> {
  if (policy === 'connect-peek') {
    await enforceFailClosedPolicy(
      rateLimiter,
      policy,
      connectRateLimitKey(principal),
      () =>
        new ConnectProblemError(
          'connect_peek_unavailable',
          'Peeking is unavailable right now. Try again later.',
        ),
    );
    return;
  }
  await enforceKeyedPolicyFailOpen(rateLimiter, policy, connectRateLimitKey(principal));
}
