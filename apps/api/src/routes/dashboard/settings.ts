import { dashboardSettingsSchema, dashboardUpdateSettingsBodySchema } from '@openverify/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { problemResponses } from '../../plugins/openapi.js';
import { getDashboardSettings, updateDashboardSettings } from '../../services/settings.js';
import { operatorChange, type AdminRouteContext } from './admin-context.js';
import { DASHBOARD_TAG, USER_SESSION_SECURITY } from './openapi.js';

/**
 * C15 and C16 settings: the organization's `require-mfa` and the session environment's
 * retention windows (`settings:read`, `settings:write`).
 */
export const settingsRoutes: FastifyPluginAsyncZod<AdminRouteContext> = (app, context) => {
  app.get(
    '/settings',
    {
      config: { scopes: ['settings:read'] },
      schema: {
        summary: 'Get the settings',
        description:
          "The organization's `require-mfa`, the environment's retention windows in days " +
          '(`inquiry-retention-days` null keeps finished inquiries forever), the face template ' +
          'settings, the OTP text budget per hour (`otp-sms-max-per-hour`, C55.7), ' +
          'read-only, when that budget last tripped (`otp-sms-budget-tripped-at`), and the signal ' +
          'settings: `signal-collection`, `expose-signals` and the collector component, address ' +
          'and device windows (C90.8, C91.7).',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        response: { 200: dashboardSettingsSchema, ...problemResponses(401, 403, 404) },
      },
    },
    (request) =>
      getDashboardSettings(
        context.db,
        operatorChange(request, context).ctx,
        context.otpSmsMaxPerHourCeiling,
        // C251.2 (Workflow 11B, quotas' borrowed edit): stored caps served at most the ceiling.
        context.queueInFlightCapMax,
      ),
  );

  app.patch(
    '/settings',
    {
      config: { scopes: ['settings:write'] },
      schema: {
        summary: 'Change the settings',
        description:
          'Sets any of the settings; the others keep their values. Every change is audited. ' +
          '`otp-sms-max-per-hour` above the install ceiling ' +
          '(`OPENVERIFY_OTP_SMS_MAX_PER_HOUR_CEILING`) answers 422. `signal-collection` (C90.8) ' +
          'also needs `settings:privacy` (403 without it), and `exempt` device recognition needs ' +
          'its basis (422 `basis_required`).',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        body: dashboardUpdateSettingsBodySchema,
        response: { 200: dashboardSettingsSchema, ...problemResponses(400, 401, 403, 404, 422) },
      },
    },
    (request) => {
      const change = operatorChange(request, context);
      return updateDashboardSettings(
        context.db,
        context.audit,
        change.ctx,
        change.actor,
        request.body,
        context.otpSmsMaxPerHourCeiling,
        change.permissions,
        context.events,
        // C251.2 (Workflow 11B, quotas' borrowed edit): no cap above the install ceiling.
        context.queueInFlightCapMax,
      );
    },
  );
  return Promise.resolve();
};
