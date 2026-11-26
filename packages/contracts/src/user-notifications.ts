/**
 * A person's case notifications (plan C134.4): assigned, SLA breached, mentioned. A row names a kind
 * and a case and holds no comment text or field. It is console-only (C145 defers `user-notification.*`
 * events), served to the user it is for, and kept 90 days.
 *
 * Routes (frozen by `foundation-8b`, built by `api-cases`): `GET /api/v1/dashboard/notifications` and
 * `POST /api/v1/dashboard/notifications/:id/read`. A notification of a case the user can no longer
 * see is left out (C129.4).
 */
import {
  NOTIFICATION_KIND_SUBJECT,
  USER_NOTIFICATION_KINDS,
  type NotificationSubjectType,
  type UserNotificationKind,
} from '@openverify/core';
import { z } from 'zod';
import { emptyActionBodySchema } from './actions.js';
import { caseIdentifierSchema } from './identifiers.js';
import { idSchema } from './ids.js';
import {
  listDocumentSchema,
  requestDocumentSchema,
  resourceWithRelationshipsSchema,
  singleDocumentSchema,
  timestampSchema,
  toNullableTimestamp,
  toOneRelationshipSchema,
  toTimestamp,
} from './json-api.js';
import { booleanFilterSchema, listQuerySchema } from './list-filters.js';

/**
 * C169.7 (Workflow 9B; review F18): a case kind names its case and `webhook-failure` its webhook, as
 * its relationship and its `subject-type`; the two always agree with `NOTIFICATION_KIND_SUBJECT`.
 */
export const userNotificationResourceSchema = resourceWithRelationshipsSchema(
  'user-notification',
  'unot',
  z.strictObject({
    kind: z.enum(USER_NOTIFICATION_KINDS),
    /** Left out by servers before Workflow 9B, which serve case kinds only. */
    'subject-type': z.enum(['case', 'webhook']).optional(),
    'read-at': timestampSchema.nullable(),
    'created-at': timestampSchema,
  }),
  z.strictObject({
    case: toOneRelationshipSchema(caseIdentifierSchema).optional(),
    webhook: toOneRelationshipSchema(
      z.strictObject({ type: z.literal('webhook'), id: idSchema('wbh') }),
    ).optional(),
  }),
).refine(
  (resource) => {
    const subject = NOTIFICATION_KIND_SUBJECT[resource.attributes.kind];
    const named = Object.keys(resource.relationships);
    return (
      named.length === 1 &&
      named[0] === subject &&
      (resource.attributes['subject-type'] ?? 'case') === subject
    );
  },
  { message: 'a notification names exactly the subject its kind has', path: ['relationships'] },
);
export type UserNotificationResource = z.infer<typeof userNotificationResourceSchema>;
export const userNotificationDocumentSchema = singleDocumentSchema(userNotificationResourceSchema);
export type UserNotificationDocument = z.infer<typeof userNotificationDocumentSchema>;
export const userNotificationListDocumentSchema = listDocumentSchema(
  userNotificationResourceSchema,
);
export type UserNotificationListDocument = z.infer<typeof userNotificationListDocumentSchema>;

/** `GET /api/v1/dashboard/notifications`: newest first; `filter[unread]` keeps the unread. */
export const listUserNotificationsQuerySchema = listQuerySchema('unot', {
  'filter[unread]': booleanFilterSchema.optional(),
});

export const readUserNotificationBodySchema = emptyActionBodySchema;

export interface UserNotificationRecord {
  id: string;
  kind: UserNotificationKind;
  /** A case kind's case (Phase 8's rows); `null` for a webhook failure. */
  caseId: string | null;
  /** C169.7: the subject; left out for a case kind, read from `caseId`. */
  subjectType?: NotificationSubjectType;
  subjectId?: string;
  readAt: Date | null;
  createdAt: Date;
}

/** @throws {z.ZodError} when the record does not satisfy the contract. */
export function buildUserNotificationResource(
  record: UserNotificationRecord,
): UserNotificationResource {
  const subjectType = record.subjectType ?? 'case';
  const subjectId = record.subjectId ?? record.caseId;
  return userNotificationResourceSchema.parse({
    type: 'user-notification',
    id: record.id,
    attributes: {
      kind: record.kind,
      'subject-type': subjectType,
      'read-at': toNullableTimestamp(record.readAt),
      'created-at': toTimestamp(record.createdAt),
    },
    relationships: { [subjectType]: { data: { type: subjectType, id: subjectId } } },
  });
}

/**
 * C169.7 (Workflow 9B): `GET`, `PUT /api/v1/dashboard/notification-preferences`, the caller's own:
 * per kind, the console and email channels. `PUT` sets the kinds it names; the others keep theirs.
 */
export const notificationPreferenceSchema = z.strictObject({
  console: z.boolean(),
  email: z.boolean(),
});
const preferencesByKind = (member: z.ZodType) =>
  z.strictObject(
    Object.fromEntries(USER_NOTIFICATION_KINDS.map((kind) => [kind, member])) as Record<
      UserNotificationKind,
      z.ZodType
    >,
  );
export const notificationPreferencesDocumentSchema = singleDocumentSchema(
  z.strictObject({
    type: z.literal('notification-preferences'),
    id: idSchema('usr'),
    attributes: z.strictObject({ preferences: preferencesByKind(notificationPreferenceSchema) }),
  }),
);
export const updateNotificationPreferencesBodySchema = requestDocumentSchema(
  'notification-preferences',
  z.strictObject({
    preferences: preferencesByKind(notificationPreferenceSchema.optional()).refine(
      (preferences) => Object.keys(preferences).length > 0,
      'names at least one kind',
    ),
  }),
);
