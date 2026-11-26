/**
 * C138.3 (Workflow 8B): `POST /cases/:id/print` under `/api/v1`. The schema and scope are frozen
 * (Stage 1b (C), `foundation-8b`); `api-case-files` owns this file and builds the handler
 * (`services/cases/exports/print.ts`), which answers 501 until then.
 */
import { caseDocumentSchema, idSchema, printCaseBodySchema } from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import type { ApiDependencies } from '../../services/context.js';
import { printCase } from '../../services/cases/exports/print.js';
import { workflowActingOf } from './workflows.js';

/** C138.3 print route, under `/api/v1`. */
export const casePrintRoutes: FastifyPluginCallbackZod<ApiDependencies> = (app, deps, done) => {
  app.post(
    '/cases/:id/print',
    {
      config: { scopes: ['cases:read'] },
      schema: {
        summary: 'Record that a case is printed',
        description:
          'C138.3: writes the audit entry and fires `case.print-initiated` before the console ' +
          'opens the browser’s print dialog. No server-made PDF (decision 72).',
        tags: ['cases'],
        params: z.object({ id: idSchema('case') }),
        body: printCaseBodySchema,
        response: { 200: caseDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    (request) => printCase(deps, workflowActingOf(request), request.params.id, request.body),
  );

  done();
};
