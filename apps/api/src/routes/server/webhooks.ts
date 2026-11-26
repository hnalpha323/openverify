import {
  archiveWebhookBodySchema,
  cloneWebhookBodySchema,
  createdWebhookDocumentSchema,
  createWebhookBodySchema,
  disableWebhookBodySchema,
  enableWebhookBodySchema,
  idSchema,
  listWebhooksQuerySchema,
  replayWebhookBodySchema,
  replayWebhookDocumentSchema,
  rotateWebhookSecretBodySchema,
  rotateWebhookSecretDocumentSchema,
  simulateWebhookBodySchema,
  simulateWebhookDocumentSchema,
  updateWebhookBodySchema,
  webhookDocumentSchema,
  webhookListDocumentSchema,
} from '@openverify/contracts';
import type { FastifyRequest, FastifySchemaCompiler } from 'fastify';
import { validatorCompiler, type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requirePrincipal } from '../../plugins/principal-auth.js';
import { NO_STORE, problemResponses } from '../../plugins/openapi.js';
import { actorOf } from '../../ports.js';
import { serviceContextOf, type ApiDependencies } from '../../services/context.js';
import {
  changeWebhookStatus,
  cloneWebhook,
  createWebhook,
  getWebhook,
  listWebhooks,
  replayWebhook,
  rotateWebhookSecret,
  simulateWebhook,
  updateWebhook,
  WEBHOOKS_PATH,
  type WebhookCall,
  type WebhookStatusAction,
} from '../../services/webhooks.js';

const TAGS = ['webhooks'];
const params = z.object({ id: idSchema('wbh') });

/**
 * Fastify validates a request without a body as `null`, which the optional C9 action bodies
 * (`{ meta? }` or nothing) refuse. This validates it as absent instead; every other value, and
 * every other part of the request, is validated as usual.
 */
const optionalBodyValidator: FastifySchemaCompiler<unknown> = (route) => {
  const validate = validatorCompiler(route as Parameters<typeof validatorCompiler>[0]);
  return (data: unknown) => validate(route.httpPart === 'body' && data === null ? undefined : data);
};

/** The principal's tenant, the request metadata for audit entries, and the audit actor. */
function callOf(request: FastifyRequest): WebhookCall {
  const principal = requirePrincipal(request);
  return {
    ctx: serviceContextOf(principal, {
      requestId: request.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    }),
    actor: actorOf(principal),
  };
}

const STATUS_ROUTES: readonly {
  action: WebhookStatusAction;
  summary: string;
  description: string;
  body: typeof enableWebhookBodySchema;
}[] = [
  {
    action: 'enable',
    summary: 'Enable a webhook',
    description: 'The webhook receives the events it subscribes to again.',
    body: enableWebhookBodySchema,
  },
  {
    action: 'disable',
    summary: 'Disable a webhook',
    description: 'The webhook receives no events until it is enabled again.',
    body: disableWebhookBodySchema,
  },
  {
    action: 'archive',
    summary: 'Archive a webhook',
    description:
      'Archiving is final: an archived webhook never receives events again, and every later ' +
      'change answers 409 `invalid-transition`. It can still be read and cloned.',
    body: archiveWebhookBodySchema,
  },
];

