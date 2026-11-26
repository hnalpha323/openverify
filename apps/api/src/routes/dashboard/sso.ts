/**
 * C248 (Phase 11, Workflow 11B): OIDC sign-in for the console, under `/api/v1/dashboard`.
 *
 * - `ssoPublicRoutes` (no session): the BFF's start (`GET /sso/:organizationSlug/start`) and the
 *   callback per provider (`GET /sso/callback/:providerId`), each called by the console's route
 *   handlers with the BFF token and the browser binding (C248.4; Stage 1a amendment 37).
 * - `ssoSessionRoutes` (a session): the SSO step-up, an OIDC re-authentication
 *   (`POST /sessions/current/step-up/sso`; C248.6, KP11-18).
 * - `ssoProviderRoutes` (a session with `settings:read` or `settings:write` through an
 *   organisation-wide assignment, writes behind Phase 9's step-up): the providers (C248.3).
 *
 * Frozen by `foundation-11b` (Workflow 11B Stage 1b (A)) with `contracts-11b`'s schemas and built by
 * `sso-oidc`. `SsoRouteOptions` carries what the container hands the SSO service: the outbound
 * client and the install's private issuers; left out (tests that do not sign in with SSO), the
 * production rules apply and a client of the routes' own is made when first needed. The public and
 * session routes also read the server API's ports from `admin` (index.ts passes them, sso-oidc's
 * borrowed edit): the audit logger, the mailer of the first-link notice, the clock and
 * `OPENVERIFY_DASHBOARD_PUBLIC_URL`, the base of each provider's redirect URI.
 */
import {
  STEP_UP_WINDOW_SECONDS,
  SSO_BINDING_HEADER,
  createSsoProviderBodySchema,
  dashboardMfaChallengeResponseSchema,
  dashboardSessionResponseSchema,
  ssoCallbackParamsSchema,
  ssoCallbackQuerySchema,
  ssoProviderDocumentSchema,
  ssoProviderListDocumentSchema,
  ssoProviderParamsSchema,
  ssoRedirectSchema,
  ssoStartParamsSchema,
  ssoStartQuerySchema,
  ssoStartResponseSchema,
  ssoStepUpBodySchema,
  stepUpResponseSchema,
  toTimestamp,
  updateSsoProviderBodySchema,
} from '@openverify/contracts';
import { getOrganization, getUserSession, type User } from '@openverify/db';
import { z } from 'zod';
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { createOutboundHttp, type OutboundHttp } from '../../http/index.js';
import { createOidcClient } from '../../operator-auth/oidc/client.js';
import { createSsoRefusalLog } from '../../operator-auth/oidc/refusal-log.js';
import { createSsoService, type SsoService } from '../../operator-auth/oidc/service.js';
import { createPostgresSsoStore } from '../../operator-auth/oidc/store.js';
import { NO_STORE, problemResponses } from '../../plugins/openapi.js';
import {
  systemClock,
  ulidIdGenerator,
  type AuditLogger,
  type Clock,
  type IdGenerator,
  type Mailer,
} from '../../ports.js';
import { createAuditLogger } from '../../services/audit-log.js';
import { auditEntryOf } from '../../services/context.js';
import {
  createSsoProviderFor,
  deleteSsoProviderFor,
  getSsoProviderResource,
  listSsoProviderResources,
  updateSsoProviderFor,
  type SsoProviderActing,
  type SsoProviderServiceDeps,
} from '../../services/sso-providers.js';
import { toUserResource } from '../../services/users.js';
import type { AdminRouteContext } from './admin-context.js';
import type { DashboardAdminOptions } from './admin.js';
import { dashboardContextOf, requireOperator, userActor } from './authenticate.js';
import type { DashboardContext } from './context.js';
import { DASHBOARD_TAG, USER_SESSION_SECURITY } from './openapi.js';

/** What the container hands the SSO routes (C248.3). */
export interface SsoRouteOptions {
  /** The SSRF-guarded outbound client factory discovery, JWKS and token calls go through. */
  readonly outboundHttp?: OutboundHttp | undefined;
  /** `OPENVERIFY_SSO_PRIVATE_ISSUERS`: issuers allowed on a private address in production. */
  readonly privateIssuers: readonly string[];
  /** Production mode: private addresses are refused but for the issuers above. */
  readonly production: boolean;
}

