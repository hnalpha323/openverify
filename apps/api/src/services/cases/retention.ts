/**
 * C139.3, C134.4, C143.1 (Workflow 8B, `api-cases`): the case steps of the C16 pass.
 *
 * - `case-retention-days` (none by default, 1 to 3,650) counts from `resolved_at` and is enforced by
 *   redaction (`redactCasesInTx`, as the system), never deletion; each case in a transaction of its
 *   own, so one failure fails nothing else and is counted.
 * - Notifications go after 90 days (C134.4).
 * - P22 (K8-21, Workflow 8D): an image attachment of a case holding a selfie inquiry is redacted once
 *   that inquiry's biometric data goes (`listBiometricCaseAttachmentsDue`: the inquiry redacted, or its
 *   selfie past `face-template-retention-days`), alone, in a transaction of its own under the case's
 *   lock: its name, digest and rendition go as a case redaction takes them, `lock-version` moves,
 *   `case.updated` is staged and a system audit entry names the attachment, its case and the
 *   inquiry; its objects are deleted after the commit, a failed delete left to the C16 purge. Like
 *   the case redactions, it runs only in a pass that has a publisher.
 */
import {
  deleteExpiredUserNotifications,
  listBiometricCaseAttachmentsDue,
  listCasesPastRetention,
  lockCaseRow,
  updateCaseRow,
  type Db,
} from '@openverify/db';
import type { StagedEvent, TransactionalEventPublisher } from '../../events/index.js';
import { systemClock, type FileStorage } from '../../ports.js';
import { appendSystemAuditEntry } from '../audit-log.js';
import { redactCaseAttachmentsInTx } from './attachments/redaction.js';
import { checkedCaseAuditMetadata } from './audit.js';
import { redactCasesInTx } from './redaction.js';
import { caseEventResource } from './resources.js';

export interface CaseRetentionReport {
  /** Cases past their environment's `case-retention-days`, redacted. */
  redactedCases: number;
  failedCaseRedactions: number;
  /** C134.4: notifications past 90 days, deleted. */
  deletedUserNotifications: number;
  /** K8-21 (P22): image attachments redacted with a held selfie inquiry's biometric data. */
  redactedBiometricAttachments: number;
}

export interface CaseRetentionDeps {
  db: Db;
  storage: FileStorage;
  /** Left out (a pass with no publisher), cases wait for a pass that has one. */
  events?: TransactionalEventPublisher | undefined;
}

/** C134.4 (ours, provisional): notifications are kept 90 days. */
export const NOTIFICATION_RETENTION_DAYS = 90;

const DAY_MS = 86_400_000;

export async function runCaseRetention(
  deps: CaseRetentionDeps,
  options: { now: Date; limit: number },
): Promise<CaseRetentionReport> {
  const { db, events } = deps;
  let redactedCases = 0;
  let failedCaseRedactions = 0;
  if (events !== undefined) {
    const failed = new Set<string>();
    for (;;) {
      const due = (await listCasesPastRetention(db, options.now, options.limit)).filter(
        ({ id }) => !failed.has(id),
      );
      if (due.length === 0) {
        break;
      }
      for (const { id, environmentId } of due) {
        try {
          const staged = await db.transaction(async (tx) => {
            const result = await redactCasesInTx(
              tx,
              { events, clock: systemClock },
              {
                environmentId,
                caseIds: [id],
                at: options.now,
                actor: null,
                cause: { retention: 'case-retention-days' },
              },
            );
            return result.staged;
          });
          await events.dispatch(staged);
          redactedCases += 1;
        } catch {
          failed.add(id);
          failedCaseRedactions += 1;
        }
      }
    }
  }
  let deletedUserNotifications = 0;
  const before = new Date(options.now.getTime() - NOTIFICATION_RETENTION_DAYS * DAY_MS);
  for (;;) {
    const deleted = await deleteExpiredUserNotifications(db, before, options.limit);
    deletedUserNotifications += deleted;
    if (deleted < options.limit) {
      break;
    }
  }
  const redactedBiometricAttachments =
    events === undefined ? 0 : await redactBiometricAttachments(deps, events, options);
  return {
    redactedCases,
    failedCaseRedactions,
    deletedUserNotifications,
    redactedBiometricAttachments,
  };
}

/** K8-21 (P22): the image attachments due with their held selfie inquiry's biometric data. */
async function redactBiometricAttachments(
  deps: CaseRetentionDeps,
  events: TransactionalEventPublisher,
  options: { now: Date; limit: number },
): Promise<number> {
  const { db, storage } = deps;
  const failed = new Set<string>();
  let redacted = 0;
  for (;;) {
    const due = (
      await listBiometricCaseAttachmentsDue(db, options.now, options.limit + failed.size)
    ).filter(({ id }) => !failed.has(id));
    if (due.length === 0) {
      return redacted;
    }
    for (const attachment of due) {
      try {
        const done = await db.transaction(async (tx) => {
          const staged: StagedEvent[] = [];
          if ((await lockCaseRow(tx, attachment.environmentId, attachment.caseId)) === null) {
            return { staged, storageKeys: [] as string[], redacted: false };
          }
          const { storageKeys } = await redactCaseAttachmentsInTx(tx, {
            environmentId: attachment.environmentId,
            attachmentIds: [attachment.id],
            at: options.now,
          });
          if (storageKeys.length === 0) {
            return { staged, storageKeys, redacted: false };
          }
          const row = await updateCaseRow(tx, attachment.environmentId, attachment.caseId, {});
          if (row !== null) {
            staged.push(
              await events.stage(tx, {
                environmentId: attachment.environmentId,
                name: 'case.updated',
                payload: { data: await caseEventResource(tx, attachment.environmentId, row) },
              }),
            );
          }
          const metadata = {
            'case-id': attachment.caseId,
            'inquiry-id': attachment.inquiryId,
            retention: 'biometric' as const,
          };
          checkedCaseAuditMetadata('case-attachment.redacted', metadata);
          await appendSystemAuditEntry(tx, attachment.environmentId, {
            action: 'case-attachment.redacted',
            resourceType: 'case-attachment',
            resourceId: attachment.id,
            metadata,
          });
          return { staged, storageKeys, redacted: true };
        });
        await events.dispatch(done.staged);
        // A failed delete is left to the C16 purge, which finds the redacted, undeleted objects.
        await Promise.allSettled(done.storageKeys.map((key) => storage.delete(key)));
        if (done.redacted) {
          redacted += 1;
        } else {
          failed.add(attachment.id);
        }
      } catch {
        failed.add(attachment.id);
      }
    }
  }
}
