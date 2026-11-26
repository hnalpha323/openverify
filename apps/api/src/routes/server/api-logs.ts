import {
  apiLogDocumentSchema,
  apiLogListDocumentSchema,
  idSchema,
  listApiLogsQuerySchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requirePrincipal } from '../../plugins/principal-auth.js';
import { problemResponses } from '../../plugins/openapi.js';
import { getApiLog, listApiLogs } from '../../services/api-logs.js';
import type { ApiDependencies } from '../../services/context.js';

const TAGS = ['api-logs'];
const PII_NOTE =
  'Users without `pii:view` get `ip-address`, `user-agent`, and every `fields` value, `note`, ' +
  '`ip-address` and `user-agent` inside the query and bodies, as `null`.';

/** C12 API log routes (scope `api-logs:read`), under `/api/v1`. */
export const apiLogRoutes: FastifyPluginCallbackZod<ApiDependencies> = (app, deps, done) => {
  app.get(
    '/api-logs',
    {
      config: { scopes: ['api-logs:read'] },
      schema: {
        summary: 'List API logs, newest first',
        description:
          'Every server API request of the environment, 4xx and 5xx included. Filters: ' +
          '`method`, `status` (a code such as `404` or a class such as `4xx`), `route` (the ' +
          'route template), `api-key-id`, `user-id` (C25.9: requests made with a dashboard ' +
          'session of that user) and the `created-at` range; comma-separated values ' +
          `mean OR. Secrets in the query and bodies read \`[REDACTED]\`. ${PII_NOTE}`,
        tags: TAGS,
        querystring: listApiLogsQuerySchema,
        response: { 200: apiLogListDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    (request) => listApiLogs(deps, requirePrincipal(request), request.query),
  );

  app.get(
    '/api-logs/:id',
    {
      config: { scopes: ['api-logs:read'] },
      schema: {
        summary: 'Fetch an API log entry',
        description: `Bodies over 64 KiB are stored as \`{ truncated, byte-length, preview }\`. ${PII_NOTE}`,
        tags: TAGS,
        params: z.object({ id: idSchema('alog') }),
        response: { 200: apiLogDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    async (request) => ({
      data: await getApiLog(deps, requirePrincipal(request), request.params.id),
    }),
  );

  done();
};
