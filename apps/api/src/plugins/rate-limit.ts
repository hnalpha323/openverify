/**
 * C12 rate limits on the server and flow APIs, enforced with the injected `RateLimiter`
 * (GCRA in Valkey, `rate-limit/index.ts`).
 *
 * | Policy | Key | Where |
 * |---|---|---|
 * | `api` | the API key, or the dashboard user session | every server API request, after authentication |
 * | `flow-ip` | the client address | every flow API request (CORS preflights excepted), before the session token is looked up |
 * | `flow-session` | the flow session | every authenticated flow API request, before its body is read |
 * | `one-time-link-redeem` | the client address | `POST /api/v1/flow/one-time-links/redeem`, before anything else |
 * | `flow-signals` | the flow session | `POST /api/v1/flow/signals` (C94.2, Workflow 7A), with `flow-session`, before its body is read |
 * | `one-time-link-redeem` | the client address | also `POST /api/v1/flow/handoffs/preview`, `/decline` and `/redeem` (C96.3, Workflow 7A) |
 * | `flow-handoffs-ip` | the client address | `POST /api/v1/flow/handoffs` (C96.3), with `flow-ip` |
 * | `flow-handoffs` | the flow session | `POST /api/v1/flow/handoffs` (C96.3), with `flow-session`, before its body is read |
 * | `flow-integrity` | the inquiry | `POST /api/v1/flow/integrity-challenges` and `/integrity-tokens` together (C211.3, C221.7, Workflow 10B), with `flow-session`, before the body is read |
 * | `flow-sandbox-chip` | the inquiry | `POST /api/v1/flow/verifications/:id/sandbox-chip` (C208.1, C221.7, Workflow 10C), with `flow-session`, before the body is read |
 *
 * Responses carry `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` (seconds)
 * of the tightest limit that applied; over a limit the request answers 429 `rate-limited`
 * with `Retry-After`.
 *
 * Decision (C12): when the limiter is unavailable (Valkey down or answering garbage), the
 * request **fails open**: it proceeds without a limit and without headers, and an error is
 * logged. For a self-hosted API, an outage of the cache must not become an outage of
 * identity verification; the limits protect capacity, not secrets (tokens carry 256 random
 * bits, and login throttling has its own store).
 *
 * The per-address limits run in the flow's `onRequest`, before CORS headers are added, so a
 * browser cannot read those 429s; this is deliberate, because refusing before the session
 * lookup is what protects the database from a flood.
 */
