import { buildRateLimitResource, rateLimitListDocumentSchema } from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { AppError } from '../../errors.js';
import { problemResponses } from '../../plugins/openapi.js';
import { rateLimitRules } from '../../plugins/rate-limit.js';
import type { Principal } from '../../ports.js';
import { connectEnabled } from '../../services/connect/switch.js';
import { connectRateLimitKey } from '../../services/connect/rate-limits.js';
import type { ApiDependencies } from '../../services/context.js';

/** C240.3 (KP11-11): the Connect policies listed, in this order; `account-export` never is. */
const CONNECT_LISTED_POLICIES = ['connect-redeem', 'connect-peek'] as const;

/**
 * C240.3, Workflow 11B Stage 1a amendment 22 (KP11-11; integration-11b): while the install allows
 * Connect, the caller's `connect-redeem` and `connect-peek` buckets for the environment it acts in,
 * read with the limiter's `peek` (never counted) under `connectRateLimitKey` (one bucket per principal
 * and environment). A limiter without `peek`, or a failed read, lists none of them.
 */
async function connectBuckets(
  deps: ApiDependencies,
  principal: Principal | null | undefined,
): Promise<ReturnType<typeof buildRateLimitResource>[]> {
  const peek = deps.rateLimiter.peek?.bind(deps.rateLimiter);
  if (!connectEnabled(deps.connect) || peek === undefined || principal == null) {
    return [];
  }
  const key = connectRateLimitKey(principal);
  const rules = rateLimitRules();
  try {
    const states = await Promise.all(
      CONNECT_LISTED_POLICIES.map(async (name) => {
        const rule = rules[name];
        return { rule, state: await peek(key, rule) };
      }),
    );
    return states.map(({ rule, state }) =>
      buildRateLimitResource({
        name: rule.name,
        limit: state.limit,
        windowSeconds: rule.windowSeconds,
        remaining: state.remaining,
        resetAt: state.resetAt,
      }),
    );
  } catch {
    return [];
  }
}

/**
 * C12 `GET /rate-limits` (any principal), under `/api/v1`: the limits that apply to the
 * caller, which for a server API principal is the `api` limit of its API key or user session.
 * The state is the one the rate-limit hook recorded for this very request, so reading it costs
 * one request like any other. Since Workflow 11B (C240.3, KP11-11) the Connect pair is read with
 * one read-only `peek` each while Connect is on.
 */
export const rateLimitRoutes: FastifyPluginCallbackZod<ApiDependencies> = (app, deps, done) => {
  app.get(
    '/rate-limits',
    {
      config: { scopes: [] },
      schema: {
        summary: "List the caller's rate limits",
        description:
          'The `api` limit of the API key or user session: its size per window, the requests ' +
          'left after this one, and when the quota is whole again (GCRA). While the installation ' +
          "allows Connect, also the caller's `connect-redeem` and `connect-peek` buckets for the " +
          'environment it acts in, read without being counted. Any principal may read it.',
        tags: ['rate-limits'],
        response: { 200: rateLimitListDocumentSchema, ...problemResponses(401, 429, 503) },
      },
    },
    async (request) => {
      const applied = request.rateLimit;
      if (applied === null) {
        // The limiter failed open for this request, so its state is unknown; inventing a
        // remaining quota would be wrong.
        throw new AppError({
          status: 503,
          detail: 'The rate limit state is unavailable right now. Requests are not limited.',
        });
      }
      const { rule, decision } = applied;
      return {
        data: [
          buildRateLimitResource({
            name: rule.name,
            limit: decision.limit,
            windowSeconds: rule.windowSeconds,
            remaining: decision.remaining,
            resetAt: decision.resetAt,
          }),
          ...(await connectBuckets(deps, request.principal)),
        ],
        links: { next: null },
      };
    },
  );

  done();
};
