/**
 * C16 redaction of inquiries and accounts: irreversible and idempotent. For an inquiry:
 * - its files are deleted from storage and their rows marked `deleted-at`;
 * - `fields`, `note`, the sessions' and consents' IP and user agent are nulled (inquiry fields
 *   become `{}`: the column has been NOT NULL since Phase 1);
 * - check `metadata` and `reasons` are emptied;
 * - every stored event payload of the inquiry, its verifications and sessions becomes the stub
 *   `{ data: { type, id, attributes: { redacted-at } } }`, and stored API log bodies and
 *   idempotent responses about them are dropped;
 * - `redacted-at` is set and `inquiry.redacted` emitted;
 * - its active sessions are canceled (`inquiry-session.canceled`) and its unused one-time links
 *   revoked, so the end user of an open inquiry writes no new PII; the flow API also answers
 *   410 `redacted` to writes on a redacted inquiry (Workflow 2B F018).
 *
 * An account's fields go the same way, plus the copies of it that `account.consolidated` events
 * of other accounts embed in `included`; redacting an account redacts its inquiries first, then
 * emits `account.redacted`, then redacts every account consolidated into it the same way, since
 * those hold the same person's fields and events (Workflow 2B F007).
 *
 * Both also reach the subject's transactions (owner decision 1 after Workflow 7B): an inquiry's
 * redaction every transaction naming it or one of its verifications, an account's every transaction
 * attached to it or related to it. Each goes through `redactTransactionInTx` in the same database
 * transaction, as the system and keeping its `never` fields, its objects after the commit and a
 * failed delete left to {@link purgeRedactedTransactionFiles}. A pass redacts each object at most
 * once, an object already redacted is a no-change, and nothing loops back: a transaction's own
 * redaction never reaches its objects (C105.5).
 *
 * The database part runs in one transaction with the event and the audit entry; storage objects
 * are deleted after the commit. If storage fails, the call throws (503) after marking what it
 * deleted: a retry, or the retention job's {@link purgeRedactedFiles}, deletes the rest. Later
 * reads answer 410 `redacted` through {@link assertFileNotRedacted} and
 * {@link assertInquiryNotRedacted}.
 */
import type { AuditActor } from '@openverify/contracts';
import {
  accounts,
  events,
  files,
  inquiries,
  listAccountInquiryIds,
  listRedactedTransactionFiles,
  lockAccountTransactions,
  lockInquiryTransactions,
  markFilesDeleted,
  markTransactionFilesDeleted,
  redactAccountRecords,
  redactInquiryRecords,
  revokeOneTimeLinks,
  verifications,
  type Db,
  type EventPayload as StoredPayload,
  type TransactionFile,
  type StoredFile,
} from '@openverify/db';
import { and, asc, eq, gt, isNotNull, isNull } from 'drizzle-orm';
import { AppError, NotFoundError, RedactedError } from '../errors.js';
import type { StagedEvent, TransactionalEventPublisher } from '../events/index.js';
import { deleteRenditionsForFilesInTx } from './cases/attachments/renditions.js';
import { redactCasesInTx } from './cases/redaction.js';
import { redactDecisionCommentsInTx } from './decisions/redaction.js';
import { afterListItemsRedactedInTx } from './lists/list-writes.js';
import { redactRunsForSubjectsInTx } from '../workflows/runs/redaction.js';
import type { WorkerLogger } from '../jobs/logger.js';
import {
  systemClock,
  type AuditLogger,
  type BiometricItemRedactor,
  type Clock,
  type FileStorage,
  type RedactionResult,
  type RedactionService,
  type ServiceContext,
  type TransactionRedactionRequest,
} from '../ports.js';
import { accountResource } from './accounts.js';
import { appendSystemAuditEntry, storedActorOf } from './audit-log.js';
import { flowActionCopyTargets, type FlowActionCopyTarget } from '../flow-actions/copies.js';
import { recordRedactedContributionInTx } from './analytics/redaction.js';
import { auditEntryOf } from './context.js';
import { inquiryResourceOf } from './inquiries.js';
import { cancelActiveSessions } from './inquiry-sessions.js';
import { redactAccountGraphInTx, redactInquiryGraphInTx } from './graph/redaction.js';
import { biometricItemRedactor } from './lists/biometric/index.js';
import {
  redactAccountReportsInTx,
  redactInquiryReportsInTx,
  redactReportInTx,
  type ReportRedactionActor,
} from './reports/redaction.js';
import { redactTransactionInTx } from './transactions/redaction.js';
import { connectRedactionHooks } from './connect/redaction-hooks.js';
import { accountExportHooks } from './account-export/hooks.js';

