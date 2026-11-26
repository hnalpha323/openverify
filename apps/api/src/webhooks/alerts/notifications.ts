/**
 * C169.7 (Workflow 9B; plan outcome 20): each notification is read under its own kind's rule. A case
 * kind needs `cases:read` and its case's visibility (`services/cases/notifications.ts`); a
 * `webhook-failure` row is read here: `webhooks:read` in its environment.
 *
 * The hook site is `services/cases/notifications.ts`, which `foundation-9b` (W) placed: the list and
 * the read hand this the page's rows about a webhook, and keep, in their order, only the rows this
 * answers. The session's permissions are its environment's (C167.2, `api-access`), and the rows are
 * read in that environment, so a row of another environment is never kept, nor one naming no webhook
 * (fail closed). The webhook itself may have been archived; the alert is still the user's to read, and
 * a deleted webhook takes its notifications with it (the foreign key cascades).
 *
 * Owner: `api-keys-webhooks`.
 */
import type { Db } from '@openverify/db';
import type { UserPrincipal } from '../../ports.js';

/** What the rule reads of a row about a webhook. */
export interface WebhookNotificationRow {
  webhookId: string | null;
  environmentId: string;
}

export type ReadableWebhookNotifications = <Row extends WebhookNotificationRow>(
  db: Db,
  user: UserPrincipal,
  rows: readonly Row[],
) => Promise<Row[]>;

export const readableWebhookNotifications: ReadableWebhookNotifications = (_db, user, rows) =>
  Promise.resolve(
    user.permissions.has('webhooks:read')
      ? rows.filter((row) => row.webhookId !== null && row.environmentId === user.environmentId)
      : [],
  );
