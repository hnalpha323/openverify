import {
  accountGraphComponentDocumentSchema,
  accountIncludeDocumentSchema,
  accountIncludeSchema,
  filterValues,
  getAccountQuerySchema,
  accountDocumentSchema,
  accountListDocumentSchema,
  accountRelationListDocumentSchema,
  addAccountObjectsBodySchema,
  addAccountRelationBodySchema,
  addTagBodySchema,
  consolidateAccountsBodySchema,
  createAccountBodySchema,
  idSchema,
  listAccountsQuerySchema,
  redactAccountBodySchema,
  removeAccountObjectsBodySchema,
  removeAccountRelationBodySchema,
  removeTagBodySchema,
  setTagsBodySchema,
  updateAccountBodySchema,
} from '@openverify/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { piiMaskFor, type PiiMask } from '../../auth/pii.js';
import { authorizePrincipal, requirePrincipal } from '../../plugins/principal-auth.js';
import { problemResponses } from '../../plugins/openapi.js';
import { actorOf, type ServiceContext } from '../../ports.js';
import {
  accountResource,
  ACCOUNTS_PATH,
  addAccountObjects,
  addAccountRelation,
  changeAccountTags,
  consolidateAccounts,
  createAccount,
  getAccountView,
  listAccountRelations,
  listAccountViews,
  removeAccountObjects,
  removeAccountRelation,
  updateAccount,
  type AccountView,
} from '../../services/accounts.js';
import { serviceContextOf, type ApiDependencies } from '../../services/context.js';
import { getAccountGraphComponentDocument } from '../../services/graph/components.js';
import { includedListMatchesFor } from '../../services/lists/matches.js';
import { includedReportsFor } from '../../services/reports/includes.js';
import { includedTransactionsFor } from '../../services/transactions/includes.js';

const TAGS = ['accounts'];
const params = z.object({ id: idSchema('acc') });

/** The principal's tenant, audit actor and PII mask, with the request metadata audit records. */
export function callerOf(request: FastifyRequest) {
  const principal = requirePrincipal(request);
  const ctx: ServiceContext = serviceContextOf(principal, {
    requestId: request.id,
    ipAddress: request.ip,
    userAgent: request.headers['user-agent'],
  });
  return { principal, ctx, actor: actorOf(principal), mask: piiMaskFor(principal) };
}

const document = (view: AccountView, mask: PiiMask): z.infer<typeof accountDocumentSchema> => ({
  data: accountResource(view, mask),
});

/**
 * C13 account routes (scopes `accounts:read`, `accounts:write`, `accounts:redact`), under
 * `/api/v1`. Every query is scoped to the principal's environment; another environment's
 * account or inquiry answers 404. Field values are masked for a user without `pii:view` (C15).
 */