/** Rows read per batch when scanning events or leftover files. */
const BATCH = 500;

/** Owner decision 12: the inquiry and account cascades and retention redact as the system. */
const SYSTEM_REDACTION_ACTOR: ReportRedactionActor = Object.freeze({
  actorType: 'system',
  actorId: null,
});

/** The `redact` action's actor: the principal of `DELETE /reports/:id`; retention passes none. */
function reportRedactionActorOf(actor: AuditActor | null): ReportRedactionActor {
  if (actor === null) {
    return SYSTEM_REDACTION_ACTOR;
  }
  return storedActorOf(actor);
}

export interface RedactionServiceOptions {
  db: Db;
  storage: FileStorage;
  events: TransactionalEventPublisher;
  clock?: Clock;
  /**
   * Records the C15 audit entry of a redaction asked for by a principal. Background jobs
   * redact with `actor: null`, which records no principal's entry, so they may leave it out; the
   * cascades' own entries are the system's (`appendSystemAuditEntry`, C15's actor
   * `{ type: 'system', id: null }` since K7A-8).
   */
  audit?: AuditLogger;
  logger?: Pick<WorkerLogger, 'warn'>;
  /** C98.4, C99.7 (Workflow 7B): redacts the face and background items the inquiry sourced. */
  biometricItems?: BiometricItemRedactor;
}

/** The storage objects could not all be deleted; a retry finishes the redaction. */
export class RedactionIncompleteError extends AppError {
  override name = 'RedactionIncompleteError';

  constructor(failed: number, total: number) {
    super({
      status: 503,
      detail:
        `The redaction could not delete ${String(failed)} of ${String(total)} files from ` +
        'storage. Retry the request to finish it.',
    });
  }
}

const redactedAtOf = (value: Date | null, fallback: Date): Date => value ?? fallback;

/** What a cascade's transactions leave for after the commit. */
interface LinkedTransactionRedaction {
  staged: StagedEvent[];
  files: TransactionFile[];
  storageKeys: string[];
}

/** Deletes the objects of `stored`, then marks the rows; answers how many deletes failed. */
async function deleteAndMarkFiles(
  options: RedactionServiceOptions,
  environmentId: string,
  stored: readonly (StoredFile | TransactionFile)[],
  at: Date,
  mark: typeof markFilesDeleted,
): Promise<number> {
  const deleted: string[] = [];
  for (const file of stored) {
    try {
      await options.storage.delete(file.storageKey);
      deleted.push(file.id);
    } catch (error) {
      options.logger?.warn(
        { environmentId, fileId: file.id, error: (error as Error).name },
        'redaction could not delete a file from storage',
      );
    }
  }
  await mark(options.db, environmentId, deleted, at);
  return stored.length - deleted.length;
}

/** {@link deleteAndMarkFiles}, throwing when any delete failed: a retry finishes the rest. */
async function deleteStoredFiles(
  options: RedactionServiceOptions,
  environmentId: string,
  stored: readonly (StoredFile | TransactionFile)[],
  at: Date,
  mark: typeof markFilesDeleted = markFilesDeleted,
): Promise<void> {
  const failed = await deleteAndMarkFiles(options, environmentId, stored, at, mark);
  if (failed > 0) {
    throw new RedactionIncompleteError(failed, stored.length);
  }
}

/** Whether a stored payload carries the account in `included` (an `account.consolidated`). */
function includesAccount(payload: StoredPayload, accountId: string): boolean {
  const included = payload.included;
  return (
    Array.isArray(included) &&
    included.some(
      (resource: unknown) =>
        typeof resource === 'object' &&
        resource !== null &&
        (resource as { id?: unknown }).id === accountId,
    )
  );
}

/**
 * Stubs the `account.consolidated` events of other accounts that embed `accountId` among the
 * consolidated sources. Returns how many changed.
 */
async function stubConsolidationCopies(
  tx: Db,
  environmentId: string,
  accountId: string,
  at: Date,
): Promise<number> {
  let stubbed = 0;
  let after: string | undefined;
  for (;;) {
    const rows = await tx
      .select({
        id: events.id,
        payload: events.payload,
        objectId: events.objectId,
        objectType: events.objectType,
      })
      .from(events)
      .where(
        and(
          eq(events.environmentId, environmentId),
          eq(events.name, 'account.consolidated'),
          isNull(events.redactedAt),
          after === undefined ? undefined : gt(events.id, after),
        ),
      )
      .orderBy(asc(events.id))
      .limit(BATCH);
    for (const row of rows) {
      if (row.objectId === null || !includesAccount(row.payload, accountId)) {
        continue;
      }
      await tx
        .update(events)
        .set({
          payload: {
            data: {
              type: row.objectType ?? 'account',
              id: row.objectId,
              attributes: { 'redacted-at': at.toISOString() },
            },
          },
          redactedAt: at,
        })
        .where(and(eq(events.environmentId, environmentId), eq(events.id, row.id)));
      stubbed += 1;
    }
    const last = rows.at(-1);
    if (rows.length < BATCH || last === undefined) {
      return stubbed;
    }
    after = last.id;
  }
}

