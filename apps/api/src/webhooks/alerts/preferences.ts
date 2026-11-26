/**
 * C169.7 (Workflow 9B): `GET` and `PUT /api/v1/dashboard/notification-preferences`, the caller's own:
 * per kind of `USER_NOTIFICATION_KINDS`, `{ console, email }` (defaults
 * `NOTIFICATION_PREFERENCE_DEFAULT`: console on, email off); `PUT` sets the kinds it names and keeps
 * the others (contracts B32). The rows are `notification_preferences`, read and written through
 * `listNotificationPreferences` and `setNotificationPreferences` (`@openverify/db`), per user and the
 * same in every environment of its organisation (plan W5).
 *
 * The `webhook-failure-alerts` sweep reads them (`jobs/repeatable/webhook-alerts.ts`), and so do
 * Phase 8's case notifications and their emails (K9-26, Workflow 9D:
 * `services/cases/notification-channels.ts`). A preference names no value, so the change is not
 * audited.
 *
 * Owner: `api-keys-webhooks`.
 */
import type {
  notificationPreferencesDocumentSchema,
  updateNotificationPreferencesBodySchema,
} from '@openverify/contracts';
import {
  NOTIFICATION_PREFERENCE_DEFAULT,
  USER_NOTIFICATION_KINDS,
  type NotificationPreference,
  type UserNotificationKind,
} from '@openverify/core';
import {
  listNotificationPreferences,
  setNotificationPreferences,
  type Db,
  type NotificationPreferenceChanges,
} from '@openverify/db';
import type { z } from 'zod';
import type { UserPrincipal } from '../../ports.js';

export type NotificationPreferencesDocument = z.infer<typeof notificationPreferencesDocumentSchema>;
export type UpdateNotificationPreferencesBody = z.infer<
  typeof updateNotificationPreferencesBodySchema
>;

export type GetNotificationPreferences = (
  db: Db,
  user: UserPrincipal,
) => Promise<NotificationPreferencesDocument>;

export type UpdateNotificationPreferences = (
  db: Db,
  user: UserPrincipal,
  body: UpdateNotificationPreferencesBody,
) => Promise<NotificationPreferencesDocument>;

/** Every kind's channels for `userId`: the stored ones, the default for a kind with none. */
export async function notificationPreferencesOf(
  db: Db,
  userId: string,
): Promise<Record<UserNotificationKind, NotificationPreference>> {
  const stored = new Map(
    (await listNotificationPreferences(db, userId)).map((row) => [row.kind, row]),
  );
  return Object.fromEntries(
    USER_NOTIFICATION_KINDS.map((kind) => {
      const row = stored.get(kind);
      return [
        kind,
        row === undefined
          ? { ...NOTIFICATION_PREFERENCE_DEFAULT }
          : { console: row.console, email: row.email },
      ];
    }),
  ) as Record<UserNotificationKind, NotificationPreference>;
}

export const getNotificationPreferences: GetNotificationPreferences = async (db, user) => ({
  data: {
    type: 'notification-preferences',
    id: user.userId,
    attributes: { preferences: await notificationPreferencesOf(db, user.userId) },
  },
});

export const updateNotificationPreferences: UpdateNotificationPreferences = async (
  db,
  user,
  body,
) => {
  const named = body.data.attributes.preferences as Partial<
    Record<UserNotificationKind, NotificationPreference | undefined>
  >;
  const changes: NotificationPreferenceChanges = Object.fromEntries(
    USER_NOTIFICATION_KINDS.flatMap((kind) => {
      const channels = named[kind];
      return channels === undefined
        ? []
        : [[kind, { console: channels.console, email: channels.email }]];
    }),
  );
  // The dashboard routes carry no clock (as Phase 8's notification read); updated_at is not served.
  await db.transaction((tx) => setNotificationPreferences(tx, user.userId, changes, new Date()));
  return getNotificationPreferences(db, user);
};
