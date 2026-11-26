/**
 * C173.3 (Workflow 9B; K12, decision 59, review P36): `POST /api/v1/dashboard/print-audits`, written
 * by the console's print button before the browser's print dialog opens, for an inquiry, a report or
 * a verification page. It records use of the print button, not every print (a browser's menu or
 * shortcut writes nothing). A user session is all the route needs: the service checks that the user
 * may read the object. Frozen by `foundation-9b` (Stage 1b (C)) on the stub of
 * `services/print-audits/service.ts`, which answers 501 until `api-cases-reports`, the owner of this
 * file, builds it.
 */
import { createPrintAuditBodySchema, printAuditDocumentSchema } from '@openverify/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { problemResponses } from '../../plugins/openapi.js';
import { createPrintAudit } from '../../services/print-audits/service.js';
import { operatorChange, type AdminRouteContext } from './admin-context.js';
import { DASHBOARD_TAG, USER_SESSION_SECURITY } from './openapi.js';

/** C173.3 print-audit routes, under `/api/v1/dashboard`. */
export const printAuditRoutes: FastifyPluginAsyncZod<AdminRouteContext> = (app, context) => {
  app.post(
    '/print-audits',
    {
      schema: {
        summary: 'Record the use of a print button',
        description:
          'C173.3: writes the audit entry before the browser’s print dialog opens, for an ' +
          'inquiry, a report or a verification the user may read; the entry names the object ' +
          'only. It records the print button, not every print.',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        body: createPrintAuditBodySchema,
        response: {
          201: printAuditDocumentSchema,
          ...problemResponses(400, 401, 404),
        },
      },
    },
    async (request, reply) => {
      const document = await createPrintAudit(
        { db: context.db, audit: context.audit, clock: context.clock },
        operatorChange(request, context),
        request.body,
      );
      return reply.code(201).send(document);
    },
  );

  return Promise.resolve();
};
