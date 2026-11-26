import swagger from '@fastify/swagger';
import Fastify, { LogController } from 'fastify';
import {
  createJsonSchemaTransform,
  createJsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { RateLimitPolicy } from '@openverify/contracts';
import { generateApiKey } from '@openverify/db';
import { defaultAppMode, type AppMode } from './config.js';
import { loggerOptions, type LoggerSettings } from './logger.js';
// api-operators: begin
import { fastifyTrustProxy, type TrustProxySetting } from './operator-auth/settings.js';
// api-operators: end
import apiLogs from './plugins/api-logs.js';
import apiVersion, { createApiKeyVersionLookup } from './plugins/api-version.js';
import idempotency from './plugins/idempotency.js';
import { openApiComponents } from './plugins/openapi.js';
import { markServerApiOperations, withServerApiPlatform } from './plugins/openapi-platform.js';
import principalAuth, {
  type ApiKeyLookup,
  type AuthenticatedApiKey,
} from './plugins/principal-auth.js';
import rateLimit, { rateLimitRules } from './plugins/rate-limit.js';
import type { PrincipalResolver } from './ports.js';
import { registerProblemDetails } from './problem-details.js';
import { REQUEST_ID_HEADER, requestIdFor } from './request-id.js';
import { USER_SESSION_SECURITY_SCHEME } from './routes/dashboard/openapi.js';
import { registerHsts } from './http/hsts.js';
import { registerInternalRoutes, type InternalListen } from './http/internal-listener.js';
import { flowRoutes } from './routes/flow/index.js';
import { embedPolicyRoutes } from './routes/internal/embed-policies.js';
import { serverRoutes } from './routes/server/index.js';
import { sandboxSmsRoutes, servesSandboxSmsSink } from './routes/server/sandbox-sms.js';
import { systemRoutes } from './routes/system.js';
import { readinessProbesOf } from './http/readiness.js';
import type { ApiKeyTokenIssuer } from './services/api-keys.js';
import type { ApiDependencies } from './services/context.js';
import { packageVersion } from './version.js';

export type { AppMode } from './config.js';

export interface BuildAppOptions {
  /** Resolves a bearer token to its API key. Injected so unit tests need no database. */
  lookupApiKey: ApiKeyLookup;
  /**
   * `production` hides messages and stack traces of unexpected errors. Defaults to
   * NODE_ENV when that is `development` or `test`, and to `production` otherwise.
   */
  mode?: AppMode;
  /** Reported by GET /health and the OpenAPI document. Defaults to the package version. */
  version?: string;
  /** Logger settings, or `false` to disable logging. PII redaction is always on. */
  logger?: LoggerSettings | false;
  /** Clock for API key expiry. */
  now?: () => Date;
  /** Called after an API key authenticated a request, e.g. to record `last_used_at`. */
  onAuthenticated?: (key: AuthenticatedApiKey) => Promise<void>;
  /**
   * Resolves `ovu_` dashboard user sessions on the server API (C12). Defaults to
   * `api.resolveUserSession`; without either, user sessions are refused.
   */
  resolveUserSession?: PrincipalResolver | undefined;
  /**
   * Adapters for the Phase 1 API. With them the app serves the server API (C2) under
   * `/api/v1` and the flow API (C3) under `/api/v1/flow`; without them only the core routes
   * (health, OpenAPI), which unit tests use.
   */
  api?: ApiDependencies;
  /**
   * Trust `X-Forwarded-*` headers from a reverse proxy, so `request.ip` (stored with consent
   * records and checked against API key allowlists) is the client's address. Off by default.
   */
  // api-operators: begin
  // C15 `OPENVERIFY_TRUST_PROXY`: also a hop count, or trusted proxy addresses and CIDR ranges.
  trustProxy?: TrustProxySetting;
  // api-operators: end
  /**
   * C12 requests per minute of each rate limit policy; policies left out keep the contract
   * defaults (`api` 300, `flow-session` 120, `flow-ip` 600, `one-time-link-redeem` 30).
   */
  rateLimits?: Partial<Record<RateLimitPolicy, number>> | undefined;
  /**
   * `OPENVERIFY_API_KEY_PEPPER`, which hashes the tokens of keys created through the API (C12
   * `POST /api-keys` and clone). Without it those routes answer 500 instead of issuing tokens
   * that could never authenticate.
   */
  apiKeyPepper?: Uint8Array | undefined;
  /**
   * C250.3 (Workflow 11B): `OPENVERIFY_INTERNAL_LISTEN`; set, the internal routes leave the public
   * app for their own listener (platform-ops' `http/internal-listener.ts`). Defaults to `null`.
   */
  internalListen?: InternalListen | null;
  /** C255.1 (Workflow 11B): `OPENVERIFY_HSTS_MAX_AGE`; 0 (the default) sends no HSTS header. */
  hstsMaxAge?: number;
}

/** The OpenAPI scheme of the flow API's session tokens (C1). */
const SESSION_TOKEN_SCHEME = {
  type: 'http',
  scheme: 'bearer',
  description: 'Flow session token sent as "Authorization: Bearer <ovs_...>".',
} as const;

/**
 * The zod validator, except that a body nested past the stack (a recursive schema such as C104.2's
 * field schemas, read about a thousand levels deep) answers a 400 validation problem instead of a
 * `RangeError` and a 500.
 */
const stackSafeValidatorCompiler: typeof validatorCompiler = (route) => {
  const validate = validatorCompiler(route);
  return (data) => {
    try {
      return validate(data);
    } catch (error) {
      if (!(error instanceof RangeError)) {
        throw error;
      }
      return {
        error: [
          {
            keyword: 'depth',
            instancePath: '',
            schemaPath: '#',
            params: {},
            message: 'is nested more deeply than this operation reads',
          },
        ],
      };
    }
  };
};

/**
 * Builds the OpenVerify API. Every route added before `ready()` gets principal auth (an API
 * key or a dashboard user session, C12), request ids and problem+json errors. Register routes
 * as plugins (`app.register(routes)`) so that @fastify/swagger also sees them for
 * /openapi.json; it misses bare root-level `app.get` calls made on the returned instance.
 */
export function buildApp(options: BuildAppOptions) {
  const mode = options.mode ?? defaultAppMode(process.env.NODE_ENV);
  const version = options.version ?? packageVersion();

  const app = Fastify({
    logger: loggerOptions(options.logger),
    genReqId: requestIdFor,
    requestIdHeader: false,
    logController: new LogController({ requestIdLogLabel: 'requestId' }),
    // api-operators: begin
    trustProxy: fastifyTrustProxy(options.trustProxy ?? false),
    // api-operators: end
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(stackSafeValidatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook('onRequest', (request, reply, done) => {
    void reply.header(REQUEST_ID_HEADER, request.id);
    // KP11-70 (ASVS v5.0.0-3.4.4): no answer is sniffed into another type, JSON and problem+json
    // included; the file routes set the same value themselves.
    void reply.header('x-content-type-options', 'nosniff');
    done();
  });

  registerProblemDetails(app, { exposeInternals: mode !== 'production' });
  // C255.1 (Workflow 11B; platform-ops' http/hsts.ts).
  registerHsts(app, options.hstsMaxAge ?? 0);

  const resolveUserSession = options.resolveUserSession ?? options.api?.resolveUserSession;
  // C12: with a user-session resolver, every server API operation also accepts a dashboard
  // user session; the document lists the two schemes as alternatives.
  const acceptsUserSessions = resolveUserSession !== undefined;
  void app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'OpenVerify API',
        description: 'Open-source identity verification platform API.',
        version,
      },
      components: {
        securitySchemes: {
          apiKey: {
            type: 'http',
            scheme: 'bearer',
            description: 'API key sent as "Authorization: Bearer <key>".',
          },
          ...(options.api === undefined ? {} : { sessionToken: SESSION_TOKEN_SCHEME }),
          ...(acceptsUserSessions ? USER_SESSION_SECURITY_SCHEME : {}),
        },
      },
      security: acceptsUserSessions ? [{ apiKey: [] }, { userSession: [] }] : [{ apiKey: [] }],
    },
    // 2B F026: every server API operation also documents the C12 headers and problems.
    transform: markServerApiOperations(
      createJsonSchemaTransform({ schemaRegistry: openApiComponents }),
    ),
    transformObject: withServerApiPlatform(
      createJsonSchemaTransformObject({ schemaRegistry: openApiComponents }),
    ),
  });

  void app.register(principalAuth, {
    lookupApiKey: options.lookupApiKey,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.onAuthenticated === undefined ? {} : { onAuthenticated: options.onAuthenticated }),
    ...(resolveUserSession === undefined ? {} : { resolveUserSession }),
  });

  // C250.1 (platform-ops' named borrowed edit): /ready asks the API's own stores.
  void app.register(systemRoutes, {
    version,
    ...(options.api === undefined ? {} : { readiness: readinessProbesOf(options.api) }),
  });

  const { apiKeyPepper } = options;
  const apiKeyTokens: ApiKeyTokenIssuer | null =
    apiKeyPepper === undefined ? null : (kind) => generateApiKey(kind, apiKeyPepper);
  app.decorate('apiKeyTokens', apiKeyTokens);

  if (options.api !== undefined) {
    const { api } = options;
    // C12 platform behaviour, in this order after principal auth: count the request against
    // its rate limit, settle the API version it is served with, claim or replay its
    // idempotency key, and record it in the API log once answered.
    void app.register(rateLimit, {
      limiter: api.rateLimiter,
      clock: api.clock,
      rules: rateLimitRules(options.rateLimits),
    });
    void app.register(apiVersion, { apiKeyVersion: createApiKeyVersionLookup(api.db) });
    void app.register(idempotency, { db: api.db, clock: api.clock });
    void app.register(apiLogs, { db: api.db, ids: api.ids });
    void app.register(serverRoutes, { prefix: '/api/v1', ...options.api });
    // C55.11: the sandbox SMS sink, only outside production mode with the sandbox sender bound.
    if (servesSandboxSmsSink(mode, api.providers)) {
      void app.register(sandboxSmsRoutes, { prefix: '/api/v1', ...options.api });
    }
    void app.register(flowRoutes, { prefix: '/api/v1/flow', ...options.api });
    // C157.2 (Workflow 9A Stage 1b (F)): the flow server's internal lookup, out of the public document.
    // C250.3 (Workflow 11B): through platform-ops' hook, which moves it to the internal listener.
    registerInternalRoutes(app, {
      internalListen: options.internalListen ?? null,
      register: (scope) => {
        void scope.register(embedPolicyRoutes, { prefix: '/api/v1/internal', ...api });
      },
    });
  }

  return app;
}
