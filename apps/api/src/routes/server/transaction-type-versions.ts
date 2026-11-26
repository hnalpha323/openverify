/**
 * C104.1 (Workflow 7B): the transaction type version routes under `/api/v1`: a draft from the latest
 * version, updating a draft, publishing it and reading a version, as C71 does. The schemas and
 * scopes are frozen (Stage 1b (T), `foundation-7b`); `api-transactions` owns this file and builds
 * the handlers (`services/transactions/versions.ts`), which answer 501 until then.
 */
import {
  createTransactionTypeVersionBodySchema,
  idSchema,
  listTransactionTypeVersionsQuerySchema,
  publishTransactionTypeVersionBodySchema,
  transactionTypeVersionDocumentSchema,
  transactionTypeVersionListDocumentSchema,
  updateTransactionTypeVersionBodySchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import type { ApiDependencies } from '../../services/context.js';
import {
  createTransactionTypeVersion,
  getTransactionTypeVersionDocument,
  listTransactionTypeVersions,
  publishTransactionTypeVersion,
  updateTransactionTypeVersion,
} from '../../services/transactions/versions.js';
import { actingOf, optionalBody } from './inquiries.js';

const TAGS = ['transaction-type-versions'];
const params = z.object({ id: idSchema('txntpv') });

/** C104.1 transaction type version routes, under `/api/v1`. */
export const transactionTypeVersionRoutes: FastifyPluginCallbackZod<ApiDependencies> = (
  app,
  deps,
  done,
) => {
  app.post(
    '/transaction-type-versions',
    {
      config: { scopes: ['transaction-types:write'] },
      schema: {
        summary: 'Create a draft version',
        description: 'C104.1: a draft from the latest version; the body’s members replace its own.',
        tags: TAGS,
        body: createTransactionTypeVersionBodySchema,
        response: {
          201: transactionTypeVersionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422),
        },
      },
    },
    async (request, reply) => {
      const document = await createTransactionTypeVersion(
        deps,
        actingOf(request),
        request.body.data.attributes,
      );
      return reply.code(201).send(document);
    },
  );

  app.get(
    '/transaction-type-versions',
    {
      config: { scopes: ['transactions:read'] },
      schema: {
        summary: 'List transaction type versions',
        description:
          'Newest first. `filter[transaction-type-id]` narrows it to one type, the way inquiry ' +
          'template versions are listed.',
        tags: TAGS,
        querystring: listTransactionTypeVersionsQuerySchema,
        response: {
          200: transactionTypeVersionListDocumentSchema,
          ...problemResponses(400, 401, 403),
        },
      },
    },
    (request) => listTransactionTypeVersions(deps, actingOf(request), request.query),
  );

  app.get(
    '/transaction-type-versions/:id',
    {
      config: { scopes: ['transactions:read'] },
      schema: {
        summary: 'Fetch a transaction type version',
        tags: TAGS,
        params,
        response: {
          200: transactionTypeVersionDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    (request) => getTransactionTypeVersionDocument(deps, actingOf(request), request.params.id),
  );

  app.patch(
    '/transaction-type-versions/:id',
    {
      config: { scopes: ['transaction-types:write'] },
      schema: {
        summary: 'Update a draft version',
        tags: TAGS,
        params,
        body: updateTransactionTypeVersionBodySchema,
        response: {
          200: transactionTypeVersionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422),
        },
      },
    },
    (request) =>
      updateTransactionTypeVersion(
        deps,
        actingOf(request),
        request.params.id,
        request.body.data.attributes,
      ),
  );

  app.post(
    '/transaction-type-versions/:id/publish',
    {
      config: { scopes: ['transaction-types:write'] },
      schema: {
        summary: 'Publish a draft version',
        description:
          'C104.1, C104.3: checks the version, supersedes the published one, and emits ' +
          '`transaction-type.deleted-field` and `.converted-field` for what changed.',
        tags: TAGS,
        params,
        body: optionalBody(publishTransactionTypeVersionBodySchema),
        response: {
          200: transactionTypeVersionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422),
        },
      },
    },
    (request) => publishTransactionTypeVersion(deps, actingOf(request), request.params.id),
  );

  done();
};
