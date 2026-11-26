/**
 * C134.4 (Workflow 8B): a user's own case notifications, `GET /api/v1/dashboard/notifications` and
 * `POST /api/v1/dashboard/notifications/:id/read`, on the dashboard API behind the operator's session
 * (an API key has no notifications). The schemas and scope are frozen (Stage 1b (C),
 * `foundation-8b`); `api-cases` owns this file and builds the handlers
 * (`services/cases/notifications.ts`), which answer 501 until then. A notification of a case the user
 * can no longer see is left out there, through `filterCaseVisibility` (C129.4, V08).
 */
import {
  idSchema,
  listUserNotificationsQuerySchema,
  readUserNotificationBodySchema,
  userNotificationDocumentSchema,
  userNotificationListDocumentSchema,
} from '@openverify/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import { listUserNotifications, readUserNotification } from '../../services/cases/notifications.js';
import { operatorPrincipal, requireOperator } from './authenticate.js';
import type { DashboardContext } from './context.js';
import { DASHBOARD_TAG, USER_SESSION_SECURITY } from './openapi.js';

/**
 * C134.4 notification routes, under `/api/v1/dashboard`. C169.7 (Workflow 9B Stage 1b (W); plan
 * outcome 20): each row is read under its kind's rule in the service, so the routes take a session
 * holding `cases:read` or `webhooks:read` (403 for neither) rather than `cases:read` alone.
 */
export const notificationRoutes: FastifyPluginAsyncZod<DashboardContext> = (app, { db }) => {
  app.get(
    '/notifications',
    {
      schema: {
        summary: 'List my notifications',
        description:
          'C134.4, C169.7: assigned, SLA breached and mentioned (with `cases:read`, a case the user ' +
          'can see) and webhook failures (with `webhooks:read`), newest first; `filter[unread]` ' +
          'keeps the unread. A kind and its subject, never a comment’s text. Kept 90 days. A user ' +
          'holding neither permission is refused (403).',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        querystring: listUserNotificationsQuerySchema,
        response: {
          200: userNotificationListDocumentSchema,
          ...problemResponses(400, 401, 403),
        },
      },
    },
    (request) =>
      listUserNotifications(db, operatorPrincipal(requireOperator(request)), request.query),
  );

  app.post(
    '/notifications/:id/read',
    {
      schema: {
        summary: 'Mark a notification read',
        description:
          'C134.4, C169.7: the user’s own, read under its kind’s rule; another user’s, or one the ' +
          'rule does not let the user read, answers 404.',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        params: z.object({ id: idSchema('unot') }),
        body: readUserNotificationBodySchema,
        response: {
          200: userNotificationDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    (request) =>
      readUserNotification(
        db,
        operatorPrincipal(requireOperator(request)),
        request.params.id,
        request.body,
      ),
  );

  return Promise.resolve();
};
