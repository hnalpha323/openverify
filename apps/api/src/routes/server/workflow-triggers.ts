/**
 * C118.2, C118.5, C118.1 (Workflow 8A): the routes that start a run, and the deliveries the runs view
 * reads, under `/api/v1`. The trigger route alone takes a 14 MiB body, for its file values (C118.2);
 * Fastify's 1 MiB default stays everywhere else. The schemas and scopes are frozen (Stage 1b (E),
 * `foundation-8a`); `api-triggers` builds the handlers (`workflows/triggers/service.ts`).
 */
import {
  WORKFLOW_TRIGGER_LIMITS,
  createWorkflowManualRunsBodySchema,
  idSchema,
  listWorkflowTriggerDeliveriesQuerySchema,
  triggerWorkflowBodySchema,
  workflowManualRunsDocumentSchema,
  workflowRunDocumentSchema,
  workflowTriggerDeliveryListDocumentSchema,
} from '@openverify/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import type { ApiDependencies } from '../../services/context.js';
import {
  createWorkflowManualRuns,
  listWorkflowTriggerDeliveries,
  triggerWorkflow,
} from '../../workflows/triggers/service.js';
import { workflowActingOf } from './workflows.js';

/** C112.6: a run's key outlives C12's 24-hour store. */
export function idempotencyKeyOf(request: FastifyRequest): string | undefined {
  const key = request.headers['idempotency-key'];
  return typeof key === 'string' ? key : undefined;
}

const TAGS = ['workflows'];
const params = z.object({ id: idSchema('wfl') });

/** C118 trigger routes, under `/api/v1`. */
export const workflowTriggerRoutes: FastifyPluginCallbackZod<ApiDependencies> = (
  app,
  deps,
  done,
) => {
  app.post(
    '/workflows/:id/trigger',
    {
      bodyLimit: WORKFLOW_TRIGGER_LIMITS['body-bytes'].value,
      config: { scopes: ['workflows:trigger'] },
      schema: {
        summary: 'Trigger a workflow',
        description:
          'C118.2: `data.attributes.fields`, validated by the live version’s inputs. Answers the ' +
          'created run, in progress. The caller needs every scope of the version’s grant ' +
          '(C121.3). A paused or archived workflow answers 409 `workflow_not_running`.',
        tags: TAGS,
        params,
        body: triggerWorkflowBodySchema,
        response: {
          200: workflowRunDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422, 429),
        },
      },
    },
    (request) =>
      triggerWorkflow(
        deps,
        workflowActingOf(request),
        request.params.id,
        request.body,
        idempotencyKeyOf(request),
      ),
  );

  app.post(
    '/workflows/:id/manual-runs',
    {
      config: { scopes: ['workflows:trigger'] },
      schema: {
        summary: 'Start manual runs',
        description: 'C118.5: one run per object, from `object-ids` or a CSV of ids.',
        tags: TAGS,
        params,
        body: createWorkflowManualRunsBodySchema,
        response: {
          200: workflowManualRunsDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422, 429),
        },
      },
    },
    (request) =>
      createWorkflowManualRuns(
        deps,
        workflowActingOf(request),
        request.params.id,
        request.body,
        idempotencyKeyOf(request),
      ),
  );

  app.get(
    '/workflow-trigger-deliveries',
    {
      config: { scopes: ['workflow-runs:read'] },
      schema: {
        summary: 'List trigger deliveries',
        description:
          'C118.1 (H18): refused, filtered and expired deliveries with their reason codes.',
        tags: ['workflow-runs'],
        querystring: listWorkflowTriggerDeliveriesQuerySchema,
        response: {
          200: workflowTriggerDeliveryListDocumentSchema,
          ...problemResponses(400, 401, 403),
        },
      },
    },
    (request) => listWorkflowTriggerDeliveries(deps, workflowActingOf(request), request.query),
  );

  done();
};