import {
  RATE_LIMIT_DEFAULTS,
  RATE_LIMIT_LIMIT_HEADER,
  RATE_LIMIT_POLICIES,
  RATE_LIMIT_REMAINING_HEADER,
  RATE_LIMIT_RESET_HEADER,
  RATE_LIMIT_POLICY_WINDOWS,
  type FailClosedRateLimitPolicy,
  type RateLimitPolicy,
} from '@openverify/contracts';
import type { FastifyPluginCallback, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { RateLimitedError } from '../errors.js';
import type { Clock, Principal, RateLimitDecision, RateLimiter, RateLimitRule } from '../ports.js';

/** Every flow API route starts with this (contract C3). */
export const FLOW_ROUTE_PREFIX = '/api/v1/flow/';
/** The C10 one-time link redemption route, limited per client address. */
export const ONE_TIME_LINK_REDEEM_ROUTE = '/api/v1/flow/one-time-links/redeem';
/** C94.2, C107.3 (Workflow 7A): the signal bodies route, limited per session (`flow-signals`). */
export const FLOW_SIGNALS_ROUTE = '/api/v1/flow/signals';
/**
 * C96.3, C107.3 (Workflow 7A): issuing a handoff, limited per session (`flow-handoffs`) and per
 * client address (`flow-handoffs-ip`). Every handoff route starts with it, and
 * `assertSessionNotHandedOff` lets them all through (F13).
 */
export const FLOW_HANDOFFS_ROUTE = '/api/v1/flow/handoffs';
/**
 * C96.3, C107.3 (Workflow 7A): the phone's unauthenticated handoff routes, which join the
 * `one-time-link-redeem` set (limited per client address).
 */
export const HANDOFF_TOKEN_ROUTES: ReadonlySet<string> = new Set(
  ['preview', 'decline', 'redeem'].map((route) => `${FLOW_HANDOFFS_ROUTE}/${route}`),
);
/**
 * C211.3, C221.7 (Workflow 10B): the integrity challenge and token routes, limited together per
 * inquiry (`flow-integrity`), so a new session of the same inquiry does not reset the count.
 */
export const FLOW_INTEGRITY_ROUTES: ReadonlySet<string> = new Set([
  '/api/v1/flow/integrity-challenges',
  '/api/v1/flow/integrity-tokens',
]);

/**
 * C208.1, C221.7 (Workflow 10C): the sandbox test chip route, limited per inquiry
 * (`flow-sandbox-chip`), so a new session of the same inquiry does not reset the count.
 */
export const FLOW_SANDBOX_CHIP_ROUTE = '/api/v1/flow/verifications/:id/sandbox-chip';

/** A C12 platform rule: one of `RATE_LIMIT_POLICIES` (the OTP limits are not, C55.7). */
export type PolicyRateLimitRule = RateLimitRule & { name: RateLimitPolicy };

export type RateLimitRules = Readonly<Record<RateLimitPolicy, PolicyRateLimitRule>>;

/**
 * The C12 rules, each in its policy window (C107.3): the given limits, otherwise the contract
 * defaults (`api` 300, `flow-session` 120, `flow-ip` 600, `one-time-link-redeem` 30 and `reports`
 * 600 a minute; the Phase 7 flow and graph policies of `RATE_LIMIT_DEFAULTS`). A configured limit
 * keeps its policy's window.
 */
export function rateLimitRules(
  perWindow: Partial<Record<RateLimitPolicy, number>> = {},
): RateLimitRules {
  const rules = RATE_LIMIT_POLICIES.map((name): [RateLimitPolicy, PolicyRateLimitRule] => [
    name,
    {
      name,
      limit: perWindow[name] ?? RATE_LIMIT_DEFAULTS[name],
      windowSeconds: RATE_LIMIT_POLICY_WINDOWS[name],
    },
  ]);
  return Object.fromEntries(rules) as Record<RateLimitPolicy, PolicyRateLimitRule>;
}

/** A limit that was applied to a request: its rule and the limiter's decision. */
export interface AppliedRateLimit {
  rule: PolicyRateLimitRule;
  decision: RateLimitDecision;
}

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * The tightest limit applied to this request, which its RateLimit headers report; `null`
     * when no limit applied or the limiter was unavailable (C12 fails open).
     */
    rateLimit: AppliedRateLimit | null;
  }
}

export interface RateLimitPluginOptions {
  limiter: RateLimiter;
  clock: Clock;
  rules: RateLimitRules;
}

/** Whether `next` is tighter than `current`: refused, or fewer requests left. */
function tighter(next: RateLimitDecision, current: AppliedRateLimit | null): boolean {
  return (
    current === null ||
    (!next.allowed && current.decision.allowed) ||
    (next.allowed === current.decision.allowed && next.remaining < current.decision.remaining)
  );
}

/**
 * The request's principal. Routes in scopes created before principal auth loaded, such as
 * @fastify/swagger's, lack the decoration, so it can be `undefined` there.
 */
function principalOf(request: FastifyRequest): Principal | null {
  const principal: Principal | null | undefined = request.principal;
  return principal ?? null;
}

/** The limit recorded so far; `undefined` in scopes created before this plugin loaded. */
function appliedOf(request: FastifyRequest): AppliedRateLimit | null {
  const applied: AppliedRateLimit | null | undefined = request.rateLimit;
  return applied ?? null;
}

