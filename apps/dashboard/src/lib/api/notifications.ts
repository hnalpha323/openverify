/**
 * The operator's case notifications (C134.4, C142.1), on the dashboard API behind the session:
 * assigned, SLA breached and mentioned, each naming a kind and a case and nothing of its content (no
 * comment text, no field). An API key has none. Failures are `@openverify/node` errors, which
 * `renderPage` maps.
 */
import 'server-only';
import {
  notificationPreferencesDocumentSchema,
  userNotificationListDocumentSchema,
} from '@openverify/contracts';
import type { UserNotificationKind } from '@openverify/core';
import { apiRequest } from './client';

export const NOTIFICATIONS_PAGE_SIZE = 25;

/** `GET /dashboard/notifications`: one page, newest first; `unread` keeps the unread. */
export function listNotifications(options: {
  readonly unread: boolean;
  readonly after?: string | undefined;
}) {
  return apiRequest({
    method: 'GET',
    path: '/dashboard/notifications',
    query: {
      'filter[unread]': options.unread ? 'true' : undefined,
      'page[after]': options.after,
      'page[size]': String(NOTIFICATIONS_PAGE_SIZE),
    },
    schema: userNotificationListDocumentSchema,
  });
}

/** Per notification kind, the console and email channels (C169.7). */
export type NotificationPreferences = Readonly<
  Record<UserNotificationKind, { readonly console: boolean; readonly email: boolean }>
>;

const PREFERENCES_PATH = '/dashboard/notification-preferences';

/** `GET /dashboard/notification-preferences`: the caller's own, the API's defaults filled in. */
export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  const { data } = await apiRequest({
    method: 'GET',
    path: PREFERENCES_PATH,
    schema: notificationPreferencesDocumentSchema,
  });
  return data.attributes.preferences as NotificationPreferences;
}

/** `PUT /dashboard/notification-preferences`: sets the kinds named; answers every kind. */
export async function updateNotificationPreferences(
  changes: Partial<NotificationPreferences>,
): Promise<NotificationPreferences> {
  const { data } = await apiRequest({
    method: 'PUT',
    path: PREFERENCES_PATH,
    body: { data: { type: 'notification-preferences', attributes: { preferences: changes } } },
    schema: notificationPreferencesDocumentSchema,
  });
  return data.attributes.preferences as NotificationPreferences;
}
