/**
 * C105.2 (Workflow 7B): the transaction routes under `/api/v1`. The schemas and scopes are frozen
 * (Stage 1b (T), `foundation-7b`); `api-transactions` owns this file and builds the handlers
 * (`services/transactions/`), which answer 501 until then.
 *
 * No JSON route carries a file (P22). `PUT /transactions/:id/files/:fieldKey` takes one `file`
 * field's content as multipart: the parser here leaves the stream unread, so the service can load
 * the pinned version first and cap the body at the field's `max-file-size-bytes`. Nothing of that
 * body reaches a stored API log, and the idempotency plugin, which covers POST and PATCH, passes a
 * PUT by. Fastify's router reads a hyphen as a separator, so the params are `fileId` and `fieldKey`,
 * the plan's `:file-id` and `:field-key`.
 */
import multipart from '@fastify/multipart';
import {
  addTagBodySchema,
  createTransactionBodySchema,
  FILE_CONTENT_CACHE_CONTROL,
  getTransactionQuerySchema,
  idSchema,
  labelTransactionBodySchema,
  listTransactionLabelsQuerySchema,
  listTransactionRelationsQuerySchema,
  listTransactionsQuerySchema,
  listTransactionStatusChangesQuerySchema,
  redactTransactionBiometricsBodySchema,
  redactTransactionBodySchema,
  removeTagBodySchema,
  setTagsBodySchema,
  transactionDocumentSchema,
  transactionFieldKeySchema,
  transactionIncludeDocumentSchema,
  transactionLabelListDocumentSchema,
  transactionListDocumentSchema,
  transactionObjectsBodySchema,
  transactionRelationBodySchema,
  transactionRelationListDocumentSchema,
  transactionStatusChangeListDocumentSchema,
  updateTransactionBodySchema,
} from '@openverify/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requirePiiView } from '../../auth/pii.js';
import { problemResponses } from '../../plugins/openapi.js';
import { authorizePrincipal, requirePrincipal } from '../../plugins/principal-auth.js';
import type { ApiDependencies } from '../../services/context.js';
import type { TransactionActing } from '../../services/transactions/acting.js';
import { putTransactionFile, readTransactionFile } from '../../services/transactions/files.js';
import {
  listTransactionLabelsDocument,
  listTransactionStatusChanges,
} from '../../services/transactions/history.js';
import { listTransactionRelationsDocument } from '../../services/transactions/relations.js';
import {
  addTransactionObjects,
  addTransactionRelation,
  changeTransactionTags,
  createTransaction,
  getTransactionDocument,
  labelTransaction,
  listTransactions,
  redactTransaction,
  redactTransactionBiometrics,
  removeTransactionObjects,
  removeTransactionRelation,
  updateTransaction,
} from '../../services/transactions/transactions.js';
import { actingOf, optionalBody } from './inquiries.js';

const TAGS = ['transactions'];
const params = z.object({ id: idSchema('txn') });
const fileParams = z.object({ id: idSchema('txn'), fileId: idSchema('txnf') });
const fieldParams = z.object({ id: idSchema('txn'), fieldKey: transactionFieldKeySchema });

/** The object's bytes, sent unserialized. OpenAPI 3.1 states bytes by the media type alone. */
const binaryContent = z.instanceof(Buffer);

/**
 * The upload route's validator: zod for the params; the multipart body is read by the service, as
 * the flow's upload does. Fastify types `schema` as the whole route schema, but compiles each part
 * with that part's zod schema, which is what is passed on.
 */
function paramsOnlyValidator(route: {
  schema: unknown;
  method: string;
  url: string;
  httpPart?: string;
}) {
  if (route.httpPart === 'body') {
    return () => ({ value: undefined });
  }
  return validatorCompiler({
    schema: route.schema as z.ZodType,
    method: route.method,
    url: route.url,
  });
}

