/**
 * Server API authentication (contract C12). Every route takes a bearer token that resolves to
 * a principal, exposed as `request.principal`:
 * - an API key (`ov_sbx_...`, `ov_prod_...`), looked up by the injected `ApiKeyLookup`;
 * - a dashboard user session (`ovu_...`), resolved by the injected user-session
 *   `PrincipalResolver` (api-operators).
 *
 * A route declares the permissions it needs with `config: { scopes: [...] }`. API keys hold
 * their scopes; users hold their roles' permissions. Both are checked the same way.
 */
import { BlockList, isIPv4, isIPv6 } from 'node:net';
import { USER_SESSION_TOKEN_PREFIX } from '@openverify/contracts';
import { isPermission, missingPermissions, type Permission } from '@openverify/core';
import { API_KEY_PREFIXES, type EventCause } from '@openverify/db';
import type { FastifyPluginCallback, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import {
  ForbiddenError,
  MfaRequiredError,
  PermissionDeniedError,
  UnauthorizedError,
} from '../errors.js';
import {
  enterRequestEventCause,
  eventCauseOf,
  runWithEventCause,
} from '../events/cause-context.js';
import type { ApiKeyPrincipal, Principal, PrincipalResolver } from '../ports.js';

/** What the key lookup returns for a token it recognises. */
export interface ApiKeyRecord {
  id: string;
  organizationId: string;
  environmentId: string;
  /** The kind of the key's environment, from the environment row (C12). */
  environmentKind: 'sandbox' | 'production';
  /** Stored scopes. Values that are not a known `Permission` grant nothing. */
  scopes: readonly string[];
  expiresAt: Date | null;
  revokedAt: Date | null;
  /** CIDR allowlist of client addresses; `null`, absent or empty means any address. */
  allowedIps?: readonly string[] | null;
  /** C15: the key sees PII masked, as the principal that minted it did. Absent means false. */
  piiMasked?: boolean;
  /** C169.3 (Workflow 9B): the key's attribute blocklist; absent or empty means none. */
  attributeBlocklist?: readonly string[] | null;
}

/** The key passed to `onAuthenticated`. */
export interface AuthenticatedApiKey {
  id: string;
  environmentId: string;
  scopes: readonly string[];
}

/**
 * Resolves a presented bearer token to its key, or `null` when it is unknown. The
 * database implementation hashes the token (`hashApiKeySecret` in @openverify/db) and
 * looks the hash up; tests inject an in-memory function.
 */
export type ApiKeyLookup = (token: string) => Promise<ApiKeyRecord | null>;

export interface PrincipalAuthOptions {
  lookupApiKey: ApiKeyLookup;
  /** Clock for API key expiry checks; injectable for tests. */
  now?: () => Date;
  /**
   * Called after an API key passed every check, e.g. to record `last_used_at`. A failure is
   * logged and never fails the request.
   */
  onAuthenticated?: (key: AuthenticatedApiKey) => Promise<void>;
  /** Resolves `ovu_` user session tokens. Without it, user sessions are refused (401). */
  resolveUserSession?: PrincipalResolver | undefined;
}

/**
 * The credential a route takes. `api-key` (the default) is the server API credential, an API
 * key or a dashboard user session, checked by this plugin. Routes that name another scheme
 * (`session-token` for the flow API, `user-session` for the dashboard API) are skipped here
 * and must run their own authentication hook.
 */
export type RouteAuth = 'api-key' | 'session-token' | 'user-session';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Skip authentication. Routes are private unless marked public. */
    public?: boolean;
    /** The credential the route takes; defaults to `api-key`. */
    auth?: RouteAuth;
    /**
     * Permissions the principal must hold, e.g. `['inquiries:write']`: an API key's scopes or
     * a user's permissions (C12, C15).
     */
    scopes?: readonly Permission[];
  }

  interface FastifyRequest {
    /** Who the request acts for; `null` on public routes and outside the server API. */
    principal: Principal | null;
    /** C121.3: the request's store in the event cause context. */
    eventCause: EventCause | null;
  }
}

