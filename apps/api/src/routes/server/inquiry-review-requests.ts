/**
 * C128.7 (P40, V07; Workflow 8B): `POST /inquiries/:id/review-requests` under `/api/v1`. The schema
 * and scope are frozen (Stage 1b (C), `foundation-8b`); `api-case-workflows` owns this file and
 * builds the handler (`services/cases/actions/service.ts`), which answers 501 until then. It opens a
 * case on the contest route's template holding the inquiry, the person's statement a sealed comment;
 * a redacted inquiry answers 410 (outcome 6).
 */
import {
  caseDocumentSchema,
  createInquiryReviewRequestBodySchema,
  idSchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import { createInquiryReviewRequest } from '../../services/cases/actions/service.js';
import type { ApiDependencies } from '../../services/context.js';
import { workflowActingOf } from './workflows.js';

/** C128.7 review request route, under `/api/v1`. */
export const inquiryReviewRequestRoutes: FastifyPluginCallbackZod<ApiDependencies> = (
  app,
  deps,
  done,
) => {
  app.post(
    '/inquiries/:id/review-requests',
    {
      config: { scopes: ['cases:write'] },
      schema: {
        summary: 'Open a review case for a decision about an inquiry',
        description:
          'C128.7: a case on the contest route’s case template, holding the inquiry, with the ' +
          'person’s `meta.statement` as a sealed comment. A redacted inquiry answers 410.',
        tags: ['inquiries'],
        params: z.object({ id: idSchema('inq') }),
        body: createInquiryReviewRequestBodySchema,
        response: {
          201: caseDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 410, 422, 429),
        },
      },
    },
    async (request, reply) => {
      const document = await createInquiryReviewRequest(
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
