/**
 * C134.1, C134.2 (Workflow 8B): a case's comments and a comment's redaction under `/api/v1`. The
 * schemas and scopes are frozen (Stage 1b (C), `foundation-8b`); `api-cases` owns this file and
 * builds the handlers (`services/cases/comments.ts`), which answer 501 until then.
 *
 * The redaction route needs `cases:write`; the service lets the comment's author through, and anyone
 * else only with `cases:redact` (C134.2).
 */
import {
  caseCommentDocumentSchema,
  caseCommentListDocumentSchema,
  idSchema,
  listCaseCommentsQuerySchema,
  redactCaseCommentBodySchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import { listCaseComments, redactCaseComment } from '../../services/cases/comments.js';
import type { ApiDependencies } from '../../services/context.js';
import { workflowActingOf } from './workflows.js';

const TAGS = ['cases'];

/** C134 comment routes, under `/api/v1`. */
export const caseCommentRoutes: FastifyPluginCallbackZod<ApiDependencies> = (app, deps, done) => {
  app.get(
    '/cases/:id/comments',
    {
      config: { scopes: ['cases:read'] },
      schema: {
        summary: 'List a case’s comments',
        description:
          'C134.1: newest first (C1). A message is masked without PII visibility and `null` once ' +
          'redacted.',
        tags: TAGS,
        params: z.object({ id: idSchema('case') }),
        querystring: listCaseCommentsQuerySchema,
        response: { 200: caseCommentListDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    (request) =>
      listCaseComments(deps, workflowActingOf(request), request.params.id, request.query),
  );

  app.post(
    '/case-comments/:id/redact',
    {
      config: { scopes: ['cases:write'] },
      schema: {
        summary: 'Redact a comment',
        description:
          'C134.2: its message is nulled, its ids, author and times kept. Its author may, and ' +
          'anyone else with `cases:redact`.',
        tags: TAGS,
        params: z.object({ id: idSchema('cscm') }),
        body: redactCaseCommentBodySchema,
        response: { 200: caseCommentDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    (request) =>
      redactCaseComment(deps, workflowActingOf(request), request.params.id, request.body),
  );

  done();
};
