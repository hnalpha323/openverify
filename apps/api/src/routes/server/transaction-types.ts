/**
 * C104.1 (Workflow 7B): the transaction type routes under `/api/v1`: create, list, get, update the
 * name, and archive by `DELETE`. The schemas and scopes are frozen (Stage 1b (T), `foundation-7b`);
 * `api-transactions` owns this file and builds the handlers (`services/transactions/types.ts`), which
 * answer 501 until then.
 */
import {
  createTransactionTypeBodySchema,
  idSchema,
  listTransactionTypesQuerySchema,
  transactionTypeDocumentSchema,
  transactionTypeListDocumentSchema,
  updateTransactionTypeBodySchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import type { ApiDependencies } from '../../services/context.js';
import {
  archiveTransactionType,
  createTransactionType,
  getTransactionTypeDocument,
  listTransactionTypes,
  updateTransactionType,
} from '../../services/transactions/types.js';
import { actingOf } from './inquiries.js';

const TAGS = ['transaction-types'];
const params = z.object({ id: idSchema('txntp') });

/** C104.1 transaction type routes, under `/api/v1`. */
export const transactionTypeRoutes: FastifyPluginCallbackZod<ApiDependencies> = (
  app,
  deps,
  done,
) => {
  app.post(
    '/transaction-types',
    {
      config: { scopes: ['transaction-types:write'] },
      schema: {
        summary: 'Create a transaction type',
        description: 'C104.1: a draft version comes with it. A new type starts with four statuses.',
        tags: TAGS,
        body: createTransactionTypeBodySchema,
        response: {
          201: transactionTypeDocumentSchema,
          ...problemResponses(400, 401, 403, 422),
        },
      },
    },
    async (request, reply) => {
      const document = await createTransactionType(
        deps,
        actingOf(request),
        request.body.data.attributes,
      );
      return reply.code(201).send(document);
    },
  );

  app.get(
    '/transaction-types',
    {
      config: { scopes: ['transactions:read'] },
      schema: {
        summary: 'List the transaction types',
        tags: TAGS,
        querystring: listTransactionTypesQuerySchema,
        response: { 200: transactionTypeListDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    (request) => listTransactionTypes(deps, actingOf(request), request.query),
  );

  app.get(
    '/transaction-types/:id',
    {
      config: { scopes: ['transactions:read'] },
      schema: {
        summary: 'Fetch a transaction type',
        tags: TAGS,
        params,
        response: { 200: transactionTypeDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    (request) => getTransactionTypeDocument(deps, actingOf(request), request.params.id),
  );

  app.patch(
    '/transaction-types/:id',
    {
      config: { scopes: ['transaction-types:write'] },
      schema: {
        summary: 'Rename a transaction type',
        description: 'C104.1: the name only; everything else is a version’s.',
        tags: TAGS,
        params,
        body: updateTransactionTypeBodySchema,
        response: { 200: transactionTypeDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    (request) =>
      updateTransactionType(
        deps,
        actingOf(request),
        request.params.id,
        request.body.data.attributes,
      ),
  );

  app.delete(
    '/transaction-types/:id',
    {
      config: { scopes: ['transaction-types:write'] },
      schema: {
        summary: 'Archive a transaction type',
        description: 'C104.1: an archived type takes no new transaction. Its transactions stay.',
        tags: TAGS,
        params,
        response: { 200: transactionTypeDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    (request) => archiveTransactionType(deps, actingOf(request), request.params.id),
  );

  done();
};
