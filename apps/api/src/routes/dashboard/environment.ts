import {
  dashboardSwitchEnvironmentBodySchema,
  dashboardSwitchEnvironmentResponseSchema,
} from '@openverify/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { problemResponses } from '../../plugins/openapi.js';
import { switchSessionEnvironment } from '../../services/users.js';
import { operatorChange, type AdminRouteContext } from './admin-context.js';
import { requireOperator } from './authenticate.js';
import { DASHBOARD_TAG, USER_SESSION_SECURITY } from './openapi.js';

/** `PUT /sessions/current/environment` (C15): the sandbox and production switch. */
export const environmentRoutes: FastifyPluginAsyncZod<AdminRouteContext> = (app, context) => {
  app.put(
    '/sessions/current/environment',
    {
      schema: {
        summary: 'Switch the session’s environment',
        description:
          'Moves the current session into another environment of the organization. ' +
          'Production needs `environments:production`. Every switch is audited.',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        body: dashboardSwitchEnvironmentBodySchema,
        response: {
          200: dashboardSwitchEnvironmentResponseSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    async (request) => {
      const environment = await switchSessionEnvironment(
        context,
        operatorChange(request, context),
        requireOperator(request).sessionId,
        request.body['environment-id'],
      );
      return { environment };
    },
  );
  return Promise.resolve();
};
