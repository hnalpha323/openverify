/**
 * C12 date-based API versions on the server API. A request may name one in the
 * `OpenVerify-Version` header; otherwise the API key's `api-version` applies, and dashboard
 * user sessions get the latest. An unknown version answers 400 `unsupported-api-version`.
 * Every server API response echoes the version that applied (`request.apiVersion`).
 */
import {
  API_VERSION_HEADER,
  API_VERSIONS,
  isApiVersion,
  LATEST_API_VERSION,
  type ApiVersion,
} from '@openverify/contracts';
import { getApiKey, type Db } from '@openverify/db';
import type { FastifyPluginCallback, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { UnsupportedApiVersionError } from '../errors.js';
import type { ApiKeyPrincipal, Principal } from '../ports.js';
import { applyKeyAttributeBlocklist } from '../services/api-keys/blocklist.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The C12 API version the request is served with; `null` outside the server API. */
    apiVersion: ApiVersion | null;
  }
}

/** The `api-version` of an API key, or `null` when it has no version the API knows. */
export type ApiKeyVersionLookup = (principal: ApiKeyPrincipal) => Promise<ApiVersion | null>;

export interface ApiVersionPluginOptions {
  apiKeyVersion: ApiKeyVersionLookup;
}

const DEFAULT_MAX_ENTRIES = 10_000;

/**
 * Reads API keys' `api-version` from `api_keys`. A key's version is fixed when it is created
 * (C12 `PATCH /api-keys/:id` changes only the name and allowed IPs), so lookups are cached in
 * a map bounded to `maxEntries`; the oldest entry goes first.
 */
export function createApiKeyVersionLookup(
  db: Db,
  options: { maxEntries?: number } = {},
): ApiKeyVersionLookup {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const cache = new Map<string, ApiVersion | null>();
  return async (principal) => {
    const cacheKey = `${principal.environmentId}/${principal.apiKeyId}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const key = await getApiKey(db, principal.environmentId, principal.apiKeyId);
    if (key === null) {
      return null;
    }
    const version = isApiVersion(key.apiVersion) ? key.apiVersion : null;
    if (cache.size >= maxEntries) {
      const oldest = cache.keys().next();
      if (oldest.done !== true) {
        cache.delete(oldest.value);
      }
    }
    cache.set(cacheKey, version);
    return version;
  };
}

/** The server API's routes: authenticated with an API key or a user session (C12). */
function isServerApiRoute(request: FastifyRequest): boolean {
  const { config } = request.routeOptions;
  return !request.is404 && config.public !== true && (config.auth ?? 'api-key') === 'api-key';
}

/**
 * The request's principal. Routes in scopes created before principal auth loaded, such as
 * @fastify/swagger's, lack the decoration, so it can be `undefined` there.
 */
function principalOf(request: FastifyRequest): Principal | null {
  const principal: Principal | null | undefined = request.principal;
  return principal ?? null;
}

const requestedVersion = (request: FastifyRequest): string | undefined => {
  const value = request.headers[API_VERSION_HEADER];
  return Array.isArray(value) ? value.join(', ') : value;
};

const apiVersionPlugin: FastifyPluginCallback<ApiVersionPluginOptions> = (app, options, done) => {
  async function defaultVersion(principal: Principal): Promise<ApiVersion> {
    if (principal.kind === 'user') {
      return LATEST_API_VERSION;
    }
    return (await options.apiKeyVersion(principal)) ?? LATEST_API_VERSION;
  }

  app.decorateRequest('apiVersion', null);

  app.addHook('onRequest', async (request) => {
    const principal = principalOf(request);
    if (principal === null) {
      return;
    }
    const requested = requestedVersion(request);
    if (requested !== undefined && isApiVersion(requested)) {
      request.apiVersion = requested;
      return;
    }
    request.apiVersion = await defaultVersion(principal);
    if (requested !== undefined) {
      throw new UnsupportedApiVersionError(
        `The ${API_VERSION_HEADER} header names no supported API version. ` +
          `Supported versions: ${API_VERSIONS.join(', ')}.`,
      );
    }
  });

  app.addHook('onSend', async (request, reply, payload) => {
    if (isServerApiRoute(request)) {
      const requested = requestedVersion(request);
      const version =
        request.apiVersion ?? (isApiVersion(requested) ? requested : LATEST_API_VERSION);
      void reply.header(API_VERSION_HEADER, version);
    }
    return payload;
  });

  // C169.3 (Workflow 9B Stage 1b (W); contracts B3): every answer to an API key with an attribute
  // blocklist goes through `applyKeyAttributeBlocklist` (`api-keys-webhooks`) as serialized, after the
  // strict response schemas and before `idempotency` and `api-logs`, which this plugin is registered
  // ahead of, so a replayed answer and a stored API log hold what it answers.
  app.addHook('onSend', async (request, reply, payload) => {
    const principal = principalOf(request);
    const blocklist = principal?.kind === 'api-key' ? principal.attributeBlocklist : undefined;
    if (principal?.kind !== 'api-key' || blocklist === undefined || blocklist.length === 0) {
      return payload;
    }
    const contentType = reply.getHeader('content-type');
    return applyKeyAttributeBlocklist(payload, {
      principal,
      blocklist,
      contentType: typeof contentType === 'string' ? contentType : undefined,
    });
  });

  done();
};

/**
 * C12 `OpenVerify-Version` validation and echo. Register it after principal auth, so the
 * default can come from the principal.
 */
export default fp(apiVersionPlugin, { name: 'openverify-api-version', fastify: '5.x' });