/** The ids of every inquiry of the account (not only the latest 100). */
async function allInquiryIds(db: Db, environmentId: string, accountId: string) {
  const rows = await db
    .select({ id: inquiries.id })
    .from(inquiries)
    .where(and(eq(inquiries.environmentId, environmentId), eq(inquiries.accountId, accountId)))
    .orderBy(asc(inquiries.createdAt), asc(inquiries.id));
  return rows.map((row) => row.id);
}

/** The C16 `RedactionService`. */
export function createRedactionService(options: RedactionServiceOptions): RedactionService {
  const { db } = options;
  const clock = options.clock ?? systemClock;
  const hookDeps = { events: options.events, clock };

  function auditorFor(actor: AuditActor | null): AuditLogger | undefined {
    if (actor !== null && options.audit === undefined) {
      throw new Error(
        'createRedactionService: an audit logger is needed to redact for a principal',
      );
    }
    return actor === null ? undefined : options.audit;
  }

  /**
   * K7B-1 (owner decision 1 after Workflow 7B): redacts the transactions a cascade locked, in the
   * cascade's database transaction, as the system: `redactTransactionInTx` keeps the pinned
   * version's `never` fields, and staging `transaction.redacted` and the audit entry happen on a
   * first redaction only. `via` names what reached it.
   */
  async function redactLinkedTransactionsInTx(
    tx: Db,
    environmentId: string,
    transactionIds: readonly string[],
    at: Date,
    via: Record<string, string>,
  ): Promise<LinkedTransactionRedaction> {
    const staged: StagedEvent[] = [];
    const objects: TransactionFile[] = [];
    const storageKeys: string[] = [];
    for (const transactionId of transactionIds) {
      const redacted = await redactTransactionInTx(tx, hookDeps, environmentId, transactionId, {
        at,
        includeNever: false,
      });
      if (redacted === null || redacted.alreadyRedacted) {
        continue;
      }
      staged.push(...redacted.staged);
      objects.push(...redacted.files);
      storageKeys.push(...redacted.storageKeys);
      await appendSystemAuditEntry(tx, environmentId, {
        action: 'transaction.redacted',
        resourceType: 'transaction',
        resourceId: transactionId,
        metadata: {
          ...via,
          'include-never': false,
          'file-count': redacted.files.length,
          'stubbed-event-count': redacted.stubbedEvents,
        },
      });
    }
    return { staged, files: objects, storageKeys };
  }

  /** The objects of cascaded transactions go after the commit; a failure is the C16 purge's. */
  async function deleteLinkedTransactionFiles(
    environmentId: string,
    linked: readonly TransactionFile[],
    at: Date,
  ): Promise<void> {
    await deleteAndMarkFiles(options, environmentId, linked, at, markTransactionFilesDeleted);
  }

  /** C127.7: the objects of a run's children. Nothing names them after the commit, so a failed
   * delete is logged by key, which holds no value. */
  async function deleteCascadedObjects(
    environmentId: string,
    storageKeys: readonly string[],
  ): Promise<void> {
    for (const key of storageKeys) {
      try {
        await options.storage.delete(key);
      } catch (error) {
        options.logger?.warn(
          { environmentId, storageKey: key, error: (error as Error).name },
          'redaction could not delete a child object from storage',
        );
      }
    }
  }

  /** K7B-1 (F04): the transactions linked while the redaction ran, in a transaction of their own. */
  async function catchUpLinkedTransactions(
    environmentId: string,
    lock: (tx: Db) => Promise<string[]>,
    at: Date,
    via: Record<string, string>,
  ): Promise<void> {
    const caughtUp = await db.transaction(async (tx) =>
      redactLinkedTransactionsInTx(tx, environmentId, await lock(tx), at, via),
    );
    await options.events.dispatch(caughtUp.staged);
    await deleteLinkedTransactionFiles(environmentId, caughtUp.files, at);
    await deleteCascadedObjects(environmentId, caughtUp.storageKeys);
  }

  async function redactInquiry(
    ctx: ServiceContext,
    inquiryId: string,
    actor: AuditActor | null,
    viaAccount?: string,
  ): Promise<RedactionResult> {
    const audit = auditorFor(actor);
    const { environmentId } = ctx;
    const staged: StagedEvent[] = [];
    const biometricStorageKeys: string[] = [];
    const transactionFiles: TransactionFile[] = [];
    const cascadedObjects: string[] = [];
    const via = { 'inquiry-id': inquiryId };
    const at = clock.now();
    const copies: FlowActionCopyTarget[] = [];
    const result = await db.transaction(async (tx) => {
      // Before the inquiry's row: a transaction always comes first (`lockInquiryTransactions`).
      const linked = await lockInquiryTransactions(tx, environmentId, inquiryId);
      // C253.4 (Workflow 11B Stage 1b (D), `foundation-11b`'s hook): the access exports listing the
      // inquiry are deleted first (`dsar-export`'s); their manifests go after the commit.
      cascadedObjects.push(
        ...(await accountExportHooks.subjectRedactedInTx(tx, {
          environmentId,
          itemIds: [inquiryId],
          at,
        })),
      );
      // C152.8 (Workflow 9A Stage 1b (S); V08): the accounts the flow's actions copied to, read
      // before `redactInquiryRecords` deletes the action rows (`api-flow-actions`).
      copies.push(...(await flowActionCopyTargets(tx, { environmentId, inquiryId })));
      // C163.4 (Workflow 9B Stage 1b (A); H04): the inquiry's contribution to the rollups of its
      // open cohort day, recorded before anything is cleared (`api-analytics`).
      await recordRedactedContributionInTx(tx, { environmentId, inquiryId, at });
      const redacted = await redactInquiryRecords(tx, environmentId, inquiryId, { at });
      if (redacted === null) {
        throw new NotFoundError(`Inquiry ${inquiryId} was not found.`);
      }
      // C135.3 (V19, P22; `api-case-files`): the renditions of the inquiry's files; their objects go
      // after the commit, and the C16 pass deletes what a failed delete left.
      cascadedObjects.push(
        ...(await deleteRenditionsForFilesInTx(tx, {
          environmentId,
          fileIds: redacted.files.map((file) => file.id),
        })),
      );
      // An open inquiry's end user must not write new PII after the redaction (2B F018): its
      // live sessions are canceled (after their IP and user agent were nulled above) and its
      // unused one-time links revoked. Also on a re-run, for anything opened in between.
      staged.push(
        ...(await cancelActiveSessions(tx, options.events, environmentId, inquiryId, at)),
      );
      await revokeOneTimeLinks(tx, environmentId, inquiryId, at);
      // C73.5: the inquiry's reports, under the inquiry's lock (C73.7); also on a re-run.
      staged.push(
        ...(await redactInquiryReportsInTx(tx, hookDeps, {
          environmentId,
          inquiryId,
          at,
          actor: SYSTEM_REDACTION_ACTOR,
        })),
      );
      // C98.4, C99.7 (Workflow 7B): the face and background items the inquiry was the source of.
      const biometric = await (options.biometricItems ?? biometricItemRedactor).redactBySource(tx, {
        environmentId,
        inquiryId,
        at,
      });
      biometricStorageKeys.push(...biometric.storageKeys);
      // C127.12, C128.1 (F20, V25): what those items owe, in this transaction.
      staged.push(
        ...(await afterListItemsRedactedInTx(
          tx,
          { events: options.events },
          environmentId,
          biometric,
          at,
        )),
      );
      // C101.4, C102.7 (Workflow 7B): the graph rows the inquiry contributed, and its account in
      // every stored result (`api-graph`); also on a re-run.
      await redactInquiryGraphInTx(tx, { environmentId, inquiryId, at });
      // C241.1-C241.3 (Workflow 11A Stage 1b (K), `foundation-11a`'s hook): Connect's tokens and consent
      // records of the inquiry, in this transaction (`api-consent`'s redaction-hooks.ts).
      await connectRedactionHooks.inquiryRedactedInTx(tx, { environmentId, id: inquiryId, at });
      // C120.9 (F35): the runs that recorded the inquiry (`api-engine`); also on a re-run.
      await redactRunsForSubjectsInTx(tx, { environmentId, subjectIds: [inquiryId], at });
      // C128.1 (V25): its decisions stay, and only their comments go (`api-actions`).
      await redactDecisionCommentsInTx(tx, { environmentId, subjectIds: [inquiryId], at });
      // K7B-1: the transactions naming the inquiry or one of its verifications.
      const transactions = await redactLinkedTransactionsInTx(tx, environmentId, linked, at, via);
      staged.push(...transactions.staged);
      transactionFiles.push(...transactions.files);
      cascadedObjects.push(...transactions.storageKeys);
      if (!redacted.alreadyRedacted) {
        staged.push(
          await options.events.stage(tx, {
            environmentId,
            name: 'inquiry.redacted',
            payload: { data: await inquiryResourceOf(tx, environmentId, redacted.inquiry) },
          }),
        );
        if (audit !== undefined && actor !== null) {
          await audit.record(
            tx,
            auditEntryOf(ctx, actor, {
              action: 'inquiry.redacted',
              resourceType: 'inquiry',
              resourceId: inquiryId,
              metadata: {
                ...(viaAccount === undefined ? {} : { 'account-id': viaAccount }),
                'file-count': redacted.files.length,
                'stubbed-event-count': redacted.stubbedEvents,
                ...(copies.length === 0
                  ? {}
                  : {
                      'flow-copy-account-ids': [...new Set(copies.map((copy) => copy.accountId))],
                    }),
              },
            }),
          );
        }
      }
      return redacted;
    });
    await options.events.dispatch(staged);
    await deleteLinkedTransactionFiles(environmentId, transactionFiles, at);
    await deleteCascadedObjects(environmentId, cascadedObjects);
    await catchUpLinkedTransactions(
      environmentId,
      (tx) => lockInquiryTransactions(tx, environmentId, inquiryId),
      at,
      via,
    );
    await deleteStoredFiles(options, environmentId, result.files, at);
    for (const key of biometricStorageKeys) {
      await options.storage.delete(key);
    }
    return {
      redactedAt: redactedAtOf(result.inquiry.redactedAt, at),
      alreadyRedacted: result.alreadyRedacted,
      ...(copies.length === 0
        ? {}
        : { flowCopyTargets: copies.map(({ accountId, keys }) => ({ accountId, keys })) }),
    };
  }

  async function redactAccount(
    ctx: ServiceContext,
    accountId: string,
    actor: AuditActor | null,
    visited = new Set<string>(),
  ): Promise<RedactionResult> {
    visited.add(accountId);
    const audit = auditorFor(actor);
    const { environmentId } = ctx;
    const exists = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.environmentId, environmentId), eq(accounts.id, accountId)))
      .limit(1);
    if (exists.length === 0) {
      throw new NotFoundError(`Account ${accountId} was not found.`);
    }
    const redactedInquiries = new Set<string>();
    for (const inquiryId of await allInquiryIds(db, environmentId, accountId)) {
      await redactInquiry(ctx, inquiryId, actor, accountId);
      redactedInquiries.add(inquiryId);
    }
    const staged: StagedEvent[] = [];
    const transactionFiles: TransactionFile[] = [];
    const cascadedObjects: string[] = [];
    const via = { 'account-id': accountId };
    const at = clock.now();
    const result = await db.transaction(async (tx) => {
      // Before the account's row: a transaction always comes first (`lockInquiryTransactions`).
      const linked = await lockAccountTransactions(tx, environmentId, accountId);
      // C253.4 (Workflow 11B Stage 1b (D), `foundation-11b`'s hook): the account's access exports
      // are deleted first (`dsar-export`'s); their manifests go after the commit.
      cascadedObjects.push(
        ...(await accountExportHooks.subjectRedactedInTx(tx, {
          environmentId,
          itemIds: [accountId],
          at,
        })),
      );
      const redacted = await redactAccountRecords(tx, environmentId, accountId, { at });
      if (redacted === null) {
        throw new NotFoundError(`Account ${accountId} was not found.`);
      }
      const redactedAt = redactedAtOf(redacted.account.redactedAt, at);
      await stubConsolidationCopies(tx, environmentId, accountId, redactedAt);
      // C101.4, C102.7 (Workflow 7B): every graph row of the account and the account in every
      // stored result (`api-graph`); also on a re-run.
      await redactAccountGraphInTx(tx, { environmentId, accountId, at });
      // C241.1-C241.3 (Workflow 11A Stage 1b (K), `foundation-11a`'s hook): the account's, likewise.
      await connectRedactionHooks.accountRedactedInTx(tx, { environmentId, id: accountId, at });
      // C120.9 (F35): the runs that recorded the account (`api-engine`); also on a re-run.
      await redactRunsForSubjectsInTx(tx, { environmentId, subjectIds: [accountId], at });
      // C128.1 (V25): its decisions stay, and only their comments go (`api-actions`).
      await redactDecisionCommentsInTx(tx, { environmentId, subjectIds: [accountId], at });
      // C73.5: the reports linked to the account, home or through report_accounts.
      staged.push(
        ...(await redactAccountReportsInTx(tx, hookDeps, {
          environmentId,
          accountId,
          at,
          actor: SYSTEM_REDACTION_ACTOR,
        })),
      );
      // K7B-1: the transactions attached to the account or related to it.
      const transactions = await redactLinkedTransactionsInTx(tx, environmentId, linked, at, via);
      staged.push(...transactions.staged);
      transactionFiles.push(...transactions.files);
      cascadedObjects.push(...transactions.storageKeys);
      if (!redacted.alreadyRedacted) {
        const inquiryIds = await listAccountInquiryIds(tx, environmentId, accountId);
        staged.push(
          await options.events.stage(tx, {
            environmentId,
            name: 'account.redacted',
            payload: { data: accountResource({ account: redacted.account, inquiryIds }) },
          }),
        );
        if (audit !== undefined && actor !== null) {
          await audit.record(
            tx,
            auditEntryOf(ctx, actor, {
              action: 'account.redacted',
              resourceType: 'account',
              resourceId: accountId,
              metadata: { 'inquiry-count': redacted.inquiryIds.length },
            }),
          );
        }
      }
      return redacted;
    });
    await options.events.dispatch(staged);
    // C73.5 (F04): reports linked to the account while it was being redacted.
    const caughtUp = await db.transaction((tx) =>
      redactAccountReportsInTx(tx, hookDeps, {
        environmentId,
        accountId,
        at,
        actor: SYSTEM_REDACTION_ACTOR,
      }),
    );
    await options.events.dispatch(caughtUp);
    await deleteLinkedTransactionFiles(environmentId, transactionFiles, at);
    await deleteCascadedObjects(environmentId, cascadedObjects);
    await catchUpLinkedTransactions(
      environmentId,
      (tx) => lockAccountTransactions(tx, environmentId, accountId),
      at,
      via,
    );
    // Inquiries linked to the account while it was being redacted.
    for (const inquiryId of result.inquiryIds) {
      if (!redactedInquiries.has(inquiryId)) {
        await redactInquiry(ctx, inquiryId, actor, accountId);
      }
    }
    // The accounts it absorbed keep the same person's fields and events (2B F007). Also on a
    // re-run, so a retry finishes what a failed run left.
    for (const sourceId of result.consolidatedAccountIds) {
      if (!visited.has(sourceId)) {
        await redactAccount(ctx, sourceId, actor, visited);
      }
    }
    return {
      redactedAt: redactedAtOf(result.account.redactedAt, at),
      alreadyRedacted: result.alreadyRedacted,
    };
  }

  /** C73.5, C73.6: one report, through the report redaction hook, in its own transaction. */
  async function redactReport(
    ctx: ServiceContext,
    reportId: string,
    actor: AuditActor | null,
  ): Promise<RedactionResult> {
    const audit = auditorFor(actor);
    const { environmentId } = ctx;
    const at = clock.now();
    const exportObjects: string[] = [];
    const outcome = await db.transaction(async (tx) => {
      // C253.4, KP11-27 (Workflow 11F): the access exports listing the report go first, in this
      // transaction (the C16 pass's `redactDueObjects` and an operator's redaction alike); their
      // manifests after the commit.
      exportObjects.push(
        ...(await accountExportHooks.subjectRedactedInTx(tx, {
          environmentId,
          itemIds: [reportId],
          at,
        })),
      );
      const redacted = await redactReportInTx(tx, hookDeps, environmentId, reportId, {
        at,
        actor: reportRedactionActorOf(actor),
      });
      if (redacted === null) {
        throw new NotFoundError(`Report ${reportId} was not found.`);
      }
      if (!redacted.alreadyRedacted && audit !== undefined && actor !== null) {
        await audit.record(
          tx,
          auditEntryOf(ctx, actor, {
            action: 'report.redacted',
            resourceType: 'report',
            resourceId: reportId,
            metadata: {
              'match-count': redacted.counts.matches,
              'action-count': redacted.counts.actions,
            },
          }),
        );
      }
      return redacted;
    });
    await options.events.dispatch(outcome.staged);
    await deleteCascadedObjects(environmentId, exportObjects);
    return { redactedAt: outcome.redactedAt, alreadyRedacted: outcome.alreadyRedacted };
  }

  /**
   * C105.5: one transaction, through its hook, in one transaction with the audit entry; the objects
   * go after the commit. A first redaction is audited, and so is any run with `includeNever`: that
   * override is what P21 asks to record, and it can follow a first redaction.
   */
  async function redactTransaction(
    ctx: ServiceContext,
    transactionId: string,
    actor: AuditActor | null,
    request: TransactionRedactionRequest = {},
  ): Promise<RedactionResult> {
    const audit = auditorFor(actor);
    const { environmentId } = ctx;
    const includeNever = request.includeNever === true;
    const at = clock.now();
    const exportObjects: string[] = [];
    const outcome = await db.transaction(async (tx) => {
      // C253.4, KP11-27 (Workflow 11F): the access exports listing the transaction go first.
      exportObjects.push(
        ...(await accountExportHooks.subjectRedactedInTx(tx, {
          environmentId,
          itemIds: [transactionId],
          at,
        })),
      );
      const redacted = await redactTransactionInTx(tx, hookDeps, environmentId, transactionId, {
        at,
        includeNever,
      });
      if (redacted === null) {
        throw new NotFoundError(`Transaction ${transactionId} was not found.`);
      }
      if ((!redacted.alreadyRedacted || includeNever) && audit !== undefined && actor !== null) {
        await audit.record(
          tx,
          auditEntryOf(ctx, actor, {
            action: 'transaction.redacted',
            resourceType: 'transaction',
            resourceId: transactionId,
            metadata: {
              'include-never': includeNever,
              'file-count': redacted.files.length,
              'stubbed-event-count': redacted.stubbedEvents,
            },
          }),
        );
      }
      return redacted;
    });
    await options.events.dispatch([...outcome.staged]);
    await deleteStoredFiles(options, environmentId, outcome.files, at, markTransactionFilesDeleted);
    await deleteCascadedObjects(environmentId, [...outcome.storageKeys, ...exportObjects]);
    return { redactedAt: outcome.redactedAt, alreadyRedacted: outcome.alreadyRedacted };
  }

  /**
   * C139.1 (Workflow 8B, F35): one case, through `redactCasesInTx` (`api-cases`), with the runs that
   * name it (C120.9), in one transaction; its objects go after the commit, and a failed delete is the
   * C16 purge's. The case's own audit entry is `redactCasesInTx`'s, because only it knows a first
   * redaction from a repeated one.
   */
  async function redactCase(
    ctx: ServiceContext,
    caseId: string,
    actor: AuditActor | null,
  ): Promise<RedactionResult> {
    const { environmentId } = ctx;
    const at = clock.now();
    const outcome = await db.transaction(async (tx) => {
      const redacted = await redactCasesInTx(tx, hookDeps, {
        environmentId,
        caseIds: [caseId],
        at,
        actor,
      });
      const found = redacted.cases.find(({ id }) => id === caseId);
      if (found === undefined) {
        throw new NotFoundError(`Case ${caseId} was not found.`);
      }
      if (!found.alreadyRedacted) {
        await redactRunsForSubjectsInTx(tx, { environmentId, subjectIds: [caseId], at });
      }
      return { ...redacted, found };
    });
    await options.events.dispatch([...outcome.staged]);
    await deleteCascadedObjects(environmentId, outcome.storageKeys);
    return { redactedAt: outcome.found.redactedAt, alreadyRedacted: outcome.found.alreadyRedacted };
  }

  return {
    redactInquiry: (ctx, inquiryId, actor) => redactInquiry(ctx, inquiryId, actor),
    redactAccount: (ctx, accountId, actor) => redactAccount(ctx, accountId, actor),
    redactReport: (ctx, reportId, actor) => redactReport(ctx, reportId, actor),
    redactTransaction: (ctx, transactionId, actor, request) =>
      redactTransaction(ctx, transactionId, actor, request),
    redactCase: (ctx, caseId, actor) => redactCase(ctx, caseId, actor),
  };
}

