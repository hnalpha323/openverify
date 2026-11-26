import { getDefaultKeyring, type Db, type Keyring } from '@openverify/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { createOperatorAuth, type OperatorAuth } from '../../operator-auth/index.js';
import type { CaseRenditionQueue, FileStorage } from '../../ports.js';
import { dashboardAdminRoutes, type DashboardAdminOptions } from './admin.js';
import { authenticateOperator } from './authenticate.js';
import type { DashboardContext } from './context.js';
import { fileRoutes } from './files.js';
import { inquiryRoutes } from './inquiries.js';
import { fileRenditionRoutes } from './file-renditions.js';
import { savedViewRoutes } from './saved-views.js';
import { simulationPresetRoutes } from './simulation-presets.js';
import { notificationPreferenceRoutes } from './notification-preferences.js';
import { notificationRoutes } from './notifications.js';
import { dashboardSwaggerTransform } from './openapi.js';
import { loginRoutes, sessionRoutes } from './sessions.js';
import type { ConnectInstallSettings } from '../../config.js';
import { connectDashboardRoutes } from './connect.js';
import { ssoPublicRoutes, ssoSessionRoutes, type SsoRouteOptions } from './sso.js';

export { requireOperator } from './authenticate.js';
export { DASHBOARD_TAG, USER_SESSION_SECURITY, USER_SESSION_SECURITY_SCHEME } from './openapi.js';

export interface DashboardRoutesOptions {
  db: Db;
  /** Where uploaded files' ciphertext lives (`createFileStorage`). */
  storage: FileStorage;
  /** Login, sessions and rate limits. Defaults to `createOperatorAuth({ db })`. */
  operatorAuth?: OperatorAuth | undefined;
  /** Unwraps file data keys. Defaults to the process keyring (`OPENVERIFY_KEK`). */
  keyring?: Keyring | undefined;
  /** What the C15 routes (`dashboardAdminRoutes`) need beyond the context above. */
  admin?: DashboardAdminOptions | undefined;
  /** C135.3 (Workflow 8B (F)): the `case-rendition` producer of an inquiry file's first view. */
  caseRenditions?: CaseRenditionQueue | undefined;
  /** C231.10 (Workflow 11A Stage 1b (C)): the install switch; absent or off, Connect answers 404. */
  connect?: ConnectInstallSettings | undefined;
  /** C248.3 (Workflow 11B Stage 1b (A)): what the SSO routes hand the SSO service. */
  sso?: SsoRouteOptions | undefined;
}

/**
 * Dashboard API routes (contracts C4 and C15). Register under `/api/v1/dashboard`;
 * `apps/dashboard` calls them server-side as a BFF.
 *
 * Every route authenticates with a user session (`ovu_` bearer token), never with an API
 * key, and every query is scoped to the session's environment. Login, and the C15 MFA login
 * and invitation acceptance in `dashboardAdminRoutes`, are the routes that need no session.
 */
export const dashboardRoutes: FastifyPluginAsyncZod<DashboardRoutesOptions> = async (
  app,
  options,
) => {
  const context: DashboardContext = {
    db: options.db,
    storage: options.storage,
    operatorAuth: options.operatorAuth ?? createOperatorAuth({ db: options.db }),
    keyring: () => options.keyring ?? getDefaultKeyring(),
    ...(options.caseRenditions === undefined ? {} : { caseRenditions: options.caseRenditions }),
  };

  // `public` makes the API key hook skip these routes; operator sessions authenticate them
  // instead (below). A route added here can therefore never be reached with an API key.
  // The swagger transform documents them with the `userSession` scheme.
  app.addHook('onRoute', (route) => {
    route.config = { ...route.config, public: true, swaggerTransform: dashboardSwaggerTransform };
  });
  app.decorateRequest('operator', null);
  // Responses carry tokens, PII and decrypted images: no cache may keep any of them. Routes
  // that need a stricter value (file content: `private, no-store`) set their own.
  app.addHook('onSend', async (_request, reply, payload) => {
    if (!reply.hasHeader('cache-control')) {
      void reply.header('cache-control', 'no-store');
    }
    return payload;
  });

  await app.register(loginRoutes, context);
  // C248.4 (Workflow 11B Stage 1b (A)): the BFF's SSO start and callback, frozen for sso-oidc.
  // sso-oidc's borrowed edit: the server API's ports (audit, mailer, clock, public URL) reach them.
  await app.register(ssoPublicRoutes, { ...context, sso: options.sso, admin: options.admin });
  // C15 routes; some take no session (MFA login, invitations), so they authenticate their own.
  await app.register(dashboardAdminRoutes, { ...context, ...options.admin, sso: options.sso });
  await app.register(async (authenticated) => {
    authenticated.addHook('onRequest', authenticateOperator(context.operatorAuth));
    await authenticated.register(sessionRoutes, context);
    // C248.6 (Workflow 11B Stage 1b (A); KP11-18): the SSO step-up, frozen for sso-oidc.
    await authenticated.register(ssoSessionRoutes, {
      ...context,
      sso: options.sso,
      admin: options.admin,
    });
    await authenticated.register(inquiryRoutes, context);
    await authenticated.register(fileRoutes, context);
    // C134.4 (Workflow 8B Stage 1b (C)): a user's case notifications, `api-cases`'.
    await authenticated.register(notificationRoutes, context);
    // C169.7 (Workflow 9B Stage 1b (W)): a user's notification preferences, `api-keys-webhooks`'.
    await authenticated.register(notificationPreferenceRoutes, context);
    // C135.3 (Workflow 8B Stage 1b (F)): an inquiry file's rendition, `api-case-files`'.
    await authenticated.register(fileRenditionRoutes, context);
    // C156.4 (Workflow 9A Stage 1b (T)): a user's simulation presets, `api-templates`'.
    await authenticated.register(simulationPresetRoutes, context);
    // C165.1 (Workflow 9B Stage 1b (X)): a user's saved views, `api-exports`'.
    await authenticated.register(savedViewRoutes, context);
    // C231.3 (Workflow 11A Stage 1b (C)): the activation, frozen by `foundation-11a`, `api-connect`'s.
    // integration-11a (api-connect's deviation): the server API's ports (audit, clock, ids, events).
    await authenticated.register(connectDashboardRoutes, {
      ...context,
      connect: options.connect,
      ...(options.admin?.api === undefined ? {} : { api: options.admin.api }),
    });
  });
};
