/**
 * C128.1, C128.6 (Workflow 8A): the reopen of a decline and the read of the decision records. The
 * schemas and scopes are frozen (Stage 1b (A), `foundation-8a`); `api-actions` owns this file and
 * builds the handlers (`services/decisions/service.ts`), which answer 501 until then.
 *
 * `GET /decisions` names no scope here, because the one it needs is its subject's read scope (V10),
 * which the service reads from `filter[subject-id]`.
 */
import {
  decisionListDocumentSchema,
  idSchema,
  inquiryDocumentSchema,
  listDecisionsQuerySchema,
  reopenInquiryBodySchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import type { ApiDependencies } from '../../services/context.js';
import { listDecisions, reopenInquiry } from '../../services/decisions/service.js';
import { actingOf } from './inquiries.js';
import { workflowActingOf } from './workflows.js';

/** C128 decision routes, under `/api/v1`. */
export const inquiryDecisionRoutes: FastifyPluginCallbackZod<ApiDependencies> = (
  app,
  deps,
  done,
) => {
  app.post(
    '/inquiries/:id/reopen',
    {
      config: { scopes: ['inquiries:write'] },
      schema: {
        summary: 'Reopen a declined inquiry for human review',
        description:
          'C128.6: `declined` → `needs_review`, for a user only, with a required `meta.comment`. ' +
          'Emits `inquiry.reopened` and `inquiry.transitioned`. Until a user decides, a decline by ' +
          'a run or an API key answers `human_review_pending`. A decline’s biometric deletion is ' +
          'not undone. A redacted inquiry answers 410.',
        tags: ['inquiries'],
        params: z.object({ id: idSchema('inq') }),
        body: reopenInquiryBodySchema,
        response: {
          200: inquiryDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 410),
        },
      },
    },
    async (request) => ({
      data: await reopenInquiry(
        deps,
        actingOf(request),
        request.params.id,
        request.body.meta.comment,
      ),
    }),
  );

  app.get(
    '/decisions',
    {
      schema: {
        summary: 'List the decisions about a subject',
        description:
          'C128.1: `filter[subject-id]` is required (400 `filter_required`), an inquiry, ' +
          'transaction, account or list item, and the route needs that subject’s read scope. ' +
          'Newest first. A comment reads `null` without PII visibility and after redaction.',
        tags: ['decisions'],
        querystring: listDecisionsQuerySchema,
        response: { 200: decisionListDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    (request) => {
      const { principal, ...acting } = workflowActingOf(request);
      return listDecisions(deps, acting, principal, request.query);
    },
  );

  done();
};
