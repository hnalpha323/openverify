/**
 * C112.6, C116, C121.2 (Workflow 8A): the workflow routes under `/api/v1`: workflows, their one draft,
 * and publishing, rollout, restore and promote. Publishing has a scope of its own, and those four are
 * user-only (API keys get 403, C121.2), checked by the service. Frozen by `foundation-8a` and built by
 * `api-workflows` (`workflows/definitions/service.ts`).
 */
import {
  activateWorkflowBodySchema,
  archiveWorkflowBodySchema,
  createWorkflowBodySchema,
  getWorkflowQuerySchema,
  idSchema,
  listWorkflowsQuerySchema,
  pauseWorkflowBodySchema,
  promoteWorkflowBodySchema,
  publishWorkflowBodySchema,
  putWorkflowDraftBodySchema,
  restoreWorkflowBodySchema,
  rolloutWorkflowBodySchema,
  updateWorkflowBodySchema,
  validateWorkflowDraftBodySchema,
  workflowDefinitionCheckDocumentSchema,
  workflowDocumentSchema,
  workflowIncludeDocumentSchema,
  workflowListDocumentSchema,
  workflowVersionDocumentSchema,
} from '@openverify/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import { requirePrincipal } from '../../plugins/principal-auth.js';
import type { ApiDependencies } from '../../services/context.js';
import type { WorkflowActing } from '../../workflows/acting.js';
import {
  activateWorkflow,
  archiveWorkflow,
  createWorkflow,
  getWorkflowDocument,
  getWorkflowDraft,
  listWorkflows,
  pauseWorkflow,
  promoteWorkflow,
  publishWorkflow,
  putWorkflowDraft,
  restoreWorkflow,
  rolloutWorkflow,
  updateWorkflow,
  validateWorkflowDraft,
} from '../../workflows/definitions/service.js';
import { actingOf, optionalBody } from './inquiries.js';

const TAGS = ['workflows'];
const params = z.object({ id: idSchema('wfl') });

/** The acting principal of a workflow route, with the principal its services check grants on. */
export function workflowActingOf(request: FastifyRequest): WorkflowActing {
  return { ...actingOf(request), principal: requirePrincipal(request) };
}