/** C2 and C14 webhook routes, under `/api/v1` (scopes `webhooks:*`). */
export const webhookRoutes: FastifyPluginCallbackZod<ApiDependencies> = (app, deps, done) => {
  app.post(
    '/webhooks',
    {
      config: { scopes: ['webhooks:write'] },
      schema: {
        summary: 'Create a webhook',
        description:
          'The response carries the signing secret (`wbhsec_...`). It is shown only this ' +
          'once; later responses show its last four characters. Custom header values are ' +
          'stored encrypted and shown as `[REDACTED]`.',
        tags: TAGS,
        body: createWebhookBodySchema,
        response: { 201: createdWebhookDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    async (request, reply) => {
      const webhook = await createWebhook(deps, callOf(request), request.body.data.attributes);
      return reply
        .code(201)
        .header('location', `${WEBHOOKS_PATH}/${webhook.id}`)
        .header('cache-control', NO_STORE)
        .send({ data: webhook });
    },
  );

  app.get(
    '/webhooks',
    {
      config: { scopes: ['webhooks:read'] },
      schema: {
        summary: 'List webhooks, newest first',
        tags: TAGS,
        querystring: listWebhooksQuerySchema,
        response: { 200: webhookListDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    (request) => listWebhooks(deps, requirePrincipal(request).environmentId, request.query),
  );

  app.get(
    '/webhooks/:id',
    {
      config: { scopes: ['webhooks:read'] },
      schema: {
        summary: 'Fetch a webhook',
        tags: TAGS,
        params,
        response: { 200: webhookDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    async (request) => ({
      data: await getWebhook(deps, requirePrincipal(request).environmentId, request.params.id),
    }),
  );

  app.patch(
    '/webhooks/:id',
    {
      config: { scopes: ['webhooks:write'] },
      schema: {
        summary: 'Change a webhook',
        description:
          'Changes `url`, `enabled-events`, `status` (`enabled` or `disabled`), `api-version`, ' +
          '`custom-headers`, `filters` or `attribute-blocklist`; the last three replace the ' +
          'stored values. The secret never changes here (see `rotate-secret`). An archived ' +
          'webhook answers 409.',
        tags: TAGS,
        params,
        body: updateWebhookBodySchema,
        response: {
          200: webhookDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409),
        },
      },
    },
    async (request) => {
      return {
        data: await updateWebhook(
          deps,
          callOf(request),
          request.params.id,
          request.body.data.attributes,
        ),
      };
    },
  );

  for (const route of STATUS_ROUTES) {
    app.post(
      `/webhooks/:id/${route.action}`,
      {
        config: { scopes: ['webhooks:write'] },
        validatorCompiler: optionalBodyValidator,
        schema: {
          summary: route.summary,
          description: `${route.description} An archived webhook answers 409.`,
          tags: TAGS,
          params,
          body: route.body,
          response: { 200: webhookDocumentSchema, ...problemResponses(400, 401, 403, 404, 409) },
        },
      },
      async (request) => ({
        data: await changeWebhookStatus(deps, callOf(request), request.params.id, route.action),
      }),
    );
  }

  app.post(
    '/webhooks/:id/clone',
    {
      config: { scopes: ['webhooks:write'] },
      validatorCompiler: optionalBodyValidator,
      schema: {
        summary: 'Clone a webhook',
        description:
          'Creates a disabled webhook with the same URL, events, API version, custom headers, ' +
          'filters and attribute blocklist, and a new signing secret, shown only in this ' +
          'response.',
        tags: TAGS,
        params,
        body: cloneWebhookBodySchema,
        response: {
          201: createdWebhookDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    async (request, reply) => {
      const clone = await cloneWebhook(deps, callOf(request), request.params.id);
      return reply
        .code(201)
        .header('location', `${WEBHOOKS_PATH}/${clone.id}`)
        .header('cache-control', NO_STORE)
        .send({ data: clone });
    },
  );

  app.post(
    '/webhooks/:id/rotate-secret',
    {
      config: { scopes: ['webhooks:write'] },
      validatorCompiler: optionalBodyValidator,
      schema: {
        summary: "Rotate a webhook's signing secret",
        description:
          'The new secret is shown only in this response. Until ' +
          '`meta.previous-secret-expires-at` (`previous-secret-expires-in-seconds` from now, ' +
          'default 86,400, at most 604,800; 0 retires it at once), deliveries carry two ' +
          'signatures, the new one first: `OpenVerify-Signature: t=<t>,v1=<new> v1=<old>`.',
        tags: TAGS,
        params,
        body: rotateWebhookSecretBodySchema,
        response: {
          200: rotateWebhookSecretDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409),
        },
      },
    },
    async (request, reply) => {
      const rotated = await rotateWebhookSecret(
        deps,
        callOf(request),
        request.params.id,
        request.body,
      );
      return reply.header('cache-control', NO_STORE).send(rotated);
    },
  );

  app.post(
    '/webhooks/:id/simulate',
    {
      config: { scopes: ['webhooks:write'] },
      schema: {
        summary: 'Send a sample event to a webhook',
        description:
          'Stores a sample `meta.event-name` event built from synthetic data, marked ' +
          '`simulated: true`, and delivers it to this webhook only. The webhook must be ' +
          'enabled (409 otherwise).',
        tags: TAGS,
        params,
        body: simulateWebhookBodySchema,
        response: {
          200: simulateWebhookDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409),
        },
      },
    },
    async (request) =>
      simulateWebhook(deps, callOf(request), request.params.id, request.body.meta['event-name']),
  );

  app.post(
    '/webhooks/:id/replay',
    {
      config: { scopes: ['webhooks:write'] },
      schema: {
        summary: 'Deliver past events to a webhook again',
        description:
          'Creates a new delivery for each selected event the webhook subscribes to, by name ' +
          'and filters: `meta.event-ids` (at most 100), or `meta.created-at-start` and ' +
          '`meta.created-at-end` (inclusive start, exclusive end), optionally only events ' +
          'whose delivery to this webhook failed (`status: failed`). At most the 1,000 oldest ' +
          'matching events; simulated events are never replayed. The webhook must be enabled ' +
          '(409 otherwise).',
        tags: TAGS,
        params,
        body: replayWebhookBodySchema,
        response: {
          200: replayWebhookDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409),
        },
      },
    },
    async (request) => replayWebhook(deps, callOf(request), request.params.id, request.body.meta),
  );

  done();
};