export interface PurgeRedactedFilesOptions {
  db: Db;
  storage: FileStorage;
  clock?: Clock;
  /** Files per batch; defaults to 500. */
  limit?: number;
  logger?: Pick<WorkerLogger, 'warn'>;
  /** Called with each file whose object could not be deleted, so the caller can count it. */
  onFailure?: (fileId: string) => void;
}

/**
 * Deletes the storage objects that redacted inquiries still have (a redaction whose storage
 * deletes failed), across environments, in batches. Returns how many it deleted. Stops when a
 * batch makes no progress, so a storage outage cannot loop it.
 */
export async function purgeRedactedFiles(options: PurgeRedactedFilesOptions): Promise<number> {
  const { db, storage } = options;
  const clock = options.clock ?? systemClock;
  const limit = options.limit ?? BATCH;
  let purged = 0;
  for (;;) {
    const rows = await db
      .select({
        id: files.id,
        environmentId: files.environmentId,
        storageKey: files.storageKey,
      })
      .from(files)
      .innerJoin(
        verifications,
        and(
          eq(verifications.environmentId, files.environmentId),
          eq(verifications.id, files.verificationId),
        ),
      )
      .innerJoin(
        inquiries,
        and(
          eq(inquiries.environmentId, verifications.environmentId),
          eq(inquiries.id, verifications.inquiryId),
        ),
      )
      .where(and(isNull(files.deletedAt), isNotNull(inquiries.redactedAt)))
      .orderBy(asc(files.id))
      .limit(limit);
    let progress = 0;
    for (const row of rows) {
      try {
        await storage.delete(row.storageKey);
        await markFilesDeleted(db, row.environmentId, [row.id], clock.now());
        progress += 1;
      } catch (error) {
        options.logger?.warn(
          { environmentId: row.environmentId, fileId: row.id, error: (error as Error).name },
          'could not delete a redacted file from storage',
        );
        options.onFailure?.(row.id);
      }
    }
    purged += progress;
    if (rows.length < limit || progress === 0) {
      return purged;
    }
  }
}

