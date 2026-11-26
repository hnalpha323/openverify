/**
 * C140.1 (Workflow 8B): case actions under `/api/v1`, and running one on a case, mirroring the account
 * paths (C118.7, Stage 1a amendment 26). The schemas and scopes are frozen (Stage 1b (C),
 * `foundation-8b`); `api-case-workflows` owns this file and builds the handlers
 * (`services/cases/actions/service.ts`), which answer 501 until then.
 *
 * `run-action` and `available-actions` need `workflows:trigger` here; the service adds `cases:read`
 * and the version's grant (C121.3), so a refusal names every missing scope.
 *
 * Workflow 9B (C172.5): an action's placement and `visible-when` are stored and served, and
 * `visible-when` is applied by one rule in `available-actions` and `run-action` (`api-cases-reports`,
 * `services/cases/layout/action-visibility.ts`). The 501 the routes still declare is foundation-9b's
 * fail-closed answer, kept in the snapshot until `integration-9b` regenerates it.
 */
import {
  caseActionDocumentSchema,
  caseActionListDocumentSchema,
  caseAvailableActionListDocumentSchema,
  createCaseActionBodySchema,
  idSchema,
  listCaseActionsQuerySchema,
  runCaseActionBodySchema,
  runCaseActionDocumentSchema,
  updateCaseActionBodySchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import {
  createCaseAction,
  getCaseAction,
  listAvailableCaseActions,
  listCaseActions,
  runCaseAction,
  updateCaseAction,
} from '../../services/cases/actions/service.js';
import type { ApiDependencies } from '../../services/context.js';
import { idempotencyKeyOf } from './workflow-triggers.js';
import { workflowActingOf } from './workflows.js';

const TAGS = ['case-actions'];

const params = z.object({ id: idSchema('cact') });
const caseParams = z.object({ id: idSchema('case') });

/** C140.1 case action routes, under `/api/v1`. */
export const caseActionRoutes: FastifyPluginCallbackZod<ApiDependencies> = (app, deps, done) => {
  app.post(
    '/case-actions',
    {
      config: { scopes: ['workflows:write'] },
      schema: {
        summary: 'Create a case action',
        description:
          'C140.1: binds a running `trigger-case` workflow to 1 to 50 case templates, with a ' +
          'label and a parameter form.',
        tags: TAGS,
        body: createCaseActionBodySchema,
        response: {
          201: caseActionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422),
        },
      },
    },
    async (request, reply) => {
      const document = await createCaseAction(deps, workflowActingOf(request), request.body);
      return reply.code(201).send(document);
    },
  );

  app.get(
    '/case-actions',
    {
      config: { scopes: ['workflows:write'] },
      schema: {
        summary: 'List case actions',
        description: 'Newest first (C1).',
        tags: TAGS,
        querystring: listCaseActionsQuerySchema,
        response: { 200: caseActionListDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    (request) => listCaseActions(deps, workflowActingOf(request), request.query),
  );

  app.get(
    '/case-actions/:id',
    {
      config: { scopes: ['workflows:write'] },
      schema: {
        summary: 'Retrieve a case action',
        description: 'C140.1.',
        tags: TAGS,
        params,
        response: { 200: caseActionDocumentSchema, ...problemResponses(401, 403, 404) },
      },
    },
    (request) => getCaseAction(deps, workflowActingOf(request), request.params.id),
  );

  app.patch(
    '/case-actions/:id',
    {
      config: { scopes: ['workflows:write'] },
      schema: {
        summary: 'Update a case action',
        description: 'C140.1: its label, templates, prefill and status.',
        tags: TAGS,
        params,
        body: updateCaseActionBodySchema,
        response: {
          200: caseActionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422),
        },
      },
    },
    (request) => updateCaseAction(deps, workflowActingOf(request), request.params.id, request.body),
  );

  app.post(
    '/cases/:id/run-action',
    {
      config: { scopes: ['workflows:trigger'] },
      schema: {
        summary: 'Run a case action on a case',
        description:
          'C140.1: needs `workflows:trigger`, `cases:read` and the version’s grant (C121.3); ' +
          'answers the started run’s id.',
        tags: TAGS,
        params: caseParams,
        body: runCaseActionBodySchema,
        response: {
          200: runCaseActionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 410, 422, 429),
        },
      },
    },
    (request) =>
      runCaseAction(
        deps,
        workflowActingOf(request),
        request.params.id,
        request.body,
        idempotencyKeyOf(request),
      ),
  );

  app.get(
    '/cases/:id/available-actions',
    {
      config: { scopes: ['workflows:trigger'] },
      schema: {
        summary: 'List the case actions a caller may run on a case',
        description:
          'H14: filtered by the caller’s grant, with each form prefilled under the caller’s mask ' +
          '(P38). Needs `cases:read` too.',
        tags: TAGS,
        params: caseParams,
        response: {
          200: caseAvailableActionListDocumentSchema,
          ...problemResponses(401, 403, 404),
        },
      },
    },
    (request) => listAvailableCaseActions(deps, workflowActingOf(request), request.params.id),
  );

  done();
};