export const accountRoutes: FastifyPluginCallbackZod<ApiDependencies> = (app, deps, done) => {
  app.post(
    '/accounts',
    {
      config: { scopes: ['accounts:write'] },
      schema: {
        summary: 'Create an account',
        description:
          'Without `account-type-id` the type `user` applies. `fields` are checked against the ' +
          "type's `fields-schema`: unknown keys and values of the wrong type answer 422. Emits " +
          '`account.created`.',
        tags: TAGS,
        body: createAccountBodySchema,
        response: { 201: accountDocumentSchema, ...problemResponses(400, 401, 403, 404, 409, 422) },
      },
    },
    async (request, reply) => {
      const { ctx, actor, mask } = callerOf(request);
      const view = await createAccount(deps, ctx, actor, request.body.data.attributes);
      return reply
        .code(201)
        .header('location', `${ACCOUNTS_PATH}/${view.account.id}`)
        .send(document(view, mask));
    },
  );

  app.get(
    '/accounts',
    {
      config: { scopes: ['accounts:read'] },
      schema: {
        summary: 'List accounts, newest first',
        description:
          'Filters `reference-id`, `account-type-id`, `status` and `tag` (comma-separated values ' +
          'mean OR) and the `created-at` range.',
        tags: TAGS,
        querystring: listAccountsQuerySchema,
        response: { 200: accountListDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    async (request) => {
      const { ctx, mask } = callerOf(request);
      const page = await listAccountViews(deps, ctx.environmentId, request.query);
      return {
        data: page.views.map((view) => accountResource(view, mask)),
        links: { next: page.next },
      };
    },
  );

  app.get(
    '/accounts/:id',
    {
      config: { scopes: ['accounts:read'] },
      schema: {
        summary: 'Fetch an account',
        description:
          'The relationship `inquiries` lists its latest 100 inquiries, newest first. ' +
          '`?include=reports` adds the reports linked to it, as its home or otherwise, newest ' +
          'first, at most 50 (C70.5; needs `reports:read` too).',
        tags: TAGS,
        params,
        querystring: getAccountQuerySchema,
        response: { 200: accountIncludeDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    async (request) => {
      const { ctx, mask } = callerOf(request);
      const include = filterValues(request.query.include, accountIncludeSchema) ?? [];
      if (include.includes('reports')) {
        authorizePrincipal(requirePrincipal(request), ['reports:read']);
      }
      // C107.6 (Workflow 7B): the `GET /list-matches` view; `api-lists` serves them.
      if (include.includes('list-matches')) {
        authorizePrincipal(requirePrincipal(request), ['lists:read']);
      }
      // C107.6 (Workflow 7B): the `GET /transactions` view; `api-transactions` serves them.
      if (include.includes('transactions')) {
        authorizePrincipal(requirePrincipal(request), ['transactions:read']);
      }
      const view = await getAccountView(deps, ctx.environmentId, request.params.id);
      if (include.length === 0) {
        return document(view, mask);
      }
      // Only what was asked for: each include was authorized above, on its own permission.
      const target = { accountId: view.account.id };
      return {
        ...document(view, mask),
        included: [
          ...(include.includes('reports')
            ? await includedReportsFor(deps.db, ctx.environmentId, target, mask)
            : []),
          ...(include.includes('list-matches')
            ? await includedListMatchesFor(deps.db, ctx.environmentId, target, mask)
            : []),
          ...(include.includes('transactions')
            ? await includedTransactionsFor(deps.db, ctx.environmentId, target, mask)
            : []),
        ],
      };
    },
  );

  app.patch(
    '/accounts/:id',
    {
      config: { scopes: ['accounts:write'] },
      schema: {
        summary: 'Update an account',
        description:
          '`fields` are merged; `status` moves between `active` and `archived`. Emits ' +
          '`account.updated-fields`, and `account.status-updated` plus `account.archived` or ' +
          '`account.restored`. A consolidated account cannot be restored (409), and a redacted ' +
          "account's fields cannot be set (410).",
        tags: TAGS,
        params,
        body: updateAccountBodySchema,
        response: {
          200: accountDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 410, 422),
        },
      },
    },
    async (request) => {
      const { ctx, actor, mask } = callerOf(request);
      const view = await updateAccount(
        deps,
        ctx,
        actor,
        request.params.id,
        request.body.data.attributes,
      );
      return document(view, mask);
    },
  );

  app.get(
    '/accounts/:id/graph-component',
    {
      config: { scopes: ['graph:read'] },
      schema: {
        summary: "Read an account's graph component",
        description:
          'The size of the component of accounts this one shares a strong value with, from the ' +
          'nightly `graph-components` job, and when it was computed: `disabled` while the ' +
          'environment setting is off, `not-computed` for an account newer than the last run. ' +
          'A lead for a reviewer (beta), never a decision. Not PII.',
        tags: TAGS,
        params,
        response: {
          200: accountGraphComponentDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    (request) => {
      const { ctx } = callerOf(request);
      return getAccountGraphComponentDocument(deps, ctx.environmentId, request.params.id);
    },
  );

  app.post(
    '/accounts/:id/add-tag',
    {
      config: { scopes: ['accounts:write'] },
      schema: {
        summary: 'Add a tag (`account.tag-added`)',
        description:
          'A tag already present, ignoring case, changes nothing. An account holds at most 50.',
        tags: TAGS,
        params,
        body: addTagBodySchema,
        response: { 200: accountDocumentSchema, ...problemResponses(400, 401, 403, 404, 422) },
      },
    },
    async (request) => {
      const { ctx, actor, mask } = callerOf(request);
      const view = await changeAccountTags(deps, ctx, actor, request.params.id, {
        kind: 'add',
        tag: request.body.meta['tag-name'],
      });
      return document(view, mask);
    },
  );

  app.post(
    '/accounts/:id/remove-tag',
    {
      config: { scopes: ['accounts:write'] },
      schema: {
        summary: 'Remove a tag, ignoring case (`account.tag-removed`)',
        tags: TAGS,
        params,
        body: removeTagBodySchema,
        response: { 200: accountDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    async (request) => {
      const { ctx, actor, mask } = callerOf(request);
      const view = await changeAccountTags(deps, ctx, actor, request.params.id, {
        kind: 'remove',
        tag: request.body.meta['tag-name'],
      });
      return document(view, mask);
    },
  );

  app.post(
    '/accounts/:id/set-tags',
    {
      config: { scopes: ['accounts:write'] },
      schema: {
        summary: 'Replace the tags (`account.updated-tags`)',
        description: 'Duplicates ignoring case count once; at most 50 tags.',
        tags: TAGS,
        params,
        body: setTagsBodySchema,
        response: { 200: accountDocumentSchema, ...problemResponses(400, 401, 403, 404, 422) },
      },
    },
    async (request) => {
      const { ctx, actor, mask } = callerOf(request);
      const view = await changeAccountTags(deps, ctx, actor, request.params.id, {
        kind: 'set',
        tags: request.body.meta['tag-names'],
      });
      return document(view, mask);
    },
  );

  app.post(
    '/accounts/:id/add-relation',
    {
      config: { scopes: ['accounts:write'] },
      schema: {
        summary: 'Relate this account to another (`account.added-relation`)',
        description:
          'Relations are directed and unique per (from, to, type). An account cannot relate to ' +
          'itself, and consolidated accounts take no new relations (409).',
        tags: TAGS,
        params,
        body: addAccountRelationBodySchema,
        response: {
          200: accountDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422),
        },
      },
    },
    async (request) => {
      const { ctx, actor, mask } = callerOf(request);
      const view = await addAccountRelation(deps, ctx, actor, request.params.id, request.body.meta);
      return document(view, mask);
    },
  );

  app.post(
    '/accounts/:id/remove-relation',
    {
      config: { scopes: ['accounts:write'] },
      schema: {
        summary: 'Remove a relation (`account.removed-relation`)',
        tags: TAGS,
        params,
        body: removeAccountRelationBodySchema,
        response: { 200: accountDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    async (request) => {
      const { ctx, actor, mask } = callerOf(request);
      const view = await removeAccountRelation(
        deps,
        ctx,
        actor,
        request.params.id,
        request.body.meta,
      );
      return document(view, mask);
    },
  );

  app.get(
    '/accounts/:id/relations',
    {
      config: { scopes: ['accounts:read'] },
      schema: {
        summary: "List the account's relations",
        description: 'Both directions, oldest first, each with `direction: outgoing | incoming`.',
        tags: TAGS,
        params,
        response: {
          200: accountRelationListDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    async (request) => {
      const { ctx } = callerOf(request);
      return { data: await listAccountRelations(deps, ctx.environmentId, request.params.id) };
    },
  );

  app.post(
    '/accounts/:id/consolidate',
    {
      config: { scopes: ['accounts:write'] },
      schema: {
        summary: 'Consolidate duplicate accounts into this one',
        description:
          "In one transaction: the sources' inquiries and relations move here (deduplicated, " +
          'self-relations dropped), tags are the union, fields merge with this account winning, ' +
          'and each source is archived with `consolidated-into`. Emits `account.consolidated` and ' +
          '`account.consolidated-with` for each source.',
        tags: TAGS,
        params,
        body: consolidateAccountsBodySchema,
        response: {
          200: accountDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 410, 422),
        },
      },
    },
    async (request) => {
      const { ctx, actor, mask } = callerOf(request);
      const view = await consolidateAccounts(
        deps,
        ctx,
        actor,
        request.params.id,
        request.body.meta['source-account-ids'],
      );
      return document(view, mask);
    },
  );

  app.post(
    '/accounts/:id/add-objects',
    {
      config: { scopes: ['accounts:write'] },
      schema: {
        summary: 'Link inquiries to this account',
        description: 'Each inquiry moves here from its current account.',
        tags: TAGS,
        params,
        body: addAccountObjectsBodySchema,
        response: {
          200: accountDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409),
        },
      },
    },
    async (request) => {
      const { ctx, actor, mask } = callerOf(request);
      const ids = request.body.meta.objects.map((object) => object.id);
      return document(await addAccountObjects(deps, ctx, actor, request.params.id, ids), mask);
    },
  );

  app.post(
    '/accounts/:id/remove-objects',
    {
      config: { scopes: ['accounts:write'] },
      schema: {
        summary: 'Unlink inquiries from this account',
        description:
          'Every inquiry has an account, so each one moves to a new account of its own (type ' +
          '`user`), which emits `account.created`. Only inquiries of this account can be ' +
          'removed (422).',
        tags: TAGS,
        params,
        body: removeAccountObjectsBodySchema,
        response: {
          200: accountDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 422),
        },
      },
    },
    async (request) => {
      const { ctx, actor, mask } = callerOf(request);
      const ids = request.body.meta.objects.map((object) => object.id);
      return document(await removeAccountObjects(deps, ctx, actor, request.params.id, ids), mask);
    },
  );

  app.post(
    '/accounts/:id/redact',
    {
      config: { scopes: ['accounts:redact'] },
      schema: {
        summary: 'Redact the account and its inquiries (C16)',
        description:
          'Irreversible and idempotent: fields, notes, client addresses and check details are ' +
          'removed, files are deleted from storage and stored event payloads are stubbed. ' +
          'Emits `account.redacted` and `inquiry.redacted` for each inquiry.',
        tags: TAGS,
        params,
        // Fastify validates a request without a body as `null`; the action's body is optional.
        body: redactAccountBodySchema.nullable(),
        response: { 200: accountDocumentSchema, ...problemResponses(400, 401, 403, 404, 503) },
      },
    },
    async (request) => {
      const { ctx, actor, mask } = callerOf(request);
      await deps.redaction.redactAccount(ctx, request.params.id, actor);
      return document(await getAccountView(deps, ctx.environmentId, request.params.id), mask);
    },
  );

  done();
};
