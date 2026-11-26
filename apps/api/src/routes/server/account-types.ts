import {
  accountTypeDocumentSchema,
  accountTypeListDocumentSchema,
  createAccountTypeBodySchema,
  idSchema,
  listAccountTypesQuerySchema,
  updateAccountTypeBodySchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import {
  ACCOUNT_TYPES_PATH,
  accountTypeResource,
  createAccountType,
  getAccountTypeRecord,
  listAccountTypeRecords,
  updateAccountType,
} from '../../services/accounts.js';
import type { ApiDependencies } from '../../services/context.js';
import { callerOf } from './accounts.js';

const TAGS = ['accounts'];
const params = z.object({ id: idSchema('acctp') });

/**
 * C13 account type routes (scopes `accounts:read`, `accounts:write`), under `/api/v1`, with the
 * C25.3 additive `PATCH`. Every environment has the type `user`, whose default fields are seeded
 * on first use.
 */
export const accountTypeRoutes: FastifyPluginCallbackZod<ApiDependencies> = (app, deps, done) => {
  app.post(
    '/account-types',
    {
      config: { scopes: ['accounts:write'] },
      schema: {
        summary: 'Create an account type',
        description:
          '`name` is unique per environment. `fields-schema` maps snake_case field keys to ' +
          '`{ type: string | number | boolean | date, label }`, with at most 100 keys.',
        tags: TAGS,
        body: createAccountTypeBodySchema,
        response: { 201: accountTypeDocumentSchema, ...problemResponses(400, 401, 403, 409) },
      },
    },
    async (request, reply) => {
      const { ctx, actor } = callerOf(request);
      const type = await createAccountType(deps, ctx, actor, request.body.data.attributes);
      return reply
        .code(201)
        .header('location', `${ACCOUNT_TYPES_PATH}/${type.id}`)
        .send({ data: accountTypeResource(type) });
    },
  );

  app.get(
    '/account-types',
    {
      config: { scopes: ['accounts:read'] },
      schema: {
        summary: 'List account types, newest first',
        tags: TAGS,
        querystring: listAccountTypesQuerySchema,
        response: { 200: accountTypeListDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    async (request) => {
      const { ctx } = callerOf(request);
      const page = await listAccountTypeRecords(deps, ctx.environmentId, request.query);
      return { data: page.types.map(accountTypeResource), links: { next: page.next } };
    },
  );

  app.get(
    '/account-types/:id',
    {
      config: { scopes: ['accounts:read'] },
      schema: {
        summary: 'Fetch an account type',
        tags: TAGS,
        params,
        response: { 200: accountTypeDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    async (request) => {
      const { ctx } = callerOf(request);
      return {
        data: accountTypeResource(
          await getAccountTypeRecord(deps, ctx.environmentId, request.params.id),
        ),
      };
    },
  );

  app.patch(
    '/account-types/:id',
    {
      config: { scopes: ['accounts:write'] },
      schema: {
        summary: 'Change an account type',
        description:
          'C25.3: `name` (unique per environment, 409 as on create) and `fields-schema`, the ' +
          'whole new schema. Changes are additive: keys may be added and labels changed. A ' +
          'change that removes a key or changes its `type` answers 422 with a JSON Pointer to ' +
          'the key, because accounts may hold values for it. The 100-key limit and the key ' +
          'format apply. The seeded type `user` follows the same rule and keeps its name (422).',
        tags: TAGS,
        params,
        body: updateAccountTypeBodySchema,
        response: {
          200: accountTypeDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422),
        },
      },
    },
    async (request) => {
      const { ctx, actor } = callerOf(request);
      const type = await updateAccountType(
        deps,
        ctx,
        actor,
        request.params.id,
        request.body.data.attributes,
      );
      return { data: accountTypeResource(type) };
    },
  );

  done();
};
