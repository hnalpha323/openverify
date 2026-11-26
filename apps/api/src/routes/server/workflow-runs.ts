/**
 * C112.6, C120 (Workflow 8A): the run routes under `/api/v1`. `workflow-runs:read` is not for viewers,
 * and values are masked fail closed by the registry's marks (C120.6). The schemas and scopes are
 * frozen (Stage 1b (E), `foundation-8a`); `api-engine` owns this file and builds the handlers
 * (`workflows/runs/service.ts`), which answer 501 until then.
 */
import {
  cancelWorkflowRunBodySchema,
  cancelWorkflowRunsBodySchema,
  cancelWorkflowRunsDocumentSchema,
  getWorkflowRunQuerySchema,
  idSchema,
  listWorkflowRunStepsQuerySchema,
  listWorkflowRunsQuerySchema,
  rerunWorkflowRunBodySchema,
  resumeWorkflowRunBodySchema,
  workflowRunDocumentSchema,
  workflowRunIncludeDocumentSchema,
  workflowRunListDocumentSchema,
  workflowRunStepListDocumentSchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import type { ApiDependencies } from '../../services/context.js';
import {
  cancelWorkflowRun,
  cancelWorkflowRuns,
  getWorkflowRunDocument,
  listWorkflowRunSteps,
  listWorkflowRuns,
  redactWorkflowRun,
  rerunWorkflowRun,
  resumeWorkflowRun,
} from '../../workflows/runs/service.js';
import { optionalBody } from './inquiries.js';
import { workflowActingOf } from './workflows.js';

const TAGS = ['workflow-runs'];
const params = z.object({ id: idSchema('wfr') });

/** C120 run routes, under `/api/v1`. */
export const workflowRunRoutes: FastifyPluginCallbackZod<ApiDependencies> = (app, deps, done) => {
  app.get(
    '/workflow-runs',
    {
      config: { scopes: ['workflow-runs:read'] },
      schema: {
        summary: 'List workflow runs',
        description:
          'Newest first (C1). `filter[status]` filters by status: the public specification’s ' +
          'description of it says workflow id, and OpenVerify follows the parameter’s name.',
        tags: TAGS,
        querystring: listWorkflowRunsQuerySchema,
        response: { 200: workflowRunListDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    (request) => listWorkflowRuns(deps, workflowActingOf(request), request.query),
  );

  app.get(
    '/workflow-runs/:id',
    {
      config: { scopes: ['workflow-runs:read'] },
      schema: {
        summary: 'Retrieve a workflow run',
        description: 'C120.1. Values are masked without PII visibility (C120.6).',
        tags: TAGS,
        params,
        querystring: getWorkflowRunQuerySchema,
        response: {
          200: workflowRunIncludeDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    (request) =>
      getWorkflowRunDocument(deps, workflowActingOf(request), request.params.id, request.query),
  );

  app.get(
    '/workflow-runs/:id/steps',
    {
      config: { scopes: ['workflow-runs:read'] },
      schema: {
        summary: 'List a run’s steps',
        description: 'C117.2. Values are masked without PII visibility (C120.6).',
        tags: TAGS,
        params,
        querystring: listWorkflowRunStepsQuerySchema,
        response: {
          200: workflowRunStepListDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    (request) =>
      listWorkflowRunSteps(deps, workflowActingOf(request), request.params.id, request.query),
  );

  app.post(
    '/workflow-runs/:id/resume',
    {
      config: { scopes: ['workflow-runs:write'] },
      schema: {
        summary: 'Resume a run',
        description:
          'C120.3: re-readies an errored run’s failed step, never repeating a `done` effect. An ' +
          '`unknown` effect blocks it unless `meta.skip-unknown-effects` acknowledges it.',
        tags: TAGS,
        params,
        body: optionalBody(resumeWorkflowRunBodySchema),
        response: { 200: workflowRunDocumentSchema, ...problemResponses(400, 401, 403, 404, 409) },
      },
    },
    (request) =>
      resumeWorkflowRun(deps, workflowActingOf(request), request.params.id, request.body),
  );

  app.post(
    '/workflow-runs/:id/rerun',
    {
      config: { scopes: ['workflow-runs:write'] },
      schema: {
        summary: 'Rerun a run',
        description: 'C120.4: a new run of the latest published version, with the same inputs.',
        tags: TAGS,
        params,
        body: optionalBody(rerunWorkflowRunBodySchema),
        response: {
          201: workflowRunDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409),
        },
      },
    },
    async (request, reply) => {
      const document = await rerunWorkflowRun(deps, workflowActingOf(request), request.params.id);
      return reply.code(201).send(document);
    },
  );

  app.post(
    '/workflow-runs/:id/cancel',
    {
      config: { scopes: ['workflow-runs:write'] },
      schema: {
        summary: 'Cancel a run',
        description: 'C120.5: effects already made stay made.',
        tags: TAGS,
        params,
        body: optionalBody(cancelWorkflowRunBodySchema),
        response: { 200: workflowRunDocumentSchema, ...problemResponses(400, 401, 403, 404, 409) },
      },
    },
    (request) => cancelWorkflowRun(deps, workflowActingOf(request), request.params.id),
  );

  app.post(
    '/workflows/:id/cancel-runs',
    {
      config: { scopes: ['workflow-runs:write'] },
      schema: {
        summary: 'Cancel the runs of older versions',
        description: 'C116.2: the unfinished runs of versions older than `meta.before-version-id`.',
        tags: TAGS,
        params: z.object({ id: idSchema('wfl') }),
        body: cancelWorkflowRunsBodySchema,
        response: {
          200: cancelWorkflowRunsDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    (request) =>
      cancelWorkflowRuns(deps, workflowActingOf(request), request.params.id, request.body),
  );

  app.delete(
    '/workflow-runs/:id',
    {
      config: { scopes: ['workflow-runs:redact'] },
      schema: {
        summary: 'Redact a run',
        description: 'C120.9 (P35): nulls one run’s sealed values and deletes its trigger files.',
        tags: TAGS,
        params,
        response: { 200: workflowRunDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    (request) => redactWorkflowRun(deps, workflowActingOf(request), request.params.id),
  );

  done();
};