const MAX_TOKEN_LENGTH = 512;
/** RFC 6750 `b64token`; the scheme name is case-insensitive (RFC 9110 §11.1). */
const BEARER = /^Bearer ([A-Za-z0-9\-._~+/]+=*)$/i;

/** Extracts the token from `Authorization: Bearer <token>`, or `undefined`. */
export function parseBearerToken(header: string | undefined): string | undefined {
  if (header === undefined || header.length > 'Bearer '.length + MAX_TOKEN_LENGTH) {
    return undefined;
  }
  return BEARER.exec(header)?.[1];
}

/**
 * The principal that authenticated the request. Only call it from server API routes: the auth
 * hook has then either set it or refused the request.
 * @throws {UnauthorizedError} when the request carries no principal.
 */
export function requirePrincipal(request: FastifyRequest): Principal {
  if (request.principal === null) {
    throw new UnauthorizedError('An API key or a user session is required.');
  }
  return request.principal;
}

const plural = (count: number, word: string): string => (count === 1 ? word : `${word}s`);

/**
 * Checks that `principal` holds every permission in `required`.
 * @throws {PermissionDeniedError} 403 `forbidden`, naming the missing permissions in request
 *   order: an API key's missing scopes, or a user's missing permissions.
 */
export function authorizePrincipal(principal: Principal, required: readonly Permission[]): void {
  const missing = missingPermissions(principal.permissions, required);
  if (missing.length === 0) {
    return;
  }
  const subject =
    principal.kind === 'api-key'
      ? `The API key is missing the required ${plural(missing.length, 'scope')}`
      : `The user is missing the required ${plural(missing.length, 'permission')}`;
  throw new PermissionDeniedError(`${subject}: ${missing.join(', ')}.`, missing);
}

// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/** Whether `address` is inside one of the CIDR ranges. Unparseable entries match nothing. */
export function isAddressAllowed(address: string, cidrs: readonly string[]): boolean {
  const ip = IPV4_MAPPED.exec(address)?.[1] ?? address;
  const family = isIPv4(ip) ? 'ipv4' : isIPv6(ip) ? 'ipv6' : null;
  if (family === null) {
    return false;
  }
  const list = new BlockList();
  for (const cidr of cidrs) {
    const [network = '', bits] = cidr.split('/', 2);
    const type = isIPv4(network) ? 'ipv4' : isIPv6(network) ? 'ipv6' : null;
    const prefix = bits === undefined ? (type === 'ipv4' ? 32 : 128) : Number(bits);
    if (type !== null && Number.isInteger(prefix) && prefix >= 0) {
      try {
        list.addSubnet(network, prefix, type);
      } catch {
        // An out-of-range prefix: skip the entry, so it allows nothing.
      }
    }
  }
  return list.check(ip, family);
}

const isApiKeyToken = (token: string): boolean =>
  Object.values(API_KEY_PREFIXES).some((prefix) => token.startsWith(prefix));

const invalidApiKey = () =>
  new UnauthorizedError('The API key is not valid.', { error: 'invalid_token' });

const invalidUserSession = () =>
  new UnauthorizedError('The user session is not valid or has expired.', {
    error: 'invalid_token',
  });

/**
 * The API key resolver: refuses revoked and expired keys (401) and client addresses outside
 * the key's allowlist (403), exactly as Phase 1 did.
 */
