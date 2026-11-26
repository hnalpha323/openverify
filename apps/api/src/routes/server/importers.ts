/**
 * C100.1 (Workflow 7B): the importer routes under `/api/v1`: `POST /importer/list-item/<plural>`
 * per kind with an importer, `GET /importers`, `GET /importers/:id` and `GET /importers/:id/errors`.
 * The schemas and scopes are frozen (Stage 1b (L), `foundation-7b`); `api-importers` owns this file
 * and the handlers (`services/importers/importers.ts`).
 *
 * A create takes JSON with a base64 `file`, or multipart (`data[attributes][file]` and
 * `data[attributes][list-id]`), at most 20 MB either way. The multipart body is buffered
 * (`parseAs: 'buffer'`) so `Idempotency-Key` can fingerprint it, and the stored API log keeps only
 * metadata; a JSON `file` is logged as its length and SHA-256 (F23). It needs `importers:write` with
 * `lists:write`, and takes the C12 policy `importers`.
 */
import {
  IMPORTER_LIST_KINDS,
  IMPORT_LIMITS,
  LIST_KIND_REGISTRY,
  createImporterBodySchema,
  idSchema,
  importerDocumentSchema,
  importerErrorListDocumentSchema,
  importerListDocumentSchema,
  listImporterErrorsQuerySchema,
  listImportersQuerySchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import type { ApiDependencies } from '../../services/context.js';
import {
  createImporter,
  getImporterDocument,
  listImporterErrors,
  listImporters,
} from '../../services/importers/importers.js';
import { actingOf } from './inquiries.js';

const TAGS = ['importers'];

/** C100.1: a 20 MB file as base64, with room for the document or the multipart framing. */
export const IMPORTER_BODY_LIMIT_BYTES = Math.ceil(IMPORT_LIMITS.fileBytes / 3) * 4 + 4096;

const params = z.object({ id: idSchema('mprt') });

/**
 * The create route's validator: zod for a JSON document; a buffered multipart body is read and
 * checked by the handler. Fastify types `schema` as the whole route schema, but compiles each part
 * with that part's zod schema, which is what is passed on.
 */
function jsonBodyValidator(route: {
  schema: unknown;
  method: string;
  url: string;
  httpPart?: string;
}) {
  const validate = validatorCompiler({
    schema: route.schema as z.ZodType,
    method: route.method,
    url: route.url,
  });
  return (value: unknown) =>
    route.httpPart === 'body' && value instanceof Uint8Array ? { value } : validate(value);
}

/** C100.1 importer routes, under `/api/v1`. */
export const importerRoutes: FastifyPluginCallbackZod<ApiDependencies> = (app, deps, done) => {
  app.addContentTypeParser(
    'multipart/form-data',
    { parseAs: 'buffer', bodyLimit: IMPORTER_BODY_LIMIT_BYTES },
    (_request, body, parsed) => {
      parsed(null, body);
    },
  );

  for (const kind of IMPORTER_LIST_KINDS) {
    app.post(
      `/importer/list-item/${LIST_KIND_REGISTRY[kind].plural}`,
      {
        bodyLimit: IMPORTER_BODY_LIMIT_BYTES,
        validatorCompiler: jsonBodyValidator,
        config: { scopes: ['importers:write', 'lists:write'] },
        schema: {
          summary: `Import ${kind} list items`,
          description:
            'C100.1: multipart or JSON with a base64 `file`, at most 20 MB. Answers an importer; ' +
            'the rows are read by a job.',
          tags: TAGS,
          consumes: ['application/json', 'multipart/form-data'],
          body: createImporterBodySchema,
          response: {
            201: importerDocumentSchema,
            ...problemResponses(400, 401, 403, 404, 409, 413, 422, 429),
          },
        },
      },
      async (request, reply) => {
        const document = await createImporter(
          deps,
          actingOf(request),
          kind,
          request.body,
          request.headers['content-type'] ?? '',
        );
        return reply.code(201).send(document);
      },
    );
  }

  app.get(
    '/importers',
    {
      config: { scopes: ['importers:read'] },
      schema: {
        summary: 'List the importers',
        tags: TAGS,
        querystring: listImportersQuerySchema,
        response: { 200: importerListDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    (request) => listImporters(deps, actingOf(request), request.query),
  );

  app.get(
    '/importers/:id',
    {
      config: { scopes: ['importers:read'] },
      schema: {
        summary: 'Fetch an importer',
        tags: TAGS,
        params,
        response: { 200: importerDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    (request) => getImporterDocument(deps, actingOf(request), request.params.id),
  );

  app.get(
    '/importers/:id/errors',
    {
      config: { scopes: ['importers:read'] },
      schema: {
        summary: 'List an importer’s errors',
        description: 'C100.1: a code, a row and a column, never a value; at most 1,000.',
        tags: TAGS,
        params,
        querystring: listImporterErrorsQuerySchema,
        response: { 200: importerErrorListDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    (request) => listImporterErrors(deps, actingOf(request), request.params.id, request.query),
  );

  done();
};
