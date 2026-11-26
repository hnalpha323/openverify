/**
 * C133.1 (Workflow 8B): case SLA policies under `/api/v1`. The schemas and scopes are frozen (Stage 1b
 * (Q), `foundation-8b`); `api-queues-sla` owns this file and builds the handlers
 * (`services/cases/sla/policies.ts`), which answer 501 until then. A policy has no delete route
 * (C129.5).
 */
import {
  caseSlaPolicyDocumentSchema,
  caseSlaPolicyListDocumentSchema,
  createCaseSlaPolicyBodySchema,
  idSchema,
  listCaseSlaPoliciesQuerySchema,
  updateCaseSlaPolicyBodySchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import type { ApiDependencies } from '../../services/context.js';
import {
  createCaseSlaPolicy,
  getCaseSlaPolicy,
  listCaseSlaPolicies,
  updateCaseSlaPolicy,
} from '../../services/cases/sla/policies.js';
import { workflowActingOf } from './workflows.js';

const TAGS = ['case-sla-policies'];
const params = z.object({ id: idSchema('cslap') });

/** C133.1 SLA policy routes, under `/api/v1`. */
export const caseSlaPolicyRoutes: FastifyPluginCallbackZod<ApiDependencies> = (app, deps, done) => {
  app.get(
    '/case-sla-policies',
    {
      config: { scopes: ['case-queues:read'] },
      schema: {
        summary: 'List case SLA policies',
        description: 'C133.1: newest first (C1); `filter[case-calendar-id]` reads a calendar’s.',
        tags: TAGS,
        querystring: listCaseSlaPoliciesQuerySchema,
        response: { 200: caseSlaPolicyListDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    (request) => listCaseSlaPolicies(deps, workflowActingOf(request), request.query),
  );

  app.post(
    '/case-sla-policies',
    {
      config: { scopes: ['case-queues:write'] },
      schema: {
        summary: 'Create a case SLA policy',
        description:
          'C133.1: a target in business minutes on a calendar of this environment, or around the ' +
          'clock, and what a reopen does (`continue` by default, decision 58).',
        tags: TAGS,
        body: createCaseSlaPolicyBodySchema,
        response: {
          201: caseSlaPolicyDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 422),
        },
      },
    },
    async (request, reply) => {
      const document = await createCaseSlaPolicy(deps, workflowActingOf(request), request.body);
      return reply.code(201).send(document);
    },
  );

  app.get(
    '/case-sla-policies/:id',
    {
      config: { scopes: ['case-queues:read'] },
      schema: {
        summary: 'Retrieve a case SLA policy',
        description: 'C133.1, with its revision (C133.4).',
        tags: TAGS,
        params,
        response: { 200: caseSlaPolicyDocumentSchema, ...problemResponses(401, 403, 404) },
      },
    },
    (request) => getCaseSlaPolicy(deps, workflowActingOf(request), request.params.id),
  );

  app.patch(
    '/case-sla-policies/:id',
    {
      config: { scopes: ['case-queues:write'] },
      schema: {
        summary: 'Update a case SLA policy',
        description:
          'C133.1, C133.4: a new revision; a running SLA keeps the revision it started under.',
        tags: TAGS,
        params,
        body: updateCaseSlaPolicyBodySchema,
        response: {
          200: caseSlaPolicyDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 422),
        },
      },
    },
    (request) =>
      updateCaseSlaPolicy(deps, workflowActingOf(request), request.params.id, request.body),
  );

  done();
};
