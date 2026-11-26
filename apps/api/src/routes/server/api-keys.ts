import {
  apiKeyDocumentSchema,
  apiKeyListDocumentSchema,
  cloneApiKeyBodySchema,
  createApiKeyBodySchema,
  createdApiKeyDocumentSchema,
  expireApiKeyBodySchema,
  idSchema,
  listApiKeysQuerySchema,
  rotateApiKeyBodySchema,
  rotatedApiKeyDocumentSchema,
  updateApiKeyBodySchema,
} from '@openverify/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requirePrincipal } from '../../plugins/principal-auth.js';
import { NO_STORE, problemResponses } from '../../plugins/openapi.js';
import {
  API_KEYS_PATH,
  cloneApiKey,
  createApiKey,
  expireApiKey,
  getApiKey,
  listApiKeys,
  updateApiKey,
  type ApiKeyTokenIssuer,
} from '../../services/api-keys.js';
import { rotateApiKey } from '../../services/api-keys/rotate.js';
import { serviceContextOf, type ApiDependencies } from '../../services/context.js';

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Issues API key tokens hashed with the server pepper (`buildApp` option `apiKeyPepper`);
     * `null` when the app was built without it, and then no key can be created.
     */
    apiKeyTokens: ApiKeyTokenIssuer | null;
  }
}

const TAGS = ['api-keys'];
const params = z.object({ id: idSchema('key') });

/** The token issuer, which only the composed API has. */
function issuerOf(app: FastifyInstance): ApiKeyTokenIssuer {
  const issuer: ApiKeyTokenIssuer | null | undefined = app.apiKeyTokens;
  if (issuer == null) {
    throw new Error('API keys cannot be created: the API was built without its key pepper');
  }
  return issuer;
}

const contextOf = (request: FastifyRequest) =>
  serviceContextOf(requirePrincipal(request), {
    requestId: request.id,
    ipAddress: request.ip,
    userAgent: request.headers['user-agent'],
  });

