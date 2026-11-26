/**
 * C169.6, C169.7 (Workflow 9B Stage 1b (W)): what a webhook failure alert writes. A `webhook-failure`
 * notification names its webhook (`user_notifications.webhook_id`, so its `subject_type` is
 * `webhook`), never a case; Phase 8's `createUserNotifications` stays the case kinds'. `foundation-9b`
 * declared these; `api-keys-webhooks` owns the file and adds the sweep's reads and the
 * `webhook_alert_emails` outbox's claim and delete beside them.
 */
import { and, asc, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { userNotifications, type UserNotificationRow } from '../tables/cases.js';
import { notificationPreferences } from '../tables/notification-preferences.js';
import { environments } from '../tables/tenancy.js';
import { roles, userRoles, users } from '../tables/users.js';
import { webhookAlertEmails, webhookDeliveries, webhooks } from '../tables/webhooks.js';
import { roleAssignmentReaches } from './roles.js';

export interface NewWebhookFailureNotification {
  id: string;
  userId: string;
  webhookId: string;
}

/** Writes one `webhook-failure` notification per row, in the caller's transaction. */
export async function createWebhookFailureNotifications(
  tx: Db,
  environmentId: string,
  rows: readonly NewWebhookFailureNotification[],
): Promise<UserNotificationRow[]> {
  if (rows.length === 0) {
    return [];
  }
  return tx
    .insert(userNotifications)
    .values(
      rows.map(({ id, userId, webhookId }) => ({
        id,
        environmentId,
        userId,
        kind: 'webhook-failure' as const,
        webhookId,
      })),
    )
    .returning();
}

// C169.6 (Workflow 9B, `api-keys-webhooks`): the sweep's reads and the outbox. Stubs until built.

/** Sends of one alert email tried at most, as Phase 8's case emails. */
export const WEBHOOK_ALERT_EMAIL_ATTEMPTS = 3;

/** A webhook whose failure alert is on and may fire now. */
export interface WebhookFailureAlertCandidate {
  environmentId: string;
  webhookId: string;
  threshold: number;
  windowMinutes: number;
}

/** A user the alert reaches, with the channels chosen for `webhook-failure`. */
export interface WebhookAlertRecipient {
  userId: string;
  console: boolean;
  email: boolean;
}

/** An alert email owed, as the outbox holds it: ids only. */
export interface WebhookAlertEmail {
  id: number;
  environmentId: string;
  userId: string;
  webhookId: string;
  attempts: number;
}

const KIND = 'webhook-failure';

/** The window a candidate's last alert must be older than, at `now`. */
const windowStart = (now: Date) =>
  sql`${now.toISOString()}::timestamptz - make_interval(mins => ${webhooks.failureAlertWindowMinutes})`;

/**
 * Enabled webhooks whose failure alert is on and was not sent within its window at `now`, in id order
 * after `after`, at most `limit` (the partial index `webhooks_failure_alert_enabled_idx`).
 */
export async function listWebhookFailureAlertCandidates(
  db: Db,
  options: { now: Date; after?: string | undefined; limit: number },
): Promise<WebhookFailureAlertCandidate[]> {
  const rows = await db
    .select({
      environmentId: webhooks.environmentId,
      webhookId: webhooks.id,
      threshold: webhooks.failureAlertThreshold,
      windowMinutes: webhooks.failureAlertWindowMinutes,
    })
    .from(webhooks)
    .where(
      and(
        eq(webhooks.failureAlertEnabled, true),
        eq(webhooks.status, 'enabled'),
        or(
          isNull(webhooks.failureAlertNotifiedAt),
          lte(webhooks.failureAlertNotifiedAt, windowStart(options.now)),
        ),
        options.after === undefined ? undefined : gt(webhooks.id, options.after),
      ),
    )
    .orderBy(asc(webhooks.id))
    .limit(options.limit);
  return rows.flatMap(({ threshold, windowMinutes, ...row }) =>
    threshold === null || windowMinutes === null ? [] : [{ ...row, threshold, windowMinutes }],
  );
}

/**
 * C169.10: the deliveries of a webhook whose first attempt was made in `(from, to]` and failed (no
 * answer, or one outside 2xx). Retries are never counted. `createdFrom` bounds the scan by the
 * delivery's creation, so the environment-webhook-creation index serves it.
 */
export async function countFailedFirstAttempts(
  db: Db,
  environmentId: string,
  webhookId: string,
  window: { from: Date; to: Date; createdFrom: Date },
): Promise<number> {
  const firstStatus = sql`(${webhookDeliveries.attempts} -> 0 ->> 'response_status')::integer`;
  const [row] = await db
    .select({ count: sql<number>`count(*)::integer` })
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.environmentId, environmentId),
        eq(webhookDeliveries.webhookId, webhookId),
        gte(webhookDeliveries.createdAt, window.createdFrom),
        gt(webhookDeliveries.firstAttemptedAt, window.from),
        lte(webhookDeliveries.firstAttemptedAt, window.to),
        sql`coalesce(${firstStatus} not between 200 and 299, true)`,
      ),
    );
  return row?.count ?? 0;
}

/**
 * C169.6: claims the alert of a webhook at `now`, at most once per window: `true` when its alert is on,
 * the webhook enabled, and no alert was sent within the window; the claim sets
 * `failure_alert_notified_at`. One conditional update, so two passes never both claim.
 */
