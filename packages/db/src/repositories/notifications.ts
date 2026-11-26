/**
 * C134.4 (Workflow 8B): a person's case notifications: a kind and a case, never comment text.
 * Owner `api-cases`; `foundation-8b` froze the names.
 */
import { and, asc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { CaseNotificationEmailKind, CaseNotificationKind } from '@openverify/core';
import type { Db } from '../client.js';
import {
  caseNotificationEmails,
  userNotifications,
  type UserNotificationRow,
} from '../tables/cases.js';
import { environments } from '../tables/tenancy.js';
import { users } from '../tables/users.js';
import {
  environmentCursor,
  newestFirst,
  paginate,
  type Page,
  type PageRequest,
} from './pagination.js';
import { firstOrNull } from './rows.js';

/**
 * K9-26 (Workflow 9D): case notifications in the console only, no email queued; the API's
 * `notifyByPreferencesInTx` writes each user's channels as their preferences say.
 */
export async function insertUserNotifications(
  tx: Db,
  environmentId: string,
  rows: readonly { id: string; userId: string; kind: CaseNotificationKind; caseId: string }[],
): Promise<UserNotificationRow[]> {
  if (rows.length === 0) {
    return [];
  }
  return tx
    .insert(userNotifications)
    .values(rows.map((row) => ({ ...row, environmentId })))
    .returning();
}

/** Case notifications, each with its link-only email (K8-20), whatever the preferences say. */
export async function createUserNotifications(
  tx: Db,
  environmentId: string,
  rows: readonly { id: string; userId: string; kind: CaseNotificationKind; caseId: string }[],
): Promise<UserNotificationRow[]> {
  if (rows.length === 0) {
    return [];
  }
  const created = await insertUserNotifications(tx, environmentId, rows);
  // K8-20: each notification's link-only email, in the same transaction.
  await queueCaseNotificationEmails(
    tx,
    environmentId,
    rows.map(({ userId, caseId, kind }) => ({ userId, caseId, kind })),
  );
  return created;
}

/** C134.4: kept 90 days; deletes the older ones, at most `limit`, and answers how many. */
export async function deleteExpiredUserNotifications(
  db: Db,
  before: Date,
  limit: number,
): Promise<number> {
  const due = await db
    .select({ id: userNotifications.id })
    .from(userNotifications)
    .where(lt(userNotifications.createdAt, before))
    .orderBy(asc(userNotifications.createdAt))
    .limit(limit);
  if (due.length === 0) {
    return 0;
  }
  const deleted = await db
    .delete(userNotifications)
    .where(
      inArray(
        userNotifications.id,
        due.map(({ id }) => id),
      ),
    )
    .returning({ id: userNotifications.id });
  return deleted.length;
}

const notificationCursor = environmentCursor(userNotifications);

/** `GET /dashboard/notifications`: the user's own, newest first (C1). */
export async function listUserNotificationRows(
  db: Db,
  environmentId: string,
  userId: string,
  filters: { unread?: boolean | undefined },
  page: PageRequest,
): Promise<Page<UserNotificationRow>> {
  return paginate(db, notificationCursor, environmentId, page, (after, limit) =>
    db
      .select()
      .from(userNotifications)
      .where(
        and(
          eq(userNotifications.environmentId, environmentId),
          eq(userNotifications.userId, userId),
          filters.unread === true ? isNull(userNotifications.readAt) : undefined,
          after,
        ),
      )
      .orderBy(...newestFirst(notificationCursor))
      .limit(limit),
  );
}

/** The user's own notification, or `null`. */
export async function getUserNotificationRow(
  db: Db,
  environmentId: string,
  userId: string,
  id: string,
): Promise<UserNotificationRow | null> {
  return firstOrNull(
    await db
      .select()
      .from(userNotifications)
      .where(
        and(
          eq(userNotifications.environmentId, environmentId),
          eq(userNotifications.userId, userId),
          eq(userNotifications.id, id),
        ),
      )
      .limit(1),
  );
}

/** Marks the user's own notification read at `at` (once: a later call keeps the first time). */
export async function markUserNotificationRead(
  tx: Db,
  environmentId: string,
  userId: string,
  id: string,
  at: Date,
): Promise<UserNotificationRow | null> {
  await tx
    .update(userNotifications)
    .set({ readAt: at })
    .where(
      and(
        eq(userNotifications.environmentId, environmentId),
        eq(userNotifications.userId, userId),
        eq(userNotifications.id, id),
        isNull(userNotifications.readAt),
      ),
    );
  return getUserNotificationRow(tx, environmentId, userId, id);
}

/**
 * K8-20 (Workflow 8D; C133.7, C134.4, P38): one link-only email owed to a user about a case, held
 * in `case_notification_emails` until the worker's `case-notification-emails` sweep sends it.
 */
export interface CaseNotificationEmail {
  id: number;
  environmentId: string;
  userId: string;
  caseId: string;
  kind: CaseNotificationEmailKind;
  attempts: number;
}

/** K8-20: the most sends an email is tried (ours, provisional, as `scan-attempts`). */
export const CASE_NOTIFICATION_EMAIL_ATTEMPTS = 3;

/**
 * K8-20: queues an email for each row whose user belongs to the environment's organisation, in the
 * caller's transaction; answers how many it queued. Whether the user may still read the case is the
 * sweep's to check at send (P38).
 */
export async function queueCaseNotificationEmails(
  tx: Db,
  environmentId: string,
  rows: readonly { userId: string; caseId: string; kind: CaseNotificationEmailKind }[],
): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }
  const members = await tx
    .select({ id: users.id })
    .from(users)
    .innerJoin(environments, eq(environments.organizationId, users.organizationId))
    .where(
      and(
        eq(environments.id, environmentId),
        inArray(users.id, [...new Set(rows.map(({ userId }) => userId))]),
      ),
    );
  const known = new Set(members.map(({ id }) => id));
  const kept = rows.filter(({ userId }) => known.has(userId));
  if (kept.length > 0) {
    await tx
      .insert(caseNotificationEmails)
      .values(kept.map(({ userId, caseId, kind }) => ({ environmentId, userId, caseId, kind })));
  }
  return kept.length;
}

/**
 * K8-20: takes up to `limit` emails no one holds (never claimed, or claimed before `now - leaseMs`)
 * with attempts left, `FOR UPDATE SKIP LOCKED`, in the order they were written, and counts this
 * attempt on each. An email whose last attempt's lease lapsed (its worker stopped) is deleted.
 */
export async function claimCaseNotificationEmails(
  tx: Db,
  options: { now: Date; leaseMs: number; limit: number },
): Promise<CaseNotificationEmail[]> {
  const lapsed = new Date(options.now.getTime() - options.leaseMs);
  const held = caseNotificationEmails;
  await tx
    .delete(held)
    .where(and(gte(held.attempts, CASE_NOTIFICATION_EMAIL_ATTEMPTS), lt(held.claimedAt, lapsed)));
  const due = await tx
    .select({ id: held.id })
    .from(held)
    .where(
      and(
        lt(held.attempts, CASE_NOTIFICATION_EMAIL_ATTEMPTS),
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
    .map(({ id, environmentId, userId, caseId, kind, attempts }) => ({
      id,
      environmentId,
      userId,
      caseId,
      kind,
      attempts,
    }));
}

/** K8-20: forgets the emails sent, skipped or out of attempts. */
export async function deleteCaseNotificationEmails(db: Db, ids: readonly number[]): Promise<void> {
  if (ids.length > 0) {
    await db.delete(caseNotificationEmails).where(inArray(caseNotificationEmails.id, [...ids]));
  }
}
