/**
 * C135.3 (Workflow 8B (F); decision 63, P38): an inquiry file's rendition for the console,
 * `GET /api/v1/dashboard/files/:id/rendition`, on the dashboard API behind the operator's session,
 * with the source file route's scopes (`inquiries:read` and `pii:view`). The console's image views move
 * to it through its own proxy route; the API's own file route is unchanged. The schema and scopes are
 * frozen (Stage 1b (F), `foundation-8b`); `api-case-files` owns this file and builds the handler
 * (`services/cases/attachments/file-renditions.ts`), which answers 501 until then.
 */
import {
  fileRenditionParamsSchema,
  renditionPageQuerySchema,
  renditionPendingDocumentSchema,
} from '@openverify/contracts';
import { CASE_RENDITION_MEDIA_TYPES } from '@openverify/core';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import { getFileRenditionContent } from '../../services/cases/attachments/file-renditions.js';
import { dashboardContextOf, requireOperator, userActor } from './authenticate.js';
import type { DashboardContext } from './context.js';
import { DASHBOARD_TAG, USER_SESSION_SECURITY } from './openapi.js';

/** A rendition page's bytes, sent unserialized. */
const binaryImage = z.instanceof(Buffer);

/** C135.3 rendition route, under `/api/v1/dashboard`. */
export const fileRenditionRoutes: FastifyPluginAsyncZod<DashboardContext> = (app, context) => {
  app.get(
    '/files/:id/rendition',
    {
      // C245.2 (Workflow 11B, auth-sessions; Stage 1a amendment 6): the console's rendition image
      // asks again in the background while a rendition is prepared, so this read is checked against
      // the session's limits but does not count as activity.
      config: { scopes: ['inquiries:read', 'pii:view'], activity: false },
      schema: {
        summary: 'Read a file’s rendition',
        description:
          'C135.3: the file as an image re-encoded without metadata (a PDF’s page `page`), made ' +
          'asynchronously: 202 with `Retry-After` while it is prepared, 422 ' +
          '`rendition_unavailable` when it cannot be made, 404 for a deleted or redacted source. ' +
          'Needs `pii:view`; every view is written to the audit log as `file.viewed`.',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        params: fileRenditionParamsSchema,
        querystring: renditionPageQuerySchema,
        response: {
          200: {
            description: 'The rendition page, an image without metadata.',
            content: Object.fromEntries(
              CASE_RENDITION_MEDIA_TYPES.map((type) => [type, { schema: binaryImage }]),
            ),
          },
          202: renditionPendingDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 422),
        },
      },
    },
    async (request, reply) => {
      const operator = requireOperator(request);
      const content = await getFileRenditionContent(context, {
        ctx: dashboardContextOf(request, context.operatorAuth, operator),
        actor: userActor(operator.user.id),
        fileId: request.params.id,
        page: request.query.page ?? 1,
      });
      if (content.kind === 'pending') {
        return reply
          .code(202)
          .header('retry-after', String(content.retryAfterSeconds))
          .send(content.document);
      }
      return reply
        .header('content-type', content.mediaType)
        .header('cache-control', 'private, no-store')
        .header('x-content-type-options', 'nosniff')
        .send(Buffer.from(content.bytes));
    },
  );

  return Promise.resolve();
};
