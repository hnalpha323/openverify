/**
 * C112.6, C122.4 (Workflow 8A): the action catalogue, which the console's palette renders. The schema
 * and scope are frozen (Stage 1b (E), `foundation-8a`); `api-engine` owns this file and builds the
 * handler (`workflows/runs/service.ts`), which answers 501 until then.
 */
import {
  listWorkflowActionsQuerySchema,
  workflowActionListDocumentSchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { problemResponses } from '../../plugins/openapi.js';
import type { ApiDependencies } from '../../services/context.js';
import { listWorkflowActions } from '../../workflows/runs/service.js';
import { workflowActingOf } from './workflows.js';

/** C122.4 action catalogue route, under `/api/v1`. */
export const workflowActionRoutes: FastifyPluginCallbackZod<ApiDependencies> = (
  app,
  deps,
  done,
) => {
  app.get(
    '/workflow-actions',
    {
      config: { scopes: ['workflows:read'] },
      schema: {
        summary: 'List workflow actions',
        description:
          'C122.4: each action version, with its schemas and whether it is available here.',
        tags: ['workflows'],
        querystring: listWorkflowActionsQuerySchema,
        response: { 200: workflowActionListDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    (request) => listWorkflowActions(deps, workflowActingOf(request)),
  );

  done();
};