/** C12 API key routes (scopes `api-keys:*`), under `/api/v1`. */
export const apiKeyRoutes: FastifyPluginCallbackZod<ApiDependencies> = (app, deps, done) => {
  app.post(
    '/api-keys',
    {
      config: { scopes: ['api-keys:write'] },
      schema: {
        summary: 'Create an API key',
        description:
          'The answer carries the token once, in `meta.token`; afterwards the key shows only ' +
          'its `token-prefix`. A caller can grant only scopes it holds (403 `forbidden`). An ' +
          'empty `allowed-ips` allows every address; ranges must name networks (422). ' +
          '`expires-in-seconds` (C25.5, 1 to 2,592,000) makes the key expire that long after ' +
          'creation; without it the key never expires. The read-only `pii-masked` (C25.6) is ' +
          'true when the caller cannot see PII, and the key then sees PII masked as it does.',
        tags: TAGS,
        body: createApiKeyBodySchema,
        response: {
          201: createdApiKeyDocumentSchema,
          ...problemResponses(400, 401, 403, 422),
        },
      },
    },
    async (request, reply) => {
      const document = await createApiKey(
        deps,
        contextOf(request),
        requirePrincipal(request),
        request.body.data.attributes,
        issuerOf(app),
      );
      return reply
        .code(201)
        .header('location', `${API_KEYS_PATH}/${document.data.id}`)
        .header('cache-control', NO_STORE)
        .send(document);
    },
  );

  app.get(
    '/api-keys',
    {
      config: { scopes: ['api-keys:read'] },
      schema: {
        summary: 'List API keys, newest first',
        description:
          'Keys created before token prefixes were kept show `----` in place of the secret ' +
          'characters. A key revoked earlier reports when it stopped working as `expires-at`.',
        tags: TAGS,
        querystring: listApiKeysQuerySchema,
        response: { 200: apiKeyListDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    (request) => listApiKeys(deps, requirePrincipal(request), request.query),
  );

  app.get(
    '/api-keys/:id',
    {
      config: { scopes: ['api-keys:read'] },
      schema: {
        summary: 'Fetch an API key',
        tags: TAGS,
        params,
        response: { 200: apiKeyDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    async (request) => ({
      data: await getApiKey(deps, requirePrincipal(request), request.params.id),
    }),
  );

  app.patch(
    '/api-keys/:id',
    {
      config: { scopes: ['api-keys:write'] },
      schema: {
        summary: 'Rename an API key or change its allowed IPs',
        description: 'Scopes and the API version of a key never change; clone it instead.',
        tags: TAGS,
        params,
        body: updateApiKeyBodySchema,
        response: {
          200: apiKeyDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 422),
        },
      },
    },
    async (request) => {
      return {
        data: await updateApiKey(
          deps,
          contextOf(request),
          requirePrincipal(request),
          request.params.id,
          request.body.data.attributes,
        ),
      };
    },
  );

  app.post(
    '/api-keys/:id/clone',
    {
      config: { scopes: ['api-keys:write'] },
      schema: {
        summary: 'Clone an API key',
        description:
          "A new key with the source's scopes, allowed IPs and API version, named " +
          '`meta.name` or as the source, and a new token returned once in `meta.token`. The ' +
          'caller must hold every scope the source has (403 `forbidden`).',
        tags: TAGS,
        params,
        // Fastify validates a request without a body as `null`, which means "no body" here.
        body: cloneApiKeyBodySchema.nullable(),
        response: { 201: createdApiKeyDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    async (request, reply) => {
      const document = await cloneApiKey(
        deps,
        contextOf(request),
        requirePrincipal(request),
        request.params.id,
        request.body?.meta?.name,
        issuerOf(app),
      );
      return reply
        .code(201)
        .header('location', `${API_KEYS_PATH}/${document.data.id}`)
        .header('cache-control', NO_STORE)
        .send(document);
    },
  );

  // C169.1 (Workflow 9B): one-call rotation (`services/api-keys/rotate.ts`).
  app.post(
    '/api-keys/:id/rotate',
    {
      config: { scopes: ['api-keys:write'] },
      schema: {
        summary: 'Rotate an API key',
        description:
          'C169.1: a new key with the source’s scopes, allowed IPs, API version, attribute ' +
          'blocklist and note, through the clone’s checks (the caller must hold every scope it ' +
          'copies; 403 `forbidden`), and its token once in `meta.token`. The old key stops working ' +
          '`meta.previous-expires-in-seconds` from now (0 to 2,592,000; 0 is now), in the same ' +
          'transaction; `meta.previous-key-id` and `meta.previous-expires-at` name it and its end.',
        tags: TAGS,
        params,
        body: rotateApiKeyBodySchema,
        response: {
          201: rotatedApiKeyDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    async (request, reply) => {
      const document = await rotateApiKey(
        deps,
        contextOf(request),
        requirePrincipal(request),
        request.params.id,
        request.body.meta,
        issuerOf(app),
      );
      return reply
        .code(201)
        .header('location', `${API_KEYS_PATH}/${document.data.id}`)
        .header('cache-control', NO_STORE)
        .send(document);
    },
  );

  app.post(
    '/api-keys/:id/expire',
    {
      config: { scopes: ['api-keys:write'] },
      schema: {
        summary: 'Expire an API key',
        description:
          'The key stops working `meta.expires-in-seconds` from now (0 to 2,592,000; 0 is ' +
          'now). An earlier expiry is kept: expiring never extends a key.',
        tags: TAGS,
        params,
        body: expireApiKeyBodySchema,
        response: { 200: apiKeyDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    async (request) => ({
      data: await expireApiKey(
        deps,
        contextOf(request),
        requirePrincipal(request),
        request.params.id,
        request.body.meta['expires-in-seconds'],
      ),
    }),
  );

  done();
};
