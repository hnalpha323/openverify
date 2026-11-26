/**
 * C169.7 (Workflow 9B): `GET` and `PUT /api/v1/dashboard/notification-preferences`, the signed-in
 * user's own, per kind of `USER_NOTIFICATION_KINDS` `{ console, email }` (defaults console on, email
 * off); `PUT` sets the kinds it names and keeps the others (contracts B32). A session is all they need:
 * a user's preferences are its own, whatever it may read. Frozen by `foundation-9b` (Stage 1b (W));
 * served by `webhooks/alerts/preferences.ts` (`api-keys-webhooks`, the owner of this file). The
 * schemas, 501 included, are the frozen ones; a change is `integration-9b`'s.
 */
import {
  notificationPreferencesDocumentSchema,
  updateNotificationPreferencesBodySchema,
} from '@openverify/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { problemResponses } from '../../plugins/openapi.js';
import {
  getNotificationPreferences,
  updateNotificationPreferences,
} from '../../webhooks/alerts/preferences.js';
import { operatorPrincipal, requireOperator } from './authenticate.js';
import type { DashboardContext } from './context.js';
import { DASHBOARD_TAG, USER_SESSION_SECURITY } from './openapi.js';

/** C169.7 notification preference routes, under `/api/v1/dashboard`. */
export const notificationPreferenceRoutes: FastifyPluginAsyncZod<DashboardContext> = (
  app,
  { db },
) => {
  app.get(
    '/notification-preferences',
    {
      schema: {
        summary: 'Read my notification preferences',
        description:
          'C169.7: per notification kind, whether it reaches the console and email (defaults: the ' +
          'console on, email off).',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        response: {
          200: notificationPreferencesDocumentSchema,
          ...problemResponses(401),
        },
      },
    },
    (request) => getNotificationPreferences(db, operatorPrincipal(requireOperator(request))),
  );

  app.put(
    '/notification-preferences',
    {
      schema: {
        summary: 'Set my notification preferences',
        description:
          'C169.7: sets the console and email channels of the kinds the body names (at least one); ' +
          'every other kind keeps its own.',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        body: updateNotificationPreferencesBodySchema,
        response: {
          200: notificationPreferencesDocumentSchema,
          ...problemResponses(400, 401),
        },
      },
    },
    (request) =>
      updateNotificationPreferences(db, operatorPrincipal(requireOperator(request)), request.body),
  );

  return Promise.resolve();
};