/** The production rules, for routes registered without the container's options. */
const PRODUCTION_RULES: SsoRouteOptions = { privateIssuers: [], production: true };

/** The public and session routes' context: the dashboard's, the SSO options and the API's ports. */
type SsoPublicContext = DashboardContext & {
  sso?: SsoRouteOptions | undefined;
  admin?: DashboardAdminOptions | undefined;
};

/** Audit `resource_type` of operator sessions (as `sessions.ts`). */
const USER_SESSION_RESOURCE = 'user-session';

interface SsoPorts {
  audit: AuditLogger;
  /** Only a configured mailer sends the first-link notice. */
  mailer: Mailer | undefined;
  clock: Clock;
  ids: IdGenerator;
  dashboardPublicUrl: string | null;
}

function portsOf(admin: DashboardAdminOptions | undefined): SsoPorts {
  return {
    audit: admin?.api?.audit ?? createAuditLogger(),
    mailer: admin?.api?.mailer,
    clock: admin?.api?.clock ?? systemClock,
    ids: admin?.api?.ids ?? ulidIdGenerator,
    dashboardPublicUrl: admin?.dashboardPublicUrl ?? null,
  };
}

/** The outbound client of these routes: the container's, or one of their own closed with the app. */
function outboundOf(app: FastifyInstance, sso: SsoRouteOptions): () => OutboundHttp {
  let owned: OutboundHttp | undefined;
  app.addHook('onClose', async () => {
    await owned?.close();
  });
  return () => sso.outboundHttp ?? (owned ??= createOutboundHttp());
}

/** A service per request, so a refusal is logged with the request's own logger. */
function ssoServiceFactory(
  app: FastifyInstance,
  context: SsoPublicContext,
): (log: FastifyBaseLogger) => SsoService {
  const sso = context.sso ?? PRODUCTION_RULES;
  const ports = portsOf(context.admin);
  const outbound = outboundOf(app, sso);
  const { db, operatorAuth } = context;
  const store = createPostgresSsoStore({
    db,
    audit: ports.audit,
    ids: ports.ids,
    hasher: operatorAuth.hasher,
  });
  return (log) =>
    createSsoService({
      store,
      oidc: createOidcClient({
        outbound: outbound(),
        policy: { production: sso.production, privateIssuers: sso.privateIssuers },
        clock: ports.clock,
      }),
      sessions: {
        requireMfa: async (organizationId) =>
          (await getOrganization(db, organizationId))?.requireMfa ?? true,
        openSession: (user, mfaPassed, providerAmr) =>
          operatorAuth.openSsoSession(user, mfaPassed, providerAmr),
        startMfaChallenge: (user) => operatorAuth.startSsoMfaChallenge(user),
      },
      clock: ports.clock,
      dashboardPublicUrl: ports.dashboardPublicUrl,
      notifyLinked: linkNotifier(ports.mailer, log),
      onRefused: createSsoRefusalLog(log),
    });
}

/**
 * C248.4: the first link of an existing user is told to the user by mail when the mailer is
 * configured. A failed send never fails the sign-in, and its log line names no address.
 */
function linkNotifier(mailer: Mailer | undefined, log: FastifyBaseLogger) {
  if (mailer?.configured !== true) {
    return undefined;
  }
  return async (user: User, providerName: string) => {
    try {
      await mailer.send({
        to: { address: user.email },
        subject: 'Single sign-on was linked to your account',
        text:
          `Your console account can now be signed in to through ${providerName}. ` +
          'If you did not expect this, tell an administrator of your organization.',
      });
    } catch {
      log.warn({ sso: { notice: 'link' } }, 'the sso link notice was not sent');
    }
  };
}

/** The audit context of a step-up's session: its own organisation and environment. */
async function sessionContextOf(
  context: SsoPublicContext,
  request: FastifyRequest,
  sessionId: string,
) {
  const session = await getUserSession(context.db, sessionId);
  if (session === null) {
    throw new Error('the stepped-up session vanished');
  }
  return dashboardContextOf(request, context.operatorAuth, session);
}

