import { OTP_SMS_MAX_PER_HOUR, QUEUE_IN_FLIGHT_CAP } from '@openverify/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { createMailer } from '../../mail/index.js';
import { systemClock, ulidIdGenerator } from '../../ports.js';
import { createAuditLogger } from '../../services/audit-log.js';
import type { ApiDependencies } from '../../services/context.js';
import { syncAllOrganizationRoles } from '../../services/roles.js';
import type { AdminRouteContext } from './admin-context.js';
import { auditLogRoutes } from './audit-logs.js';
import { authenticateOperator } from './authenticate.js';
import type { DashboardContext } from './context.js';
import { environmentRoutes } from './environment.js';
import { invitationResendRoutes, invitationRoutes } from './invitations.js';
import { mfaFactorRoutes } from './mfa-factors.js';
import { printAuditRoutes } from './print-audits.js';
import { dashboardReportRoutes } from './reports.js';
import { roleRoutes } from './roles.js';
import { settingsRoutes } from './settings.js';
import { trustAnchorRoutes } from './trust-anchors.js';
import { userRoutes } from './users.js';
import { networkSourceRoutes } from './network-sources.js';
import { watchlistSourceRoutes } from './watchlist-sources.js';
import { watchlistOptInRoutes } from './watchlist-opt-in.js';
// foundation-11b: begin (Workflow 11B Stage 1b (A)): frozen at 501, built by their owners.
import { endSessionsRoutes } from './end-sessions.js';
import { ssoProviderRoutes, type SsoRouteOptions } from './sso.js';
// foundation-11b: end

/**
 * What the C15 dashboard routes take beyond {@link DashboardContext}. The container passes
 * them as `dashboardRoutes`' `admin` option; each has a default, so callers that pass none
 * (Phase 1 tests) still get working routes.
 */
export interface DashboardAdminOptions {
  /**
   * The server API's ports these routes use. Defaults: the DB-backed audit logger, a mailer
   * that is not configured (invitations answer 503), the system clock and ULIDs.
   */
  api?:
    | (Pick<ApiDependencies, 'audit' | 'mailer' | 'clock' | 'ids'> &
        Partial<
          Pick<
            ApiDependencies,
            'otpSmsMaxPerHourCeiling' | 'queueInFlightCapMax' | 'nfc' | 'events' | 'rateLimiter'
          >
        >)
    | undefined;
  /** `OPENVERIFY_DASHBOARD_PUBLIC_URL`, the base of invitation links. */
  dashboardPublicUrl?: string | undefined;
  /**
   * Sync every organization's built-in roles with `@openverify/core` when the app is ready:
   * set by the API process at startup (C15).
   */
  syncBuiltinRolesOnReady?: boolean | undefined;
  /** C248.3 (Workflow 11B): what the SSO provider routes hand the SSO service. */
  sso?: SsoRouteOptions | undefined;
  /**
   * C254.1 (Q10 granted 2026-11-21; KP11-31): `OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED`, the UN
   * opt-in's install switch, handed to the opt-in routes; absent, false (every opt-in answers 409).
   */
  watchlistUnOptInAllowed?: boolean | undefined;
}

export type DashboardAdminContext = DashboardContext & DashboardAdminOptions;

/**
 * C15 dashboard routes under `/api/v1/dashboard`: invitation acceptance (no session), then,
 * behind operator authentication, the environment switch, MFA enrolment, users and
 * invitations, roles, audit logs, settings, the trust store (C62.10), and the Phase 6 reports and
 * watchlist sources (C72.3).
 */
export const dashboardAdminRoutes: FastifyPluginAsyncZod<DashboardAdminContext> = async (
  app,
  options,
) => {
  const context: AdminRouteContext = {
    db: options.db,
    storage: options.storage,
    operatorAuth: options.operatorAuth,
    keyring: options.keyring,
    audit: options.api?.audit ?? createAuditLogger(),
    mailer: options.api?.mailer ?? createMailer({ smtpUrl: undefined, from: 'OpenVerify' }),
    clock: options.api?.clock ?? systemClock,
    ids: options.api?.ids ?? ulidIdGenerator,
    dashboardPublicUrl: options.dashboardPublicUrl,
    otpSmsMaxPerHourCeiling:
      options.api?.otpSmsMaxPerHourCeiling ?? OTP_SMS_MAX_PER_HOUR.ceilingDefault,
    // C251.2 (Workflow 11B Stage 1b (P)): the queue caps' install ceiling (`quotas` applies it).
    queueInFlightCapMax: options.api?.queueInFlightCapMax ?? QUEUE_IN_FLIGHT_CAP.ceilingDefault,
    nfc: options.api?.nfc ?? { allowIcaoCrls: false, trustAnchorRefresh: false },
    events: options.api?.events,
    // C174.4 (Workflow 9B Stage 1b (U)): the route policies these routes count (`invitations-resend`).
    rateLimiter: options.api?.rateLimiter,
  };

  if (options.syncBuiltinRolesOnReady === true) {
    // A failure is logged, not fatal: the roles already stored keep working, and the next
    // start syncs again. Refusing to start would turn a brief database outage into downtime.
    app.addHook('onReady', async () => {
      try {
        await syncAllOrganizationRoles(context.db, context.ids);
      } catch (error) {
        app.log.error({ err: error }, 'syncing the built-in roles failed');
      }
    });
  }

  await app.register(invitationRoutes, context);
  await app.register(async (authenticated) => {
    authenticated.addHook('onRequest', authenticateOperator(context.operatorAuth));
    await authenticated.register(environmentRoutes, context);
    await authenticated.register(mfaFactorRoutes, context);
    await authenticated.register(userRoutes, context);
    // C168.1 (Workflow 9B Stage 1b (U)): the resend needs a session, unlike the acceptance.
    await authenticated.register(invitationResendRoutes, context);
    await authenticated.register(roleRoutes, context);
    await authenticated.register(auditLogRoutes, context);
    await authenticated.register(settingsRoutes, context);
    // C62.10 (Workflow 5B Stage 1): the trust-store view, built by api-nfc.
    await authenticated.register(trustAnchorRoutes, context);
    // C72.3 (Phase 6, Workflow 6A Stage 1b): the console reports (api-reports) and the
    // watchlist sources page (api-watchlists).
    await authenticated.register(dashboardReportRoutes, context);
    await authenticated.register(watchlistSourceRoutes, context);
    // C254.1 (Workflow 11B Stage 1b (D)): the UN list's opt-in, built by ingestion-11b; Q10's grant
    // (Workflow 11G, records-11g) hands it the install switch.
    await authenticated.register(watchlistOptInRoutes, {
      ...context,
      watchlistUnOptInAllowed: options.watchlistUnOptInAllowed,
    });
    // C108, C92 (Workflow 7A): the install-wide network sources page.
    await authenticated.register(networkSourceRoutes, context);
    // C173.3 (Workflow 9B Stage 1b (C)): the print button's audit, frozen for api-cases-reports.
    await authenticated.register(printAuditRoutes, context);
    // C248.3 (Workflow 11B Stage 1b (A)): the SSO providers, frozen for sso-oidc.
    await authenticated.register(ssoProviderRoutes, { ...context, sso: options.sso });
    // C245.3 (Workflow 11B Stage 1b (A)): ending one user's sessions, frozen for auth-sessions.
    await authenticated.register(endSessionsRoutes, context);
  });
};