const isFlowRoute = (request: FastifyRequest): boolean =>
  request.routeOptions.url?.startsWith(FLOW_ROUTE_PREFIX) === true && request.method !== 'OPTIONS';

const rateLimitPlugin: FastifyPluginCallback<RateLimitPluginOptions> = (app, options, done) => {
  const { limiter, clock, rules } = options;

  /**
   * Counts the request under `rule` for `key` and records the decision when it is the
   * tightest so far. A limiter failure is logged and lets the request through (fail open).
   * @throws {RateLimitedError} when the request is over the limit.
   */
  async function enforce(request: FastifyRequest, rule: PolicyRateLimitRule, key: string) {
    let decision: RateLimitDecision;
    try {
      decision = await limiter.consume(key, rule);
    } catch (error) {
      request.log.error(
        { err: error, policy: rule.name },
        'rate limiter unavailable; failing open, the request proceeds without a limit',
      );
      return;
    }
    if (tighter(decision, appliedOf(request))) {
      request.rateLimit = { rule, decision };
    }
    if (!decision.allowed) {
      throw new RateLimitedError(
        `Too many requests for the ${rule.name} limit of ${String(rule.limit)} per ` +
          `${String(rule.windowSeconds)} seconds. Retry after ${String(decision.retryAfterSeconds)} seconds.`,
        decision.retryAfterSeconds,
      );
    }
  }

  app.decorateRequest('rateLimit', null);

  app.addHook('onRequest', async (request) => {
    const principal = principalOf(request);
    if (principal !== null) {
      const key = principal.kind === 'api-key' ? principal.apiKeyId : principal.userSessionId;
      await enforce(request, rules.api, key);
      return;
    }
    if (isFlowRoute(request)) {
      await enforce(request, rules['flow-ip'], request.ip);
      const url = request.routeOptions.url;
      if (
        request.method === 'POST' &&
        url !== undefined &&
        (url === ONE_TIME_LINK_REDEEM_ROUTE || HANDOFF_TOKEN_ROUTES.has(url))
      ) {
        await enforce(request, rules['one-time-link-redeem'], request.ip);
      }
      if (request.method === 'POST' && url === FLOW_HANDOFFS_ROUTE) {
        await enforce(request, rules['flow-handoffs-ip'], request.ip);
      }
    }
  });

  // After the flow scope authenticated the session token (its `onRequest`), before the body.
  app.addHook('preParsing', async (request, _reply, payload) => {
    // Only the flow scope decorates `flowSession`; it is null on its public routes.
    const session: { id: string; inquiryId: string } | null | undefined = request.flowSession;
    if (isFlowRoute(request) && session) {
      await enforce(request, rules['flow-session'], session.id);
      if (request.method === 'POST' && request.routeOptions.url === FLOW_SIGNALS_ROUTE) {
        await enforce(request, rules['flow-signals'], session.id);
      }
      if (request.method === 'POST' && request.routeOptions.url === FLOW_HANDOFFS_ROUTE) {
        await enforce(request, rules['flow-handoffs'], session.id);
      }
      if (request.method === 'POST' && FLOW_INTEGRITY_ROUTES.has(request.routeOptions.url ?? '')) {
        await enforce(request, rules['flow-integrity'], session.inquiryId);
      }
      if (request.method === 'POST' && request.routeOptions.url === FLOW_SANDBOX_CHIP_ROUTE) {
        await enforce(request, rules['flow-sandbox-chip'], session.inquiryId);
      }
    }
    return payload;
  });

  app.addHook('onSend', async (request, reply, payload) => {
    const applied = appliedOf(request);
    if (applied !== null) {
      const { decision } = applied;
      const resetSeconds = Math.max(
        0,
        Math.ceil((decision.resetAt.getTime() - clock.now().getTime()) / 1000),
      );
      void reply.header(RATE_LIMIT_LIMIT_HEADER, String(decision.limit));
      void reply.header(RATE_LIMIT_REMAINING_HEADER, String(decision.remaining));
      void reply.header(RATE_LIMIT_RESET_HEADER, String(resetSeconds));
    }
    return payload;
  });

  done();
};

