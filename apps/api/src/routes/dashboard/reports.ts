/**
 * C72.3 (Phase 6): `GET /api/v1/dashboard/reports` and `GET /api/v1/dashboard/reports/:id`
 * (`reports:read`), the console's masked report documents: the list with the public filters, and
 * one report with its runs and actions included (and its matches in the resource). PII is masked
 * without `pii:view` (C70.3). The schemas and scopes are frozen (Workflow 6A Stage 1b,
 * `foundation-6`); `api-reports` owns this file and builds the handlers.
 */
import {
  dashboardReportDocumentSchema,
  dashboardReportListDocumentSchema,
  idSchema,
  listReportsQuerySchema,
} from '@openverify/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { piiMaskFor } from '../../auth/pii.js';
import { problemResponses } from '../../plugins/openapi.js';
import {
  DASHBOARD_REPORTS_PATH,
  dashboardReportDocument,
  listReportResources,
} from '../../services/reports/reports.js';
import type { AdminRouteContext } from './admin-context.js';
import { operatorPrincipal, requireOperator } from './authenticate.js';
import { DASHBOARD_TAG, USER_SESSION_SECURITY } from './openapi.js';

export const dashboardReportRoutes: FastifyPluginAsyncZod<AdminRouteContext> = (app, context) => {
  app.get(
    '/reports',
    {
      config: { scopes: ['reports:read'] },
      schema: {
        summary: 'List reports for the console, newest first',
        description:
          'C72.3, C86: the filters of `GET /api/v1/reports`; masked without `pii:view`. An ' +
          'errored report was not screened, never "no match" (C69.4).',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        querystring: listReportsQuerySchema,
        response: {
          200: dashboardReportListDocumentSchema,
          ...problemResponses(400, 401, 403),
        },
      },
    },
    (request) => {
      const operator = requireOperator(request);
      return listReportResources(
        context,
        operator.environmentId,
        request.query,
        piiMaskFor(operatorPrincipal(operator)),
        DASHBOARD_REPORTS_PATH,
      );
    },
  );

  app.get(
    '/reports/:id',
    {
      config: { scopes: ['reports:read'] },
      schema: {
        summary: 'Fetch a report for the console',
        description:
          'C72.3, C86: the report with its matches, and its runs and actions in `included`; ' +
          'masked without `pii:view`.',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        params: z.object({ id: idSchema('rep') }),
        response: {
          200: dashboardReportDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    (request) => {
      const operator = requireOperator(request);
      return dashboardReportDocument(
        context,
        operator.environmentId,
        request.params.id,
        piiMaskFor(operatorPrincipal(operator)),
      );
    },
  );
  return Promise.resolve();
};
