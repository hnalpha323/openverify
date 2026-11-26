/**
 * C135.1, C135.4 (Workflow 8B (F); P23): a case's attachments under `/api/v1`. The schemas and scopes
 * are frozen (Stage 1b (F), `foundation-8b`); `api-case-files` owns this file and builds the handlers
 * (`services/cases/attachments/service.ts`), which answer 501 until then. The public upload,
 * `PATCH /cases/:id` with `data.attributes.attachments`, is `cases.ts`' and hands its items to
 * `acceptPatchAttachments`.
 *
 * - `POST /cases/:id/attachments` (`cases:write`): one multipart file of at most 10 MiB, buffered by
 *   this plugin's own parser so that `Idempotency-Key` is honoured, and read by the service.
 * - `GET /cases/:id/attachments/:attachmentId/content` (`cases:read`, and `pii:view` in the handler):
 *   the rendition (a PDF's page `page`), as an attachment named by the server, `nosniff`,
 *   `private, no-store`, audited per view; 202 with `Retry-After` while it is made.
 * - `GET /cases/:id/attachments/:attachmentId/original` (`cases:redact`, and `pii:view` in the
 *   handler): the sealed original, audited.
 */
import {
  caseAttachmentParamsSchema,
  caseLimit,
  caseDocumentSchema,
  idSchema,
  renditionPageQuerySchema,
  renditionPendingDocumentSchema,
} from '@openverify/contracts';
import { CASE_ATTACHMENT_MEDIA_TYPES, CASE_RENDITION_MEDIA_TYPES } from '@openverify/core';
import type { FastifyReply } from 'fastify';
import { validatorCompiler, type FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import {
  getCaseAttachmentContent,
  getCaseAttachmentOriginal,
  uploadCaseAttachment,
  type CaseAttachmentContent,
} from '../../services/cases/attachments/service.js';
import type { ApiDependencies } from '../../services/context.js';
import { workflowActingOf } from './workflows.js';

const TAGS = ['cases'];

/** The bytes, sent unserialized. OpenAPI 3.1 states bytes by the media type alone. */
const binaryContent = z.instanceof(Buffer);

/**
 * C135.1: a 10 MiB file with room for the multipart framing. The body is buffered (not streamed), so
 * the idempotency plugin can honour `Idempotency-Key` as for any buffered body.
 */
export const CASE_ATTACHMENT_BODY_LIMIT_BYTES = caseLimit('attachment-bytes') + 64 * 1024;

/**
 * The upload's validator: zod for the params; the body must be the buffered multipart bytes, which
 * the service reads. Fastify types `schema` as the whole route schema, but compiles each part with
 * that part's zod schema.
 */
function multipartBodyValidator(route: {
  schema: unknown;
  method: string;
  url: string;
  httpPart?: string;
}) {
  if (route.httpPart === 'body') {
    return (value: unknown) =>
      value instanceof Uint8Array
        ? { value }
        : { error: new Error('the body must be multipart/form-data') };
  }
  return validatorCompiler({
    schema: route.schema as z.ZodType,
    method: route.method,
    url: route.url,
  });
}

/** The route's `:id` and `:attachmentId`, as the services name them. */
const idsOf = (params: { id: string; attachmentId: string }) => ({
  caseId: params.id,
  attachmentId: params.attachmentId,
});

/** What a content route answers: the bytes with their headers, or 202 while a rendition is made. */
function send(reply: FastifyReply, content: CaseAttachmentContent) {
  if (content.kind === 'pending') {
    return reply
      .code(202)
      .header('retry-after', String(content.retryAfterSeconds))
      .send(content.document);
  }
  return reply
    .header('content-type', content.mediaType)
    .header('content-disposition', `attachment; filename="${content.filename}"`)
    .header('x-content-type-options', 'nosniff')
    .header('cache-control', 'private, no-store')
    .send(Buffer.from(content.bytes));
}

/** C135 attachment routes, under `/api/v1`. */
export const caseAttachmentRoutes: FastifyPluginAsyncZod<ApiDependencies> = (app, deps) => {
  // Local to this plugin: the upload's body, buffered as it came. No other route reads it.
  app.addContentTypeParser(
    'multipart/form-data',
    { parseAs: 'buffer', bodyLimit: CASE_ATTACHMENT_BODY_LIMIT_BYTES },
    (_request, body, parsed) => {
      parsed(null, body);
    },
  );

  app.post(
    '/cases/:id/attachments',
    {
      bodyLimit: CASE_ATTACHMENT_BODY_LIMIT_BYTES,
      config: { scopes: ['cases:write'] },
      validatorCompiler: multipartBodyValidator,
      schema: {
        summary: 'Attach a file to a case',
        description:
          'C135.1: one multipart file, a JPEG, PNG, WebP or PDF of at most 10 MiB, typed by its ' +
          'bytes, 20 a case; ' +
          'scanned when a scanner is bound, and rendered without metadata for reading. ' +
          '`Idempotency-Key` is honoured.',
        tags: TAGS,
        consumes: ['multipart/form-data'],
        params: z.object({ id: idSchema('case') }),
        body: z.object({ file: z.string().meta({ format: 'binary' }) }),
        response: {
          201: caseDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 410, 413, 415, 422, 429),
        },
      },
    },
    async (request, reply) => {
      const document = await uploadCaseAttachment(
        deps,
        workflowActingOf(request),
        request.params.id,
        {
          body: request.body as unknown as Uint8Array,
          contentType: request.headers['content-type'] ?? '',
        },
      );
      return reply.code(201).send(document);
    },
  );

  app.get(
    '/cases/:id/attachments/:attachmentId/content',
    {
      config: { scopes: ['cases:read'] },
      schema: {
        summary: 'Read an attachment’s rendition',
        description:
          'C135.4: the rendition, never the original: an image re-encoded without metadata, or a ' +
          'PDF’s page `page` as an image. Needs `pii:view`; every view is audited. 202 with ' +
          '`Retry-After` while it is made; 409 `attachment_scan_pending`; 422 ' +
          '`rendition_unavailable`; 404 for a deleted or redacted source.',
        tags: TAGS,
        params: caseAttachmentParamsSchema,
        querystring: renditionPageQuerySchema,
        response: {
          200: {
            description: 'The rendition page, as an attachment named by the server.',
            content: Object.fromEntries(
              CASE_RENDITION_MEDIA_TYPES.map((type) => [type, { schema: binaryContent }]),
            ),
          },
          202: renditionPendingDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 410, 422),
        },
      },
    },
    async (request, reply) =>
      send(
        reply,
        await getCaseAttachmentContent(
          deps,
          workflowActingOf(request),
          idsOf(request.params),
          request.query.page ?? 1,
        ),
      ),
  );

  app.get(
    '/cases/:id/attachments/:attachmentId/original',
    {
      config: { scopes: ['cases:redact'] },
      schema: {
        summary: 'Read an attachment’s original',
        description:
          'C135.4 (P23): the sealed original, for a holder of `cases:redact` with `pii:view`, ' +
          'audited. Readers see the rendition instead.',
        tags: TAGS,
        params: caseAttachmentParamsSchema,
        response: {
          200: {
            description: 'The original, as an attachment named by the server.',
            content: Object.fromEntries(
              Object.values(CASE_ATTACHMENT_MEDIA_TYPES).map((type) => [
                type,
                { schema: binaryContent },
              ]),
            ),
          },
          ...problemResponses(400, 401, 403, 404, 409, 410),
        },
      },
    },
    async (request, reply) =>
      send(
        reply,
        await getCaseAttachmentOriginal(deps, workflowActingOf(request), idsOf(request.params)),
      ),
  );

  return Promise.resolve();
};