/**
 * C12 rate limiting for the server API (`api`) and the flow API (`flow-ip`, `flow-session`,
 * `one-time-link-redeem`). Register it after principal auth, so the server API hook sees the
 * principal.
 */
export default fp(rateLimitPlugin, { name: 'openverify-rate-limit', fastify: '5.x' });

/**
 * C174.4 (Workflow 9A Stage 1b (T)): one use of a route-owned `policy` for `subject` (a principal or
 * an environment). Past the limit it throws the 429 `RateLimitedError` with `Retry-After`; when the
 * store does not answer it lets the request through (C12 fails open), as the other route owners do.
 */
export async function enforceRoutePolicy(
  rateLimiter: RateLimiter,
  policy: RateLimitPolicy,
  subject: string,
  detail: string,
): Promise<void> {
  let decision: RateLimitDecision;
  try {
    decision = await rateLimiter.consume(`${policy}:${subject}`, rateLimitRules()[policy]);
  } catch {
    return;
  }
  if (!decision.allowed) {
    throw new RateLimitedError(detail, decision.retryAfterSeconds);
  }
}

/**
 * One use of `policy` for `callerKey`, the key exactly as the route gives it (the limiter adds the
 * policy's name). Past the limit it throws the 429 `RateLimitedError` with `Retry-After`. When the
 * store does not answer it throws `unavailable()` (fail closed), or lets the request through when
 * `unavailable` is `null` (fail open, C12). The store's error is never passed on.
 */
async function enforceKeyedPolicy(
  rateLimiter: RateLimiter,
  policy: RateLimitPolicy,
  callerKey: string,
  unavailable: (() => Error) | null,
): Promise<void> {
  const rule = rateLimitRules()[policy];
  let decision: RateLimitDecision;
  try {
    decision = await rateLimiter.consume(callerKey, rule);
  } catch {
    if (unavailable === null) {
      return;
    }
    throw unavailable();
  }
  if (!decision.allowed) {
    throw new RateLimitedError(
      `Too many requests for the ${policy} limit of ${String(rule.limit)} per ` +
        `${String(rule.windowSeconds)} seconds. ` +
        `Retry after ${String(decision.retryAfterSeconds)} seconds.`,
      decision.retryAfterSeconds,
    );
  }
}

/**
 * C233.5, C253.7 (Workflow 11B Stage 1a; orchestrator decision 16): one use of a route policy that
 * fails closed (`RATE_LIMIT_FAIL_CLOSED_POLICIES`) for `callerKey`. Past the limit it throws 429 with
 * `Retry-After`; when the store does not answer it throws `unavailable()`, the route's own 503, and
 * never lets the request through. The one path for every such policy, so no second copy of the
 * catch exists: `connect-peek` through `enforceConnectPolicy` and `account-export` through the
 * export's route.
 */
export function enforceFailClosedPolicy(
  rateLimiter: RateLimiter,
  policy: FailClosedRateLimitPolicy,
  callerKey: string,
  unavailable: () => Error,
): Promise<void> {
  return enforceKeyedPolicy(rateLimiter, policy, callerKey, unavailable);
}

/**
 * The same use for a policy that fails open (C12), counted under `callerKey` as given, with the same
 * 429: `connect-redeem` (C240.3).
 */
export function enforceKeyedPolicyFailOpen(
  rateLimiter: RateLimiter,
  policy: RateLimitPolicy,
  callerKey: string,
): Promise<void> {
  return enforceKeyedPolicy(rateLimiter, policy, callerKey, null);
}

/** The subject a per-principal policy counts: the API key or the user. */
export const principalSubject = (principal: Principal): string =>
  principal.kind === 'api-key' ? principal.apiKeyId : principal.userId;
