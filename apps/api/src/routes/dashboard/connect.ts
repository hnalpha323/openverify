/**
 * C231.3 (decisions 18, 26; reviews P01, P06; Workflow 11A): the destination's activation of a
 * connection, `POST /api/v1/dashboard/connect/connections/:id/activate`, a BFF route of the console:
 * it takes a user session only (a dashboard route is never reached with an API key, so a key gets the
 * route's 404), needs the organisation-level permission `connect-connections:activate` and Phase 9's
 * step-up (403 `step_up_required` unless the session verified a second factor within the last
 * 10 minutes), `policy-version` equal to the current version (409 `share_policy_changed`), the sealed
 * `agreement-reference` and `acknowledged: true`. `pending` to `active`. A user of the source
 * organisation gets the generic 404. While the install switch is off it answers the one generic 404.
 *
 * Frozen by `foundation-11a` (Stage 1b (C)) with its contract schema; built by `api-connect`
 * (`services/connect/connections.ts`'s `activateConnection`). The audit logger, clock, ids and event
 * publisher come from `api` when the dashboard's registration passes them (the server API's ports),
 * else the defaults: the DB-backed audit logger, the system clock, ULIDs and an outbox-only publisher
 * (its webhook deliveries are enqueued by the dispatcher's sweep).
 */
import {
  activateConnectionBodySchema,
  connectionDocumentSchema,
  connectionParamsSchema,
} from '@openverify/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { ConnectInstallSettings } from '../../config.js';
import { createOutboxOnlyPublisher } from '../../events/index.js';
import { problemResponses } from '../../plugins/openapi.js';
import { systemClock, ulidIdGenerator } from '../../ports.js';
import { createAuditLogger } from '../../services/audit-log.js';
import { activateConnection, type ConnectionDeps } from '../../services/connect/connections.js';
import { connectSwitchHook } from '../../services/connect/switch.js';
import type { ApiDependencies } from '../../services/context.js';
import {
  dashboardContextOf,
  operatorPrincipal,
  requireOperator,
  userActor,
} from './authenticate.js';
import type { DashboardContext } from './context.js';
import { DASHBOARD_TAG, USER_SESSION_SECURITY } from './openapi.js';

/** The dashboard context with the install switch (`config.connect`) and the server API's ports. */
export interface ConnectDashboardContext extends DashboardContext {
  connect?: ConnectInstallSettings | undefined;
  api?: Partial<Pick<ApiDependencies, 'audit' | 'clock' | 'ids' | 'events'>> | undefined;
}

/** C231.3 activation, under `/api/v1/dashboard`, inside the authenticated scope. */
export const connectDashboardRoutes: FastifyPluginAsyncZod<ConnectDashboardContext> = (
  app,
  options,
) => {
  app.addHook('onRequest', connectSwitchHook(options.connect));
  const deps: ConnectionDeps = {
    db: options.db,
    audit: options.api?.audit ?? createAuditLogger(),
    clock: options.api?.clock ?? systemClock,
    ids: options.api?.ids ?? ulidIdGenerator,
    events: options.api?.events ?? createOutboxOnlyPublisher(options.db),
  };

  app.post(
    '/connect/connections/:id/activate',
    {
      schema: {
        summary: 'Activate a connection',
        description:
          'C231.3: the destination organisation’s user, with `connect-connections:activate` and a ' +
          'second factor verified within the last 10 minutes (403 `step_up_required`), accepts the ' +
          'current policy version (409 `share_policy_changed` otherwise) and cites the data-sharing ' +
          'agreement (sealed); `pending` to `active`.',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        params: connectionParamsSchema,
        body: activateConnectionBodySchema,
        response: {
          200: connectionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409),
        },
      },
    },
    (request) => {
      const operator = requireOperator(request);
      const principal = operatorPrincipal(operator);
      return activateConnection(
        deps,
        {
          principal,
          ctx: dashboardContextOf(request, options.operatorAuth, {
            organizationId: operator.organizationId,
            environmentId: operator.environmentId,
          }),
          actor: userActor(operator.user.id),
          environmentKind: operator.environmentKind,
        },
        request.params.id,
        request.body.data.attributes,
      );
    },
  );
  return Promise.resolve();
};