/** The caller's acting, with what it may read beyond the route's scope (C104.2, P12). */
function transactionActingOf(request: FastifyRequest): TransactionActing {
  const principal = requirePrincipal(request);
  return {
    ...actingOf(request),
    allows: (permission) => {
      try {
        authorizePrincipal(principal, [permission]);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** C105.2 transaction routes, under `/api/v1`. */
export const transactionRoutes: FastifyPluginAsyncZod<ApiDependencies> = async (app, deps) => {
  // Local to this plugin: `request.parts()` for the one streaming route. No other route reads it.
  await app.register(multipart);

  app.post(
    '/transactions',
    {
      config: { scopes: ['transactions:write'] },
      schema: {
        summary: 'Create a transaction',
        description:
          'C105.2: validated against the type’s published version, which the transaction pins. ' +
          'A `file` field’s content goes through its own `PUT`.',
        tags: TAGS,
        body: createTransactionBodySchema,
        response: {
          201: transactionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422),
        },
      },
    },
    async (request, reply) => {
      const document = await createTransaction(
        deps,
        transactionActingOf(request),
        request.body.data.attributes,
      );
      return reply.code(201).send(document);
    },
  );

  app.get(
    '/transactions',
    {
      config: { scopes: ['transactions:read'] },
      schema: {
        summary: 'List the transactions',
        description:
          'C105.2: newest first. `filter[identifier][key]` with `[value]` searches `searchable` ' +
          'fields and needs `pii:view`, because an answer says whether a value exists; a stored ' +
          'API log masks the value. C165.3: `filter[fields.<key>]` on a `filterable` field (at most ' +
          'ten) matches the canonical value of the field; a string field reads its keyed equality ' +
          'index and needs `pii:view`. A field no version marks filterable answers 400.',
        tags: TAGS,
        querystring: listTransactionsQuerySchema,
        response: { 200: transactionListDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    (request) => {
      // K7B-14: a search by value tells whether a value exists, so it is a read of that value.
      if (request.query['filter[identifier][value]'] !== undefined) {
        requirePiiView(requirePrincipal(request));
      }
      return listTransactions(deps, transactionActingOf(request), request.query);
    },
  );

  app.get(
    '/transactions/:id',
    {
      config: { scopes: ['transactions:read'] },
      schema: {
        summary: 'Fetch a transaction',
        tags: TAGS,
        params,
        querystring: getTransactionQuerySchema,
        response: {
          200: transactionIncludeDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    (request) =>
      getTransactionDocument(deps, transactionActingOf(request), request.params.id, request.query),
  );

  app.patch(
    '/transactions/:id',
    {
      config: { scopes: ['transactions:write'] },
      schema: {
        summary: 'Update a transaction',
        description:
          'C105.2: a second write of a `write_once` field answers 409 `field_write_once`.',
        tags: TAGS,
        params,
        body: updateTransactionBodySchema,
        response: {
          200: transactionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 410, 422),
        },
      },
    },
    (request) =>
      updateTransaction(
        deps,
        transactionActingOf(request),
        request.params.id,
        request.body.data.attributes,
      ),
  );

  app.get(
    '/transactions/:id/status-changes',
    {
      config: { scopes: ['transactions:read'] },
      schema: {
        summary: "List a transaction's status changes",
        description:
          'Newest first. A status is free text, so `from-status` and `to-status` are `null` once ' +
          'the transaction is redacted; who moved it and when stay.',
        tags: TAGS,
        params,
        querystring: listTransactionStatusChangesQuerySchema,
        response: {
          200: transactionStatusChangeListDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    (request) =>
      listTransactionStatusChanges(
        deps,
        transactionActingOf(request),
        request.params.id,
        request.query,
      ),
  );

  app.get(
    '/transactions/:id/labels',
    {
      config: { scopes: ['transactions:read'] },
      schema: {
        summary: "List a transaction's labels",
        description: 'Newest first. A redacted label is left out.',
        tags: TAGS,
        params,
        querystring: listTransactionLabelsQuerySchema,
        response: {
          200: transactionLabelListDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    (request) =>
      listTransactionLabelsDocument(
        deps,
        transactionActingOf(request),
        request.params.id,
        request.query,
      ),
  );

  app.get(
    '/transactions/:id/relations',
    {
      config: { scopes: ['transactions:read'] },
      schema: {
        summary: "List a transaction's relations",
        description:
          'Newest first, with each target by its id, never its attributes. `page[after]` comes ' +
          'from `links.next`: it is a position, so removing a relation does not lose your place. ' +
          'A redaction leaves relations as they are.',
        tags: TAGS,
        params,
        querystring: listTransactionRelationsQuerySchema,
        response: {
          200: transactionRelationListDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    (request) =>
      listTransactionRelationsDocument(
        deps,
        transactionActingOf(request),
        request.params.id,
        request.query,
      ),
  );

  app.delete(
    '/transactions/:id',
    {
      config: { scopes: ['transactions:redact'] },
      schema: {
        summary: 'Redact a transaction',
        description:
          'C105.5: redacts its own data now, except fields marked `never`. `meta.include-never` ' +
          'takes those too: an audited legal-erasure override (P21). Attached objects stay.',
        tags: TAGS,
        params,
        body: optionalBody(redactTransactionBodySchema),
        response: { 200: transactionDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    (request) =>
      redactTransaction(
        deps,
        transactionActingOf(request),
        request.params.id,
        request.body?.meta ?? {},
      ),
  );

  app.get(
    '/transactions/:id/files/:fileId/content',
    {
      config: { scopes: ['transactions:read'] },
      schema: {
        summary: 'Download a transaction file',
        description:
          'C105.2 (P12): a `file` field’s content, never a `platform-file`. Needs `pii:view` for ' +
          'users, is audited, and is never cached. A redacted file answers 410.',
        tags: TAGS,
        params: fileParams,
        response: {
          200: {
            description: 'The decrypted file.',
            content: { 'application/octet-stream': { schema: binaryContent } },
          },
          ...problemResponses(400, 401, 403, 404, 410),
        },
      },
    },
    async (request, reply) => {
      // Set first, so error responses about this file are not cached either.
      void reply.header('cache-control', FILE_CONTENT_CACHE_CONTROL);
      requirePiiView(requirePrincipal(request));
      const content = await readTransactionFile(
        deps,
        transactionActingOf(request),
        request.params.id,
        request.params.fileId,
      );
      return reply
        .code(200)
        .header('content-type', content.mimeType)
        .header('x-content-type-options', 'nosniff')
        .send(Buffer.from(content.bytes));
    },
  );

  app.put(
    '/transactions/:id/files/:fieldKey',
    {
      config: { scopes: ['transactions:write'] },
      validatorCompiler: paramsOnlyValidator,
      schema: {
        summary: 'Upload a file field’s content',
        description:
          'C105.2 (P22): one `file` field’s content, as multipart. The route loads the pinned ' +
          'version before it reads the body, and streams it capped at the field’s ' +
          '`max-file-size-bytes`. It is refused for a `write_once` field already set.',
        tags: TAGS,
        consumes: ['multipart/form-data'],
        params: fieldParams,
        body: z.object({ file: z.string().meta({ format: 'binary' }) }),
        response: {
          200: transactionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 410, 413, 415, 422),
        },
      },
    },
    (request) =>
      putTransactionFile(
        deps,
        transactionActingOf(request),
        request.params.id,
        request.params.fieldKey,
        {
          parts: (limits) => request.parts({ limits: { ...limits, files: 1 } }),
        },
      ),
  );

  app.post(
    '/transactions/:id/redact-biometrics',
    {
      config: { scopes: ['transactions:redact', 'inquiries:redact'] },
      schema: {
        summary: 'Redact a transaction’s biometric data',
        description:
          'C105.6: deletes the biometric data of the transaction and every associated object, in ' +
          'one transaction. A second call changes nothing.',
        'x-private': true,
        tags: TAGS,
        params,
        body: optionalBody(redactTransactionBiometricsBodySchema),
        response: { 200: transactionDocumentSchema, ...problemResponses(400, 401, 403, 404, 410) },
      },
    },
    (request) => redactTransactionBiometrics(deps, transactionActingOf(request), request.params.id),
  );

  app.post(
    '/transactions/:id/add-objects',
    {
      config: { scopes: ['transactions:write'] },
      schema: {
        summary: 'Attach objects to a transaction',
        description: 'C105.2: at most 100 inquiries, reports and verifications.',
        tags: TAGS,
        params,
        body: transactionObjectsBodySchema,
        response: {
          200: transactionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 410, 422),
        },
      },
    },
    (request) =>
      addTransactionObjects(
        deps,
        transactionActingOf(request),
        request.params.id,
        request.body.meta,
      ),
  );

  app.post(
    '/transactions/:id/remove-objects',
    {
      config: { scopes: ['transactions:write'] },
      schema: {
        summary: 'Detach objects from a transaction',
        tags: TAGS,
        params,
        body: transactionObjectsBodySchema,
        response: {
          200: transactionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 410, 422),
        },
      },
    },
    (request) =>
      removeTransactionObjects(
        deps,
        transactionActingOf(request),
        request.params.id,
        request.body.meta,
      ),
  );

  app.post(
    '/transactions/:id/add-relation',
    {
      config: { scopes: ['transactions:write'] },
      schema: {
        summary: 'Add a relation (`transaction.added-relation`)',
        description: 'C105.2: to an account or a transaction, under a relation schema. Idempotent.',
        tags: TAGS,
        params,
        body: transactionRelationBodySchema,
        response: {
          200: transactionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 410, 422),
        },
      },
    },
    (request) =>
      addTransactionRelation(
        deps,
        transactionActingOf(request),
        request.params.id,
        request.body.meta,
      ),
  );

  app.post(
    '/transactions/:id/remove-relation',
    {
      config: { scopes: ['transactions:write'] },
      schema: {
        summary: 'Remove a relation (`transaction.removed-relation`)',
        description: 'C105.2: idempotent.',
        tags: TAGS,
        params,
        body: transactionRelationBodySchema,
        response: {
          200: transactionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 410, 422),
        },
      },
    },
    (request) =>
      removeTransactionRelation(
        deps,
        transactionActingOf(request),
        request.params.id,
        request.body.meta,
      ),
  );

  app.post(
    '/transactions/:id/add-tag',
    {
      config: { scopes: ['transactions:write'] },
      schema: {
        summary: 'Add a tag',
        description: 'A tag already present, ignoring case, changes nothing.',
        tags: TAGS,
        params,
        body: addTagBodySchema,
        response: {
          200: transactionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 410, 422),
        },
      },
    },
    (request) =>
      changeTransactionTags(deps, transactionActingOf(request), request.params.id, {
        kind: 'add',
        tag: request.body.meta['tag-name'],
      }),
  );

  app.post(
    '/transactions/:id/remove-tag',
    {
      config: { scopes: ['transactions:write'] },
      schema: {
        summary: 'Remove a tag, ignoring case',
        tags: TAGS,
        params,
        body: removeTagBodySchema,
        response: {
          200: transactionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 410, 422),
        },
      },
    },
    (request) =>
      changeTransactionTags(deps, transactionActingOf(request), request.params.id, {
        kind: 'remove',
        tag: request.body.meta['tag-name'],
      }),
  );

  app.post(
    '/transactions/:id/set-tags',
    {
      config: { scopes: ['transactions:write'] },
      schema: {
        summary: 'Replace the tags',
        description: 'Duplicates ignoring case count once; at most 50 tags.',
        tags: TAGS,
        params,
        body: setTagsBodySchema,
        response: {
          200: transactionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 410, 422),
        },
      },
    },
    (request) =>
      changeTransactionTags(deps, transactionActingOf(request), request.params.id, {
        kind: 'set',
        tags: request.body.meta['tag-names'],
      }),
  );

  app.post(
    '/transactions/:id/label',
    {
      config: { scopes: ['transactions:write'] },
      schema: {
        summary: 'Label a transaction (`transaction.labeled`)',
        description: 'C105.2: labels are append-only history; the answer is the transaction.',
        tags: TAGS,
        params,
        body: labelTransactionBodySchema,
        response: {
          200: transactionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 410, 422),
        },
      },
    },
    (request) =>
      labelTransaction(deps, transactionActingOf(request), request.params.id, request.body.meta),
  );
};
