import {
  idSchema,
  listUserAuditLogsQuerySchema,
  userAuditLogDocumentSchema,
  userAuditLogListDocumentSchema,
} from '@openverify/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { piiMaskFor } from '../../auth/pii.js';
import { problemResponses } from '../../plugins/openapi.js';
import { listAuditExplorerDocument } from '../../services/access/audit-explorer.js';
import { getUserAuditLogDocument } from '../../services/audit-log.js';
import type { AdminRouteContext } from './admin-context.js';
import { operatorPrincipal, requireOperator } from './authenticate.js';
import { DASHBOARD_TAG, USER_SESSION_SECURITY } from './openapi.js';

/**
 * C15 `GET /audit-logs` and `GET /audit-logs/:id` (`audit-logs:read`): the session
 * environment's user audit log. Client addresses and agents are masked without `pii:view`.
 */
export const auditLogRoutes: FastifyPluginAsyncZod<AdminRouteContext> = (app, { db }) => {
  app.get(
    '/audit-logs',
    {
      config: { scopes: ['audit-logs:read'] },
      schema: {
        summary: 'List audit log entries',
        description:
          "The session environment's entries, newest first, filtered by action, actor, " +
          'resource and creation time.',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        querystring: listUserAuditLogsQuerySchema,
        response: {
          200: userAuditLogListDocumentSchema,
          ...problemResponses(400, 401, 403, 503),
        },
      },
    },
    (request) => {
      const operator = requireOperator(request);
      // C168.6 (Workflow 9B): the explorer's filters; filter[ip] needs pii:view too.
      return listAuditExplorerDocument(
        db,
        operator.environmentId,
        request.query,
        piiMaskFor(operatorPrincipal(operator)),
        request.routeOptions.url ?? '',
        { piiView: operator.permissions.has('pii:view') },
      );
    },
  );

  app.get(
    '/audit-logs/:id',
    {
      config: { scopes: ['audit-logs:read'] },
      schema: {
        summary: 'Get an audit log entry',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        params: z.strictObject({ id: idSchema('aud') }),
        response: { 200: userAuditLogDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    (request) => {
      const operator = requireOperator(request);
      return getUserAuditLogDocument(
        db,
        operator.environmentId,
        request.params.id,
        piiMaskFor(operatorPrincipal(operator)),
      );
    },
  );
  return Promise.resolve();
};