/**
 * C105.5: deletes the storage objects that redacted transactions still have (a redaction whose
 * storage deletes failed), as {@link purgeRedactedFiles} does for inquiries. Returns how many it
 * deleted, and stops when a batch makes no progress.
 */
export async function purgeRedactedTransactionFiles(
  options: PurgeRedactedFilesOptions,
): Promise<number> {
  const { db, storage } = options;
  const clock = options.clock ?? systemClock;
  const limit = options.limit ?? BATCH;
  let purged = 0;
  for (;;) {
    const rows = await listRedactedTransactionFiles(db, { limit });
    let progress = 0;
    for (const row of rows) {
      try {
        await storage.delete(row.storageKey);
        await markTransactionFilesDeleted(db, row.environmentId, [row.id], clock.now());
        progress += 1;
      } catch (error) {
        options.logger?.warn(
          { environmentId: row.environmentId, fileId: row.id, error: (error as Error).name },
          'could not delete a redacted transaction file from storage',
        );
        options.onFailure?.(row.id);
      }
    }
    purged += progress;
    if (rows.length < limit || progress === 0) {
      return purged;
    }
  }
}

// Redaction state, for later reads (410 `redacted`) ----------------------------------------

/** Whether the inquiry of this environment was redacted; `false` when there is none. */
export async function isInquiryRedacted(
  db: Db,
  environmentId: string,
  inquiryId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ redactedAt: inquiries.redactedAt })
    .from(inquiries)
    .where(and(eq(inquiries.environmentId, environmentId), eq(inquiries.id, inquiryId)))
    .limit(1);
  return row !== undefined && row.redactedAt !== null;
}

