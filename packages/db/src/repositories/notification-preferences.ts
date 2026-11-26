/**
 * C169.7 (Workflow 9B Stage 1b (W)): a user's notification preferences, per kind of
 * `USER_NOTIFICATION_KINDS`, `{ console, email }`, the caller's own and the same in every environment of
 * its organisation (the resource's id is the user's). A kind with no row has
 * `NOTIFICATION_PREFERENCE_DEFAULT` (console on, email off). `foundation-9b` declared the table and
 * these reads and writes; `api-keys-webhooks` owns the file and the routes that use it.
 */
import { USER_NOTIFICATION_KINDS, type UserNotificationKind } from '@openverify/core';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { notificationPreferences } from '../tables/notification-preferences.js';

/** One kind's channels as stored. */
export interface NotificationPreferenceRecord {
  kind: UserNotificationKind;
  console: boolean;
  email: boolean;
  updatedAt: Date;
}

/** The channels `PUT /dashboard/notification-preferences` sets for the kinds it names. */
export type NotificationPreferenceChanges = Partial<
  Record<UserNotificationKind, { console: boolean; email: boolean }>
>;

/** The user's stored kinds, in `USER_NOTIFICATION_KINDS` order; a kind left out has the default. */
export async function listNotificationPreferences(
  db: Db,
  userId: string,
): Promise<NotificationPreferenceRecord[]> {
  const rows = await db
    .select({
      kind: notificationPreferences.kind,
      console: notificationPreferences.console,
      email: notificationPreferences.email,
      updatedAt: notificationPreferences.updatedAt,
    })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId));
  const order = (kind: UserNotificationKind) => USER_NOTIFICATION_KINDS.indexOf(kind);
  return rows.sort((left, right) => order(left.kind) - order(right.kind));
}

/** Sets the kinds `changes` names, at `at`, and keeps every other kind as it was. */
export async function setNotificationPreferences(
  tx: Db,
  userId: string,
  changes: NotificationPreferenceChanges,
  at: Date,
): Promise<void> {
  const rows = USER_NOTIFICATION_KINDS.flatMap((kind) => {
    const channels = changes[kind];
    return channels === undefined
      ? []
      : [{ userId, kind, console: channels.console, email: channels.email, updatedAt: at }];
  });
  if (rows.length === 0) {
    return;
  }
  await tx
    .insert(notificationPreferences)
    .values(rows)
    .onConflictDoUpdate({
      target: [notificationPreferences.userId, notificationPreferences.kind],
      set: {
        console: sql`excluded.console`,
        email: sql`excluded.email`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
}
