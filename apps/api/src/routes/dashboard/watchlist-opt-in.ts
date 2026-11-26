/**
 * C254.1 (Workflow 11B; Stage 1a amendment 51; Q10 granted 2026-11-21, Workflow 11G records-11g): the
 * UN Security Council list's opt-in, unlocked by the install switch (true by default since Q10). `POST /api/v1/dashboard/watchlist-sources/:sourceId/opt-in` records an
 * environment admin's acknowledgement of the source's terms and `DELETE` on the same path withdraws
 * it (`settings:write` and `settings:privacy`, with Phase 9's step-up; each audited). An install that
 * sets `OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED` to false (true by default since Q10's grant) locks
 * the list: every opt-in answers 409 `watchlist_source_locked` and `un-sc` stays disabled.
 *
 * Frozen by `foundation-11b` (Stage 1b (D)) with `contracts-11b`'s schemas; built by
 * `ingestion-11b` over `watchlists/un-opt-in.ts`. The switch reaches the route as the context's
 * `watchlistUnOptInAllowed`, which `routes/dashboard/admin.ts` hands it from the container's config
 * since Workflow 11G; absent, it is false, so the route answers 409 whatever is asked.
 */
import {
  watchlistOptInBodySchema,
  watchlistOptInParamsSchema,
  watchlistOptInSchema,
} from '@openverify/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import { acceptWatchlistOptIn, withdrawWatchlistOptIn } from '../../watchlists/un-opt-in.js';
import { operatorChange, type AdminRouteContext } from './admin-context.js';
import { requireOperator } from './authenticate.js';
import { DASHBOARD_TAG, USER_SESSION_SECURITY } from './openapi.js';

const SCOPES = ['settings:write', 'settings:privacy'] as const;

/** The admin context, with the install switch (C254.1). */
export interface WatchlistOptInRouteContext extends AdminRouteContext {
  /** `OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED` (`ApiConfig.watchlistUnOptInAllowed`); absent: false. */
  watchlistUnOptInAllowed?: boolean | undefined;
}

/** C254.1: the opt-in and its withdrawal. */
export const watchlistOptInRoutes: FastifyPluginAsyncZod<WatchlistOptInRouteContext> = (
  app,
  context,
) => {
  const deps = { db: context.db, audit: context.audit, clock: context.clock };
  const acting = (request: Parameters<typeof requireOperator>[0]) => {
    const operator = requireOperator(request);
    const change = operatorChange(request, context);
    return {
      ctx: change.ctx,
      actor: change.actor,
      userId: operator.user.id,
      sessionId: operator.sessionId,
    };
  };
  const allowed = context.watchlistUnOptInAllowed === true;
  app.post(
    '/watchlist-sources/:sourceId/opt-in',
    {
      config: { scopes: [...SCOPES] },
      schema: {
        summary: 'Opt the environment in to a watchlist source',
        description:
          'C254.1: records the acknowledgement of the source’s terms, as served on the sources ' +
          'document, with the user and time audited. Refused (409 `watchlist_source_locked`) ' +
          'while the install does not allow it (`OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED`, true by ' +
          'default since Q10’s grant; false locks the list).',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        params: watchlistOptInParamsSchema,
        body: watchlistOptInBodySchema,
        response: {
          200: watchlistOptInSchema,
          ...problemResponses(400, 401, 403, 409, 422),
        },
      },
    },
    (request) =>
      acceptWatchlistOptIn(
        deps,
        acting(request),
        { allowed, sourceId: request.params.sourceId },
        request.body,
      ),
  );

  app.delete(
    '/watchlist-sources/:sourceId/opt-in',
    {
      config: { scopes: [...SCOPES] },
      schema: {
        summary: 'Withdraw the environment’s opt-in to a watchlist source',
        description:
          'C254.1: withdraws the acknowledgement, audited; the source is disabled for the ' +
          'environment again.',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        params: watchlistOptInParamsSchema,
        response: {
          204: z.null().describe('Withdrawn.'),
          ...problemResponses(400, 401, 403, 404, 409),
        },
      },
    },
    async (request, reply) => {
      await withdrawWatchlistOptIn(deps, acting(request), {
        allowed,
        sourceId: request.params.sourceId,
      });
      return reply.status(204).send(null);
    },
  );
  return Promise.resolve();
};