/** Whether the account of this environment was redacted; `false` when there is none. */
export async function isAccountRedacted(
  db: Db,
  environmentId: string,
  accountId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ redactedAt: accounts.redactedAt })
    .from(accounts)
    .where(and(eq(accounts.environmentId, environmentId), eq(accounts.id, accountId)))
    .limit(1);
  return row !== undefined && row.redactedAt !== null;
}

/**
 * When the file's content went: its `deleted-at`, or else its inquiry's `redacted-at`. `null`
 * while the content is available, and for a file that is not in this environment (the caller
 * answers 404 for that).
 */
export async function fileRedactedAt(
  db: Db,
  environmentId: string,
  fileId: string,
): Promise<Date | null> {
  const [row] = await db
    .select({ deletedAt: files.deletedAt, redactedAt: inquiries.redactedAt })
    .from(files)
    .innerJoin(
      verifications,
      and(
        eq(verifications.environmentId, files.environmentId),
        eq(verifications.id, files.verificationId),
      ),
    )
    .innerJoin(
      inquiries,
      and(
        eq(inquiries.environmentId, verifications.environmentId),
        eq(inquiries.id, verifications.inquiryId),
      ),
    )
    .where(and(eq(files.environmentId, environmentId), eq(files.id, fileId)))
    .limit(1);
  return row === undefined ? null : (row.deletedAt ?? row.redactedAt);
}

/**
 * For file content routes (C15 `GET /dashboard/files/:id/content`): call it before reading
 * the object.
 * @throws {RedactedError} 410 `redacted` when the file was deleted by a redaction.
 */
export async function assertFileNotRedacted(
  db: Db,
  environmentId: string,
  fileId: string,
): Promise<void> {
  if ((await fileRedactedAt(db, environmentId, fileId)) !== null) {
    throw new RedactedError('The file was deleted when its inquiry was redacted.');
  }
}

/**
 * For writes of PII to an inquiry (C10 `PATCH /inquiries/:id` fields and note).
 * @throws {RedactedError} 410 `redacted` when the inquiry was redacted.
 */
export async function assertInquiryNotRedacted(
  db: Db,
  environmentId: string,
  inquiryId: string,
): Promise<void> {
  if (await isInquiryRedacted(db, environmentId, inquiryId)) {
    throw new RedactedError(`Inquiry ${inquiryId} was redacted.`);
  }
}