/** C248.4: the BFF's start and callback; no session. */
export const ssoPublicRoutes: FastifyPluginAsyncZod<SsoPublicContext> = (app, context) => {
  const service = ssoServiceFactory(app, context);

  app.get(
    '/sso/:organizationSlug/start',
    {
      schema: {
        summary: 'Start an SSO sign-in',
        description:
          'C248.4: the console’s start handler asks for the authorization URL of the organisation ' +
          'named by its sign-in name (or a choice of its providers), with a single-use browser ' +
          'binding the handler sets as a cookie. 404 `sso_not_configured` for an unknown name, no ' +
          'provider or a provider of another organisation, one body.',
        tags: [DASHBOARD_TAG],
        security: [],
        params: ssoStartParamsSchema,
        querystring: ssoStartQuerySchema,
        response: { 200: ssoStartResponseSchema, ...problemResponses(400, 401, 404) },
      },
    },
    (request) =>
      service(request.log).start(request.params.organizationSlug, {
        providerId: request.query['provider-id'],
        returnTo: request.query['return-to'],
      }),
  );

  app.get(
    '/sso/callback/:providerId',
    {
      schema: {
        summary: 'Complete an SSO sign-in',
        description:
          'C248.4: the console’s callback handler passes the provider’s query unchanged with the ' +
          'browser binding in its header; 201 a session, 202 a local second factor ' +
          '(C248.6), 200 a step-up. Every refusal is generic toward the browser and detailed only ' +
          'as a code in the audit and the logs.',
        tags: [DASHBOARD_TAG],
        security: [],
        params: ssoCallbackParamsSchema,
        querystring: ssoCallbackQuerySchema,
        response: {
          200: stepUpResponseSchema,
          201: dashboardSessionResponseSchema,
          202: dashboardMfaChallengeResponseSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    async (request, reply) => {
      // The provider's query exactly as the browser brought it (the library checks `iss` in it).
      const query = new URL(request.url, 'http://localhost').searchParams;
      const header = request.headers[SSO_BINDING_HEADER];
      const result = await service(request.log).callback(
        request.params.providerId,
        query,
        typeof header === 'string' ? header : undefined,
      );
      void reply.header('cache-control', NO_STORE);
      if (result.kind === 'mfa') {
        return reply.code(202).send({ 'mfa-token': result.mfaToken, factors: result.factors });
      }
      const audit = portsOf(context.admin).audit;
      if (result.kind === 'step-up') {
        await audit.record(
          context.db,
          auditEntryOf(
            await sessionContextOf(context, request, result.sessionId),
            userActor(result.user.id),
            {
              action: 'user-session.stepped-up',
              resourceType: USER_SESSION_RESOURCE,
              resourceId: result.sessionId,
              metadata: { mfa: 'sso', 'sso-provider-id': request.params.providerId },
            },
          ),
        );
        return reply.code(200).send({
          'mfa-verified-at': toTimestamp(result.verifiedAt),
          'step-up-expires-at': toTimestamp(
            new Date(result.verifiedAt.getTime() + STEP_UP_WINDOW_SECONDS * 1000),
          ),
        });
      }
      const { token, expiresAt, session, user } = result;
      await audit.record(
        context.db,
        auditEntryOf(
          dashboardContextOf(request, context.operatorAuth, session),
          userActor(user.id),
          {
            action: 'user-session.created',
            resourceType: USER_SESSION_RESOURCE,
            resourceId: session.id,
            metadata: { sso: request.params.providerId, mfa: session.mfaSatisfied },
          },
        ),
      );
      return reply
        .code(201)
        .send({ token, 'expires-at': toTimestamp(expiresAt), user: toUserResource(user) });
    },
  );
  return Promise.resolve();
};

/** C248.6 (KP11-18): the SSO step-up of the current session. */
export const ssoSessionRoutes: FastifyPluginAsyncZod<SsoPublicContext> = (app, context) => {
  const service = ssoServiceFactory(app, context);

  app.post(
    '/sessions/current/step-up/sso',
    {
      config: { allowWithoutMfa: true },
      schema: {
        summary: 'Step up with an SSO re-authentication',
        description:
          'C248.6: for a session signed in through SSO, the authorization URL of a ' +
          're-authentication (`prompt=login`, `max_age=0`); its callback checks `auth_time` within ' +
          'the step-up window and the provider’s required `amr` or `acr`, then sets the session’s ' +
          'second-factor time.',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        body: ssoStepUpBodySchema,
        response: { 200: ssoRedirectSchema, ...problemResponses(400, 401, 404, 409) },
      },
    },
    async (request, reply) => {
      const operator = requireOperator(request);
      const redirect = await service(request.log).startStepUp({
        sessionId: operator.sessionId,
        user: operator.user,
      });
      return reply.header('cache-control', NO_STORE).send({
        kind: 'redirect' as const,
        'authorization-url': redirect.authorizationUrl,
        binding: redirect.binding,
        'expires-at': toTimestamp(redirect.expiresAt),
      });
    },
  );
  return Promise.resolve();
};

/** C248.3: an organisation's identity providers. */
export const ssoProviderRoutes: FastifyPluginAsyncZod<
  AdminRouteContext & { sso?: SsoRouteOptions | undefined }
> = (app, context) => {
  const deps: SsoProviderServiceDeps = {
    db: context.db,
    audit: context.audit,
    clock: context.clock,
    ids: context.ids,
    production: (context.sso ?? PRODUCTION_RULES).production,
    dashboardPublicUrl: context.dashboardPublicUrl ?? null,
  };
  const acting = (request: FastifyRequest): SsoProviderActing => {
    const operator = requireOperator(request);
    return {
      ctx: dashboardContextOf(request, context.operatorAuth, operator),
      userId: operator.user.id,
      sessionId: operator.sessionId,
    };
  };

  app.get(
    '/sso-providers',
    {
      config: { scopes: ['settings:read'] },
      schema: {
        summary: 'List the SSO providers',
        description:
          'C248.3: the organisation’s OIDC providers, oldest first; the client secret is never ' +
          'served (`client-secret-set`).',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        response: { 200: ssoProviderListDocumentSchema, ...problemResponses(401, 403) },
      },
    },
    async (request) => ({
      data: await listSsoProviderResources(deps, acting(request)),
      links: { next: null },
    }),
  );

  app.post(
    '/sso-providers',
    {
      config: { scopes: ['settings:write'] },
      schema: {
        summary: 'Add an SSO provider',
        description:
          'C248.3: an OIDC provider of the organisation (organisation-wide `settings:write` and ' +
          'the step-up); `allowed-email-domains` is required, a multi-tenant issuer needs a tenant ' +
          'pin, and just-in-time roles may hold no permission C248.5 forbids.',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        body: createSsoProviderBodySchema,
        response: {
          201: ssoProviderDocumentSchema,
          ...problemResponses(400, 401, 403, 409, 422),
        },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send({ data: await createSsoProviderFor(deps, acting(request), request.body) }),
  );

  app.get(
    '/sso-providers/:id',
    {
      config: { scopes: ['settings:read'] },
      schema: {
        summary: 'Retrieve an SSO provider',
        description: 'C248.3: one provider of the organisation; the client secret is never served.',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        params: ssoProviderParamsSchema,
        response: { 200: ssoProviderDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    async (request) => ({
      data: await getSsoProviderResource(deps, acting(request), request.params.id),
    }),
  );

  app.patch(
    '/sso-providers/:id',
    {
      config: { scopes: ['settings:write'] },
      schema: {
        summary: 'Change an SSO provider',
        description:
          'C248.3: any member, a new client secret included (organisation-wide `settings:write` ' +
          'and the step-up).',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        params: ssoProviderParamsSchema,
        body: updateSsoProviderBodySchema,
        response: {
          200: ssoProviderDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422),
        },
      },
    },
    async (request) => ({
      data: await updateSsoProviderFor(deps, acting(request), request.params.id, request.body),
    }),
  );

  app.delete(
    '/sso-providers/:id',
    {
      config: { scopes: ['settings:write'] },
      schema: {
        summary: 'Remove an SSO provider',
        description:
          'C248.3: removes the provider and its users’ links to it (organisation-wide ' +
          '`settings:write` and the step-up).',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        params: ssoProviderParamsSchema,
        response: {
          204: z.null().describe('The provider is removed.'),
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    async (request, reply) => {
      await deleteSsoProviderFor(deps, acting(request), request.params.id);
      return reply.code(204).send(null);
    },
  );
  return Promise.resolve();
};
