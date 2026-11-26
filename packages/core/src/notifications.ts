/**
 * C169.7 (Phase 9, Workflow 9B Stage 1a, (W); review F18): a user's notification kinds and their
 * subjects. Phase 8's case kinds keep `CASE_NOTIFICATION_KINDS` (its case services and emails read
 * that list); `user_notifications.kind`'s CHECK moves to `USER_NOTIFICATION_KINDS` with the
 * polymorphic subject (`subject_type`, `subject_id`, `case_id` nullable), a recreated CHECK with its
 * migration test (`foundation-9b` (W)).
 */
import { z } from 'zod';
import { CASE_NOTIFICATION_KINDS } from './cases/vocabulary.js';

export const USER_NOTIFICATION_KINDS = Object.freeze([
  ...CASE_NOTIFICATION_KINDS,
  'webhook-failure',
] as const);
export const userNotificationKindSchema = z.enum(USER_NOTIFICATION_KINDS);
export type UserNotificationKind = (typeof USER_NOTIFICATION_KINDS)[number];

/** What a notification is about. */
export const NOTIFICATION_SUBJECT_TYPES = Object.freeze(['case', 'webhook'] as const);
export type NotificationSubjectType = (typeof NOTIFICATION_SUBJECT_TYPES)[number];

/** Each kind's subject: one CHECK per kind in the table. */
export const NOTIFICATION_KIND_SUBJECT: Readonly<
  Record<UserNotificationKind, NotificationSubjectType>
> = Object.freeze({
  assigned: 'case',
  'sla-breached': 'case',
  mentioned: 'case',
  'webhook-failure': 'webhook',
});

/** C169.7: a kind's channels; the console on and email off unless the user chose otherwise. */
export interface NotificationPreference {
  readonly console: boolean;
  readonly email: boolean;
}
export const NOTIFICATION_PREFERENCE_DEFAULT: NotificationPreference = Object.freeze({
  console: true,
  email: false,
});
