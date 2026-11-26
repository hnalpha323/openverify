/**
 * C112.6, C116.6 (Workflow 8A): the version routes under `/api/v1`. The list keeps its public
 * semantics: published versions and the draft, newest first, never archived. Frozen by
 * `foundation-8a` and built by `api-workflows` (`workflows/definitions/service.ts`).
 */
import {
  idSchema,
  listWorkflowVersionsQuerySchema,
  workflowVersionDiffDocumentSchema,
  workflowVersionDiffQuerySchema,
  workflowVersionDocumentSchema,
  workflowVersionListDocumentSchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import type { ApiDependencies } from '../../services/context.js';
import {
  getWorkflowVersionDiff,
  getWorkflowVersionDocument,
  listWorkflowVersions,
} from '../../workflows/definitions/service.js';
import { workflowActingOf } from './workflows.js';

const TAGS = ['workflow-versions'];
const params = z.object({ id: idSchema('wfv') });

/** C112.6 version routes, under `/api/v1`. */
export const workflowVersionRoutes: FastifyPluginCallbackZod<ApiDependencies> = (
  app,
  deps,
  done,
) => {
  app.get(
    '/workflow-versions',
    {
      config: { scopes: ['workflows:read'] },
      schema: {
        summary: 'List workflow versions',
        description:
          'Published versions and the draft of `filter[workflow-id]`, which is required, newest ' +
          'first.',
        tags: TAGS,
        querystring: listWorkflowVersionsQuerySchema,
        response: { 200: workflowVersionListDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    (request) => listWorkflowVersions(deps, workflowActingOf(request), request.query),
  );

  app.get(
    '/workflow-versions/:id',
    {
      config: { scopes: ['workflows:read'] },
      schema: {
        summary: 'Retrieve a workflow version',
        description: 'C112.4.',
        tags: TAGS,
        params,
        response: { 200: workflowVersionDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    (request) => getWorkflowVersionDocument(deps, workflowActingOf(request), request.params.id),
  );

  app.get(
    '/workflow-versions/:id/diff',
    {
      config: { scopes: ['workflows:read'] },
      schema: {
        summary: 'Compare two workflow versions',
        description:
          'C116.6: computed on the server, keyed by step id, against the version in `against`. ' +
          'Layout-only changes are listed apart.',
        tags: TAGS,
        params,
        querystring: workflowVersionDiffQuerySchema,
        response: {
          200: workflowVersionDiffDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    (request) =>
      getWorkflowVersionDiff(deps, workflowActingOf(request), request.params.id, request.query),
  );

  done();
};