function apiKeyResolver(lookup: ApiKeyLookup, now: () => Date) {
  return async (token: string, request: FastifyRequest): Promise<ApiKeyPrincipal | null> => {
    const key = await lookup(token);
    if (key === null) {
      return null;
    }
    if (key.revokedAt !== null) {
      throw new UnauthorizedError('The API key has been revoked.', { error: 'invalid_token' });
    }
    if (key.expiresAt !== null && key.expiresAt.getTime() <= now().getTime()) {
      throw new UnauthorizedError('The API key has expired.', { error: 'invalid_token' });
    }
    const allowedIps = key.allowedIps ?? [];
    if (allowedIps.length > 0 && !isAddressAllowed(request.ip, allowedIps)) {
      throw new ForbiddenError('The API key may not be used from this IP address.');
    }
    return {
      kind: 'api-key',
      apiKeyId: key.id,
      organizationId: key.organizationId,
      environmentId: key.environmentId,
      environmentKind: key.environmentKind,
      permissions: new Set(key.scopes.filter(isPermission)),
      ...(key.piiMasked === true ? { piiMasked: true } : {}),
      // C169.3 (Workflow 9B Stage 1b (W)): read by the blocklist hook of `plugins/api-version.ts`.
      ...(key.attributeBlocklist != null && key.attributeBlocklist.length > 0
        ? { attributeBlocklist: [...key.attributeBlocklist] }
        : {}),
    };
  };
}

const principalAuth: FastifyPluginCallback<PrincipalAuthOptions> = (app, options, done) => {
  const resolveApiKey = apiKeyResolver(options.lookupApiKey, options.now ?? (() => new Date()));
  const { resolveUserSession } = options;

  /** Picks the resolver by token prefix, so a token only ever reaches its own store. */
  async function resolve(token: string, request: FastifyRequest): Promise<Principal> {
    if (token.startsWith(USER_SESSION_TOKEN_PREFIX)) {
      const principal =
        resolveUserSession === undefined ? null : await resolveUserSession(token, request);
      if (principal === null) {
        throw invalidUserSession();
      }
      return principal;
    }
    if (!isApiKeyToken(token)) {
      throw invalidApiKey();
    }
    const principal = await resolveApiKey(token, request);
    if (principal === null) {
      throw invalidApiKey();
    }
    return principal;
  }

  app.decorateRequest('principal', null);
  app.decorateRequest('eventCause', null);

  // C121.3: every request runs under a store of its own, which the two hooks below fill in. A callback
  // hook, because the rest of the chain has to run inside the context, and again after the body
  // parser, whose stream callbacks run outside it.
  app.addHook('onRequest', (request, _reply, next) => {
    const cause: EventCause = {};
    request.eventCause = cause;
    runWithEventCause(cause, () => {
      next();
    });
  });
  app.addHook('preValidation', (request, _reply, next) => {
    runWithEventCause(request.eventCause ?? {}, () => {
      next();
    });
  });

  app.addHook('onRequest', async (request) => {
    const { config } = request.routeOptions;
    if (request.is404 || config.public === true || (config.auth ?? 'api-key') !== 'api-key') {
      return;
    }

    const token = parseBearerToken(request.headers.authorization);
    // eslint-disable-next-line security/detect-possible-timing-attacks -- a presence check against null or undefined, not a comparison of two secrets
    if (token === undefined) {
      throw new UnauthorizedError(
        'An API key is required. Send it as "Authorization: Bearer <key>".',
      );
    }

    const principal = await resolve(token, request);
    if (principal.kind === 'user' && !principal.mfaSatisfied) {
      throw new MfaRequiredError();
    }
    authorizePrincipal(principal, config.scopes ?? []);

    request.principal = principal;
    enterRequestEventCause(eventCauseOf(principal));
    if (principal.kind === 'api-key' && options.onAuthenticated !== undefined) {
      try {
        await options.onAuthenticated({
          id: principal.apiKeyId,
          environmentId: principal.environmentId,
          scopes: [...principal.permissions],
        });
      } catch (error) {
        request.log.warn({ err: error }, 'recording API key use failed');
      }
    }
  });

  done();
};

/**
 * Bearer authentication for every route, unless the route sets `config: { public: true }` or
 * names another credential with `config: { auth }`. Failures are 401 (missing, unknown,
 * revoked or expired credentials; `mfa-required` for a user session that has not satisfied
 * required MFA) or 403 (an address outside the API key's allowlist, or `forbidden` for a
 * missing permission).
 */
export default fp(principalAuth, { name: 'openverify-principal-auth', fastify: '5.x' });