export async function markWebhookFailureAlertedInTx(
  tx: Db,
  environmentId: string,
  webhookId: string,
  now: Date,
): Promise<boolean> {
  const rows = await tx
    .update(webhooks)
    .set({ failureAlertNotifiedAt: now })
    .where(
      and(
        eq(webhooks.environmentId, environmentId),
        eq(webhooks.id, webhookId),
        eq(webhooks.failureAlertEnabled, true),
        eq(webhooks.status, 'enabled'),
        or(
          isNull(webhooks.failureAlertNotifiedAt),
          lte(webhooks.failureAlertNotifiedAt, windowStart(now)),
        ),
      ),
    )
    .returning({ id: webhooks.id });
  return rows.length > 0;
}

/** Holds `webhooks:read` through a role that reaches `environmentId` (C167.2). */
const readsWebhooks = (environmentId: string) =>
  sql`exists (select 1 from ${userRoles} ur join ${roles} r on r.id = ur.role_id
    where ur.user_id = ${users.id} and 'webhooks:read' = any(r.permissions)
      and ${roleAssignmentReaches(sql`ur`, environmentId)})`;

/**
 * C169.6: the active users of the environment's organisation who hold `webhooks:read` in it, each with
 * the `webhook-failure` channels they chose (`NOTIFICATION_PREFERENCE_DEFAULT` when none), in id order.
 */
export async function listWebhookAlertRecipients(
  db: Db,
  environmentId: string,
): Promise<WebhookAlertRecipient[]> {
  return db
    .select({
      userId: users.id,
      console: sql<boolean>`coalesce(${notificationPreferences.console}, true)`,
      email: sql<boolean>`coalesce(${notificationPreferences.email}, false)`,
    })
    .from(users)
    .innerJoin(
      environments,
      and(
        eq(environments.id, environmentId),
        eq(environments.organizationId, users.organizationId),
      ),
    )
    .leftJoin(
      notificationPreferences,
      and(eq(notificationPreferences.userId, users.id), eq(notificationPreferences.kind, KIND)),
    )
    .where(and(eq(users.status, 'active'), readsWebhooks(environmentId)))
    .orderBy(asc(users.id));
}

/** C169.6 (outcome 21): one alert email per row, in the caller's transaction; ids only. */
export async function queueWebhookAlertEmails(
  tx: Db,
  environmentId: string,
  rows: readonly { userId: string; webhookId: string }[],
): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }
  const queued = await tx
    .insert(webhookAlertEmails)
    .values(rows.map(({ userId, webhookId }) => ({ environmentId, userId, webhookId })))
    .returning({ id: webhookAlertEmails.id });
  return queued.length;
}

/**
 * Takes up to `limit` alert emails no one holds (never claimed, or claimed before `now - leaseMs`) with
 * attempts left, `FOR UPDATE SKIP LOCKED`, in the order they were written, and counts this attempt on
 * each. An email whose last attempt's lease lapsed (its worker stopped) is deleted. As Phase 8's
 * `claimCaseNotificationEmails`.
 */
export async function claimWebhookAlertEmails(
  tx: Db,
  options: { now: Date; leaseMs: number; limit: number },
): Promise<WebhookAlertEmail[]> {
  const lapsed = new Date(options.now.getTime() - options.leaseMs);
  const held = webhookAlertEmails;
  await tx
    .delete(held)
    .where(and(gte(held.attempts, WEBHOOK_ALERT_EMAIL_ATTEMPTS), lt(held.claimedAt, lapsed)));
  const due = await tx
    .select({ id: held.id })
    .from(held)
    .where(
      and(
        lt(held.attempts, WEBHOOK_ALERT_EMAIL_ATTEMPTS),
        or(isNull(held.claimedAt), lt(held.claimedAt, lapsed)),
      ),
    )
    .orderBy(asc(held.id))
    .limit(options.limit)
    .for('update', { skipLocked: true });
  if (due.length === 0) {
    return [];
  }
  const claimed = await tx
    .update(held)
    .set({ attempts: sql`${held.attempts} + 1`, claimedAt: options.now })
    .where(
      inArray(
        held.id,
        due.map(({ id }) => id),
      ),
    )
    .returning();
  return claimed
    .sort((left, right) => left.id - right.id)
    .map(({ id, environmentId, userId, webhookId, attempts }) => ({
      id,
      environmentId,
      userId,
      webhookId,
      attempts,
    }));
}

/** Forgets the alert emails sent, skipped or out of attempts. */
export async function deleteWebhookAlertEmails(db: Db, ids: readonly number[]): Promise<void> {
  if (ids.length > 0) {
    await db.delete(webhookAlertEmails).where(inArray(webhookAlertEmails.id, [...ids]));
  }
}

/**
 * The address to send an alert email to, read at send: the user's when still active, holding
 * `webhooks:read` in the environment and having chosen email for `webhook-failure`; `null` otherwise.
 */
export async function webhookAlertEmailAddress(
  db: Db,
  email: Pick<WebhookAlertEmail, 'environmentId' | 'userId'>,
): Promise<string | null> {
  const [row] = await db
    .select({ address: users.email })
    .from(users)
    .innerJoin(
      notificationPreferences,
      and(eq(notificationPreferences.userId, users.id), eq(notificationPreferences.kind, KIND)),
    )
    .where(
      and(
        eq(users.id, email.userId),
        eq(users.status, 'active'),
        eq(notificationPreferences.email, true),
        readsWebhooks(email.environmentId),
      ),
    )
    .limit(1);
  return row?.address ?? null;
}
