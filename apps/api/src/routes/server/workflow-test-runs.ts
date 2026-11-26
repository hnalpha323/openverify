/**
 * C120.7 (Workflow 8A): a test run, in sandbox environments only. The schema and scope are frozen
 * (Stage 1b (E), `foundation-8a`); `api-engine` owns this file and builds the handler
 * (`workflows/runs/service.ts`), which answers 501 until then.
 */
import {
  createWorkflowTestRunBodySchema,
  idSchema,
  workflowRunDocumentSchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import type { ApiDependencies } from '../../services/context.js';
import { createWorkflowTestRun } from '../../workflows/runs/service.js';
import { workflowActingOf } from './workflows.js';

/** C120.7 test run route, under `/api/v1`. */
export const workflowTestRunRoutes: FastifyPluginCallbackZod<ApiDependencies> = (
  app,
  deps,
  done,
) => {
  app.post(
    '/workflows/:id/test-runs',
    {
      config: { scopes: ['workflows:trigger'] },
      schema: {
        summary: 'Start a test run',
        description:
          'C120.7: in sandbox environments only, on the draft or a published version. An ' +
          'irreversible step is simulated unless acknowledged, every message is recorded, and an ' +
          'HTTPS step makes no call unless the request allows its host.',
        tags: ['workflow-runs'],
        params: z.object({ id: idSchema('wfl') }),
        body: createWorkflowTestRunBodySchema,
        response: {
          201: workflowRunDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422),
        },
      },
    },
    async (request, reply) => {
      const document = await createWorkflowTestRun(
        deps,
        workflowActingOf(request),
        request.params.id,
        request.body,
      );
      return reply.code(201).send(document);
    },
  );

  done();
};
