/**
 * C157.2 (Workflow 9A): `GET /api/v1/internal/embed-policies/:inquiryId`, the flow server's lookup of
 * an inquiry's embed policy before it computes `frame-ancestors` for `/embed/{inquiry id}`. It is
 * ours and internal: kept out of the public OpenAPI document (`hide`), taking only the flow
 * server's token (`OPENVERIFY_FLOW_SERVER_TOKEN`, and `_PREVIOUS` during a rotation) compared in
 * constant time, and counted per token by `internal-embed-policy` (C174.4: a capacity ceiling, the
 * flow server limits each client first) before any lookup. Neither API logs nor a principal see it.
 *
 * Frozen by `foundation-9a` (Stage 1b (F)); `flow-server-embed` owns this file and builds the
 * lookup behind `embedPolicyFor` (`services/embed-origins.ts`), which answers 501 until then.
 */
import { embedPolicyAnswerSchema, embedPolicyParamsSchema } from '@openverify/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { matchFlowServerToken } from '../../auth/flow-server-token.js';
import { NotFoundError, UnauthorizedError } from '../../errors.js';
import { problemResponses } from '../../plugins/openapi.js';
import { enforceRoutePolicy } from '../../plugins/rate-limit.js';
import type { ApiDependencies } from '../../services/context.js';
import { embedPolicyFor } from '../../services/embed-origins.js';

export const embedPolicyRoutes: FastifyPluginAsyncZod<ApiDependencies> = (app, deps) => {
  // Before the params are read: a request without the token learns nothing, not even a 400.
  app.addHook('onRequest', async (request) => {
    const match = matchFlowServerToken(request.headers.authorization, deps.flowServerTokens);
    if (match === null) {
      throw new UnauthorizedError('The flow server token is missing or not valid.');
    }
    await enforceRoutePolicy(
      deps.rateLimiter,
      'internal-embed-policy',
      `flow-server-${match}`,
      'Too many embed policy lookups for this flow server token.',
    );
  });

  app.get(
    '/embed-policies/:inquiryId',
    {
      config: { public: true },
      schema: {
        hide: true,
        params: embedPolicyParamsSchema,
        response: {
          200: embedPolicyAnswerSchema,
          ...problemResponses(400, 401, 404, 429, 501),
        },
      },
    },
    async (request) => {
      const answer = await embedPolicyFor(deps.db, request.params.inquiryId);
      if (answer === null) {
        throw new NotFoundError('No embed policy.');
      }
      return answer;
    },
  );
  return Promise.resolve();
};
