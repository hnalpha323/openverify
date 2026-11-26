/**
 * K9-26 (Workflow 9D; C169.7, C134.4, K8-20): a case notification of one kind for some users of the
 * environment's organisation, in the caller's transaction, through each recipient's notification
 * preferences for that kind (`notificationPreferencesOf`, the reader the webhook-failure alert uses):
 * the console notification when `console` is on, the link-only email when `email` is on, and
 * `NOTIFICATION_PREFERENCE_DEFAULT` (console on, email off) for a kind the user never set. A template
 * version's `notify-on-create` list is an email the operator asked for and has no preference kind, so
 * it is queued as before (`services/cases/create.ts`).
 */
import { newId } from '@openverify/contracts';
import type { CaseNotificationKind } from '@openverify/core';
import { insertUserNotifications, queueCaseNotificationEmails, type Db } from '@openverify/db';
import { notificationPreferencesOf } from '../../webhooks/alerts/preferences.js';

export async function notifyByPreferencesInTx(
  tx: Db,
  environmentId: string,
  caseId: string,
  kind: CaseNotificationKind,
  userIds: readonly string[],
): Promise<void> {
  const channels = [];
  for (const userId of new Set(userIds)) {
    channels.push({ userId, ...(await notificationPreferencesOf(tx, userId))[kind] });
  }
  await insertUserNotifications(
    tx,
    environmentId,
    channels
      .filter((user) => user.console)
      .map(({ userId }) => ({ id: newId('unot'), userId, kind, caseId })),
  );
  await queueCaseNotificationEmails(
    tx,
    environmentId,
    channels.filter((user) => user.email).map(({ userId }) => ({ userId, caseId, kind })),
  );
}