/** C112.6 workflow routes, under `/api/v1`. */
export const workflowRoutes: FastifyPluginCallbackZod<ApiDependencies> = (app, deps, done) => {
  app.post(
    '/workflows',
    {
      config: { scopes: ['workflows:write'] },
      schema: {
        summary: 'Create a workflow',
        description: 'C112.3: a workflow or a module, paused, with an empty draft.',
        tags: TAGS,
        body: createWorkflowBodySchema,
        response: {
          201: workflowDocumentSchema,
          ...problemResponses(400, 401, 403, 422),
        },
      },
    },
    async (request, reply) => {
      const document = await createWorkflow(deps, workflowActingOf(request), request.body);
      return reply.code(201).send(document);
    },
  );

  app.get(
    '/workflows',
    {
      config: { scopes: ['workflows:read'] },
      schema: {
        summary: 'List workflows',
        description: 'Newest first (C1).',
        tags: TAGS,
        querystring: listWorkflowsQuerySchema,
        response: { 200: workflowListDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    (request) => listWorkflows(deps, workflowActingOf(request), request.query),
  );

  app.get(
    '/workflows/:id',
    {
      config: { scopes: ['workflows:read'] },
      schema: {
        summary: 'Retrieve a workflow',
        description: 'C112.3. `include` takes its live version and rollout.',
        tags: TAGS,
        params,
        querystring: getWorkflowQuerySchema,
        response: { 200: workflowIncludeDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    (request) =>
      getWorkflowDocument(deps, workflowActingOf(request), request.params.id, request.query),
  );

  app.patch(
    '/workflows/:id',
    {
      config: { scopes: ['workflows:write'] },
      schema: {
        summary: 'Update a workflow',
        description: 'C112.6: the name and the description alone.',
        tags: TAGS,
        params,
        body: updateWorkflowBodySchema,
        response: { 200: workflowDocumentSchema, ...problemResponses(400, 401, 403, 404, 409) },
      },
    },
    (request) => updateWorkflow(deps, workflowActingOf(request), request.params.id, request.body),
  );

  for (const [action, run, summary, body] of [
    ['pause', pauseWorkflow, 'Pause a workflow', pauseWorkflowBodySchema],
    ['activate', activateWorkflow, 'Activate a workflow', activateWorkflowBodySchema],
    ['archive', archiveWorkflow, 'Archive a workflow', archiveWorkflowBodySchema],
  ] as const) {
    app.post(
      `/workflows/:id/${action}`,
      {
        config: { scopes: ['workflows:write'] },
        schema: {
          summary,
          description: 'C112.6. A workflow is archived only once it is paused.',
          tags: TAGS,
          params,
          body: optionalBody(body),
          response: { 200: workflowDocumentSchema, ...problemResponses(400, 401, 403, 404, 409) },
        },
      },
      (request) => run(deps, workflowActingOf(request), request.params.id),
    );
  }

  app.get(
    '/workflows/:id/draft',
    {
      config: { scopes: ['workflows:read'] },
      schema: {
        summary: 'Retrieve the draft',
        description: 'C116.1: at most one draft per workflow.',
        tags: TAGS,
        params,
        response: { 200: workflowVersionDocumentSchema, ...problemResponses(401, 403, 404, 409) },
      },
    },
    (request) => getWorkflowDraft(deps, workflowActingOf(request), request.params.id),
  );

  app.put(
    '/workflows/:id/draft',
    {
      config: { scopes: ['workflows:write'] },
      schema: {
        summary: 'Save the draft',
        description:
          'C116.1: replaces the definition at its `lock-version`. Locked while a rollout runs.',
        tags: TAGS,
        params,
        body: putWorkflowDraftBodySchema,
        response: {
          200: workflowVersionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422),
        },
      },
    },
    (request) => putWorkflowDraft(deps, workflowActingOf(request), request.params.id, request.body),
  );

  app.post(
    '/workflows/:id/draft/validate',
    {
      config: { scopes: ['workflows:write'] },
      schema: {
        summary: 'Validate the draft',
        description:
          'C113.6: answers the problems of the saved draft, or of a definition in the body, ' +
          'without saving anything. `meta.errors` and `meta.warnings` hold JSON Pointers.',
        tags: TAGS,
        params,
        body: optionalBody(validateWorkflowDraftBodySchema),
        response: {
          200: workflowDefinitionCheckDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409),
        },
      },
    },
    (request) =>
      validateWorkflowDraft(deps, workflowActingOf(request), request.params.id, request.body),
  );

  app.post(
    '/workflows/:id/publish',
    {
      config: { scopes: ['workflows:publish'] },
      schema: {
        summary: 'Publish the draft',
        description:
          'C116.4, C121.2: user-only. Freezes the draft under every publish rule, with its ' +
          '`meta.rollout-percentage` (default 100), `meta.description` and ' +
          '`meta.acknowledgements`.',
        tags: TAGS,
        params,
        body: optionalBody(publishWorkflowBodySchema),
        response: {
          200: workflowVersionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422),
        },
      },
    },
    (request) => publishWorkflow(deps, workflowActingOf(request), request.params.id, request.body),
  );

  app.post(
    '/workflows/:id/rollout',
    {
      config: { scopes: ['workflows:publish'] },
      schema: {
        summary: 'Change a rollout',
        description:
          'C116.3: user-only. `meta.rollout-percentage` 100 finishes it, and 0 undoes it.',
        tags: TAGS,
        params,
        body: rolloutWorkflowBodySchema,
        response: {
          200: workflowVersionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422),
        },
      },
    },
    (request) => rolloutWorkflow(deps, workflowActingOf(request), request.params.id, request.body),
  );

  app.post(
    '/workflows/:id/restore',
    {
      config: { scopes: ['workflows:publish'] },
      schema: {
        summary: 'Restore a version',
        description:
          'C116.5: user-only. Creates a draft from `meta.version-id`, which is then published ' +
          'like any draft, so a restore never bypasses a publish rule.',
        tags: TAGS,
        params,
        body: restoreWorkflowBodySchema,
        response: {
          201: workflowVersionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409),
        },
      },
    },
    async (request, reply) => {
      const document = await restoreWorkflow(
        deps,
        workflowActingOf(request),
        request.params.id,
        request.body,
      );
      return reply.code(201).send(document);
    },
  );

  app.post(
    '/workflows/:id/promote',
    {
      config: { scopes: ['workflows:publish'] },
      schema: {
        summary: 'Promote a version',
        description:
          'C112.2: user-only. Copies a published version into `meta.environment-id` as a draft, ' +
          're-resolving each reference there, and never replaces a draft.',
        tags: TAGS,
        params,
        body: promoteWorkflowBodySchema,
        response: {
          201: workflowVersionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422),
        },
      },
    },
    async (request, reply) => {
      const document = await promoteWorkflow(
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
