import {
  idSchema,
  listUserAuditLogsQuerySchema,
  userAuditLogDocumentSchema,
  userAuditLogListDocumentSchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { canViewPii, piiMaskFor } from '../../auth/pii.js';
import { problemResponses } from '../../plugins/openapi.js';
import { requirePrincipal } from '../../plugins/principal-auth.js';
import { listAuditExplorerDocument } from '../../services/access/audit-explorer.js';
import { getUserAuditLogDocument } from '../../services/audit-log.js';
import type { ApiDependencies } from '../../services/context.js';

/**
 * C15 user audit log routes (scope `audit-logs:read`), under `/api/v1`: the environment's
 * entries for API keys and dashboard user sessions. A user without `pii:view` sees no client
 * address or agent.
 */
export const userAuditLogRoutes: FastifyPluginCallbackZod<ApiDependencies> = (
  app,
  { db },
  done,
) => {
  app.get(
    '/user-audit-logs',
    {
      config: { scopes: ['audit-logs:read'] },
      schema: {
        summary: 'List user audit log entries',
        description:
          'Every state-changing call by any principal, plus file views, logins, logouts, MFA ' +
          'changes, environment switches and what the system did with no principal (actor ' +
          '`{ type: "system", id: null }`), newest first. Filters: `action`, `actor-id`, ' +
          '`resource-type`, `resource-id`, the `created-at` range, `action-prefix`, `from` ' +
          '(included), `to` (excluded) and `ip`, one exact address matched through a keyed ' +
          'index, which needs `pii:view` (503 when the process has no blind-index key).',
        tags: ['user-audit-logs'],
        querystring: listUserAuditLogsQuerySchema,
        response: { 200: userAuditLogListDocumentSchema, ...problemResponses(400, 401, 403, 503) },
      },
    },
    (request) => {
      const principal = requirePrincipal(request);
      return listAuditExplorerDocument(
        db,
        principal.environmentId,
        request.query,
        piiMaskFor(principal),
        request.routeOptions.url ?? '',
        { piiView: canViewPii(principal) },
      );
    },
  );

  app.get(
    '/user-audit-logs/:id',
    {
      config: { scopes: ['audit-logs:read'] },
      schema: {
        summary: 'Get a user audit log entry',
        tags: ['user-audit-logs'],
        params: z.object({ id: idSchema('aud') }),
        response: { 200: userAuditLogDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    (request) => {
      const principal = requirePrincipal(request);
      return getUserAuditLogDocument(
        db,
        principal.environmentId,
        request.params.id,
        piiMaskFor(principal),
      );
    },
  );

  done();
};
