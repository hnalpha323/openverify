/**
 * C132.2 (Workflow 8B): case assignment policies under `/api/v1`. The schemas and scopes are frozen
 * (Stage 1b (Q), `foundation-8b`); `api-queues-sla` owns this file and builds the handlers
 * (`services/cases/assignment/policies.ts`), which answer 501 until then. A policy has no delete route
 * (C129.5).
 */
import {
  caseAssignmentPolicyDocumentSchema,
  caseAssignmentPolicyListDocumentSchema,
  createCaseAssignmentPolicyBodySchema,
  idSchema,
  listCaseAssignmentPoliciesQuerySchema,
  updateCaseAssignmentPolicyBodySchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import type { ApiDependencies } from '../../services/context.js';
import {
  createCaseAssignmentPolicy,
  getCaseAssignmentPolicy,
  listCaseAssignmentPolicies,
  updateCaseAssignmentPolicy,
} from '../../services/cases/assignment/policies.js';
import { workflowActingOf } from './workflows.js';

const TAGS = ['case-assignment-policies'];
const params = z.object({ id: idSchema('cap') });

/** C132.2 assignment policy routes, under `/api/v1`. */
export const caseAssignmentPolicyRoutes: FastifyPluginCallbackZod<ApiDependencies> = (
  app,
  deps,
  done,
) => {
  app.get(
    '/case-assignment-policies',
    {
      config: { scopes: ['case-queues:read'] },
      schema: {
        summary: 'List case assignment policies',
        description: 'C132.2: newest first (C1).',
        tags: TAGS,
        querystring: listCaseAssignmentPoliciesQuerySchema,
        response: {
          200: caseAssignmentPolicyListDocumentSchema,
          ...problemResponses(400, 401, 403),
        },
      },
    },
    (request) => listCaseAssignmentPolicies(deps, workflowActingOf(request), request.query),
  );

  app.post(
    '/case-assignment-policies',
    {
      config: { scopes: ['case-queues:write'] },
      schema: {
        summary: 'Create a case assignment policy',
        description:
          'C132.2: a distribution, a sort, the agents (the routed queue’s members by default), a ' +
          'capacity and the sources, templates or queues of this environment in priority order.',
        tags: TAGS,
        body: createCaseAssignmentPolicyBodySchema,
        response: {
          201: caseAssignmentPolicyDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 422),
        },
      },
    },
    async (request, reply) => {
      const document = await createCaseAssignmentPolicy(
        deps,
        workflowActingOf(request),
        request.body,
      );
      return reply.code(201).send(document);
    },
  );

  app.get(
    '/case-assignment-policies/:id',
    {
      config: { scopes: ['case-queues:read'] },
      schema: {
        summary: 'Retrieve a case assignment policy',
        description: 'C132.2.',
        tags: TAGS,
        params,
        response: { 200: caseAssignmentPolicyDocumentSchema, ...problemResponses(401, 403, 404) },
      },
    },
    (request) => getCaseAssignmentPolicy(deps, workflowActingOf(request), request.params.id),
  );

  app.patch(
    '/case-assignment-policies/:id',
    {
      config: { scopes: ['case-queues:write'] },
      schema: {
        summary: 'Update a case assignment policy',
        description: 'C132.2: what it sends replaces; cases already assigned stay so.',
        tags: TAGS,
        params,
        body: updateCaseAssignmentPolicyBodySchema,
        response: {
          200: caseAssignmentPolicyDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 422),
        },
      },
    },
    (request) =>
      updateCaseAssignmentPolicy(deps, workflowActingOf(request), request.params.id, request.body),
  );

  done();
};
