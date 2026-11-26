/**
 * C169.7 (Phase 9, Workflow 9B Stage 1b (W)): a user's notification preferences, one row per kind of
 * `USER_NOTIFICATION_KINDS` the user changed, `{ console, email }`. A kind with no row has
 * `NOTIFICATION_PREFERENCE_DEFAULT` (console on, email off). The preferences are the user's own and the
 * same in every environment of its organisation (the resource's id is the user's), and go with the user.
 * Booleans and a kind only: nothing here is personal data beyond the user's id.
 */
import { USER_NOTIFICATION_KINDS, type UserNotificationKind } from '@openverify/core';
import { boolean, check, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import { oneOf, updatedAt } from './columns.js';
import { users } from './users.js';

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<UserNotificationKind>().notNull(),
    console: boolean('console').notNull(),
    email: boolean('email').notNull(),
    /** Set by the repository on every change (no trigger: the row is only ever upserted). */
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ name: 'notification_preferences_pkey', columns: [table.userId, table.kind] }),
    check('notification_preferences_kind_valid', oneOf(table.kind, USER_NOTIFICATION_KINDS)),
  ],
);

export type NotificationPreferenceRow = typeof notificationPreferences.$inferSelect;
