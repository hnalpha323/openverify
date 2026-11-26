/**
 * C134.4 (Workflow 8B, `api-cases`): what `routes/dashboard/notifications.ts` calls: a user's own
 * notifications, newest first (C1), a kind and its subject and never text. A notification of a case
 * the user can no longer see is left out (C129.4, `filterCaseVisibility`), so a page can come back
 * short while `links.next` moves on. Another user's notification is not found.
 *
 * C169.7 (Workflow 9B Stage 1b (W); plan outcome 20): each row is read under its own kind's rule. A
 * case kind needs `cases:read` and its case's visibility, as Phase 8 built it; a `webhook-failure` row
 * is `readableWebhookNotifications`' (`webhooks:read` in its environment, `api-keys-webhooks`). A
 * session holding neither permission is refused, as the route refused one without `cases:read`.
 */
import {
  buildUserNotificationResource,
  type listUserNotificationsQuerySchema,
  type readUserNotificationBodySchema,
  type UserNotificationDocument,
  type UserNotificationListDocument,
} from '@openverify/contracts';
import { NOTIFICATION_KIND_SUBJECT } from '@openverify/core';
import {
  getUserNotificationRow,
  listUserNotificationRows,
  markUserNotificationRead,
  type Db,
  type UserNotificationRow,
} from '@openverify/db';
import type { z } from 'zod';
import { NotFoundError, PermissionDeniedError } from '../../errors.js';
import type { UserPrincipal } from '../../ports.js';
import { readableWebhookNotifications } from '../../webhooks/alerts/notifications.js';
import { nextLink, pageRequest, withCursor } from '../pagination.js';
import { filterCaseVisibility } from './visibility.js';

const PATH = '/api/v1/dashboard/notifications';

/** The permissions a kind's rule starts from: a reader must hold at least one (C169.7). */
const READING_PERMISSIONS = ['cases:read', 'webhooks:read'] as const;

/** @throws {PermissionDeniedError} 403 when the user holds no permission any kind is read with. */
function assertMayRead(user: UserPrincipal): void {
  if (!READING_PERMISSIONS.some((permission) => user.permissions.has(permission))) {
    throw new PermissionDeniedError(
      'The user is missing the required permission: cases:read or webhooks:read.',
      [...READING_PERMISSIONS],
    );
  }
}

/** The rows about a case; a row whose case is gone from it (none is) is left out (fail closed). */
const aboutCases = (rows: readonly UserNotificationRow[]) =>
  rows.filter(
    (row): row is UserNotificationRow & { caseId: string } =>
      NOTIFICATION_KIND_SUBJECT[row.kind] === 'case' && row.caseId !== null,
  );

const aboutWebhooks = (rows: readonly UserNotificationRow[]) =>
  rows.filter((row) => NOTIFICATION_KIND_SUBJECT[row.kind] === 'webhook');

/** The rows `user` may read, in their order: each under its kind's rule. */
async function readable(
  db: Db,
  user: UserPrincipal,
  rows: readonly UserNotificationRow[],
): Promise<UserNotificationRow[]> {
  const cases = user.permissions.has('cases:read')
    ? await filterCaseVisibility(
        db,
        { environmentId: user.environmentId, principal: user },
        aboutCases(rows),
        ({ caseId }) => [caseId],
      )
    : [];
  const webhookRows = aboutWebhooks(rows);
  const webhooks =
    webhookRows.length === 0 ? [] : await readableWebhookNotifications(db, user, webhookRows);
  const kept = new Set<UserNotificationRow>([...cases, ...webhooks]);
  return rows.filter((row) => kept.has(row));
}

const resourceOf = (row: UserNotificationRow) =>
  buildUserNotificationResource({
    id: row.id,
    kind: row.kind,
    caseId: row.caseId,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    readAt: row.readAt,
    createdAt: row.createdAt,
  });

/** `filter[unread]` as the route validated it: a boolean, or its text. */
const unreadOf = (value: unknown): boolean | undefined =>
  value === undefined ? undefined : value === true || value === 'true';

export async function listUserNotifications(
  db: Db,
  user: UserPrincipal,
  query: z.infer<typeof listUserNotificationsQuerySchema>,
): Promise<UserNotificationListDocument> {
  assertMayRead(user);
  const unread = unreadOf(query['filter[unread]']);
  const page = await withCursor(() =>
    listUserNotificationRows(db, user.environmentId, user.userId, { unread }, pageRequest(query)),
  );
  const visible = await readable(db, user, page.items);
  return {
    data: visible.map(resourceOf),
    links: {
      next: nextLink(
        PATH,
        { 'filter[unread]': unread === undefined ? undefined : String(unread) },
        query,
        page.next,
      ),
    },
  };
}

export const readUserNotification: (
  db: Db,
  user: UserPrincipal,
  id: string,
  body: z.infer<typeof readUserNotificationBodySchema>,
) => Promise<UserNotificationDocument> = (db, user, id) => markRead(db, user, id);

async function markRead(
  db: Db,
  user: UserPrincipal,
  id: string,
): Promise<UserNotificationDocument> {
  assertMayRead(user);
  const found = await getUserNotificationRow(db, user.environmentId, user.userId, id);
  const [visible] = found === null ? [] : await readable(db, user, [found]);
  if (visible === undefined) {
    throw new NotFoundError(`Notification ${id} was not found.`);
  }
  const read = await markUserNotificationRead(db, user.environmentId, user.userId, id, new Date());
  return { data: resourceOf(read ?? visible) };
}
