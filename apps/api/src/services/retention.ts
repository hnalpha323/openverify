/**
 * The C16 retention run, which the daily `retention` job executes (`jobs/retention.ts`):
 * 1. inquiries in a terminal status (`completed`, `failed`, `expired`, `approved`,
 *    `declined`) whose `updated-at` is older than their retention are redacted. The retention
 *    is the template version's `settings.retention-days`, else the environment's
 *    `inquiry-retention-days` (none: kept forever);
 * 2. storage objects that earlier redactions could not delete are deleted;
 * 3. API logs, finished webhook deliveries, events (except those a `pending` delivery still
 *    needs) and idempotency keys past their windows are deleted;
 * 4. dashboard user sessions and one-time links 30 days past their expiry are deleted
 *    (Workflow 2B F022), and so are expired MFA login and WebAuthn registration challenges
 *    (Workflow 2B F032). Audit logs are append-only and kept; inquiry sessions hold their
 *    inquiry's consent record and stay with it (redaction clears their PII);
 * 5. reports older than the environment's `report-retention-days` (none by default) are redacted
 *    through the report redaction hook, never deleted (C73.6, P14);
 * 6. face templates and their background rows older than the environment's
 *    `face-template-retention-days` (default 365) are deleted, whatever the inquiry's own
 *    retention (C42.6), each inquiry's rows under its lock (C40.6);
 * 7. Workflow 7A (C91.7, P19): the sealed collector components of signal bodies older than
 *    `signal-component-retention-days` (default 30) are nulled, the behaviour aggregates kept;
 *    the sealed addresses of sessions (with their consent records) and networks older than
 *    `ip-retention-days` (none by default) are nulled, the derived facts kept; and devices unseen
 *    for `device-retention-days` (default 365) are deleted with their HMACs;
 * 8. Workflow 7B (C98.4, C100.2): list items past their list's `item-retention-days` are redacted
 *    (`api-lists`), and each importer's object goes 7 days after the import ended (`api-importers`);
 * 9. Workflow 7B (C105.5): transactions older than the environment's `transaction-retention-days`
 *    (none by default) are redacted, never deleted, the fields marked `never` kept; and the objects
 *    a transaction's redaction could not delete are deleted;
 * 10. Workflow 8A (C120.8, C118.1): the engine's own steps (`workflows/runs/retention.ts`,
 *    `api-engine`), before the events, because a delivery marked `expired` stops holding its event.
 * 11. Workflow 8B (C139.3, C134.4): the case steps (`services/cases/retention.ts`, `api-cases`):
 *    cases past `case-retention-days` are redacted, never deleted, and notifications go after 90 days.
 * 12. Workflow 9B (C163.6, review P20): the analytics steps (`services/analytics/retention.ts`,
 *    `api-analytics`): rollup rows past `analytics-retention-months` and assignee rows past
 *    `analytics-assignee-retention-months` are deleted.
 * 13. Workflow 9B (C166.1, C166.5, C174.3; review P24): the export files past their 24 hours and the
 *    uploaded CSVs of ended or day-old bulk report jobs are deleted (`services/exports/retention.ts`,
 *    `api-exports`, which `export-sweep` also runs).
 *
 * Environment settings are read by the database queries (`environments.settings`, defaults
 * from `DEFAULT_RETENTION`). Everything works in batches (500 by default) and the run is
 * idempotent: a second run finds nothing to do. One inquiry that cannot be redacted is
 * reported and skipped, never retried in a loop. Redactions run without an actor, so they
 * write no audit entry (C15 has no system actor); their `inquiry.redacted` events record them.
 */
import {
  DEFAULT_SWEEP_LIMIT,
  deleteExpiredApiLogs,
  deleteExpiredDevices,
  deleteExpiredAuthChallenges,
  deleteExpiredEvents,
  deleteExpiredFaceData,
  deleteExpiredIdempotencyKeys,
  deleteExpiredHandoffTokens,
  deleteExpiredOneTimeLinks,
  deleteExpiredUserSessions,
  deleteExpiredWebhookDeliveries,
  deleteFlowRecordsOfRedactedInquiries,
  deleteExpiredIntegrityChallenges,
  deleteExpiredSsoLoginStates,
  deleteIntegrityRecordsOfRedactedInquiries,
  getEnvironment,
  listInquiriesDueForRetention,
  listReportsDueForRetention,
  listTransactionsDueForRetention,
  nullExpiredAddresses,
  nullExpiredSignalComponents,
  redactExpiredGraphQueries,
  redactExpiredListItems,
  type Db,
  type DeleteOptions,
  type RetentionCandidate,
} from '@openverify/db';
import {
  createOutboxOnlyPublisher,
  type StagedEvent,
  type TransactionalEventPublisher,
} from '../events/index.js';
import type { WorkerLogger } from '../jobs/logger.js';
import {
  systemClock,
  type Clock,
  type FileStorage,
  type RedactionService,
  type ServiceContext,
} from '../ports.js';
import { runWorkflowRetention, type WorkflowRetentionReport } from '../workflows/runs/retention.js';
import { purgeDiscardedRenditions } from './cases/attachments/renditions.js';
import {
  runCaseExportRetention,
  type CaseExportRetentionReport,
} from './cases/exports/retention.js';
import { runAuditLogRetention, type AuditLogRetentionReport } from './access/audit-retention.js';
import { accountExportHooks, type AccountExportRetentionReport } from './account-export/hooks.js';
import { runAnalyticsRetention, type AnalyticsRetentionReport } from './analytics/retention.js';
import { runExportRetention, type ExportRetentionReport } from './exports/retention.js';
import { runCaseRetention, type CaseRetentionReport } from './cases/retention.js';
import { purgeExpiredImportObjects } from './importers/purge.js';
import { afterListItemsRedactedInTx } from './lists/list-writes.js';
import { purgeRedactedFiles, purgeRedactedTransactionFiles } from './redaction.js';
import { runConnectRetention, type ConnectRetentionReport } from './connect/retention.js';

export interface RetentionOptions {
  db: Db;
  redaction: RedactionService;
  storage: FileStorage;
  /** Injected in tests; "now" is read once, at the start of the run. */
  clock?: Clock;
  /** Rows per batch; defaults to 500. */
  batchSize?: number;
  logger?: Pick<WorkerLogger, 'info' | 'warn'>;
  /** C127.12: where `list.updated` goes; left out, its rows wait for their sweeps. */
  events?: TransactionalEventPublisher;
}

/** What one run did: counts only, never data. */
export interface RetentionReport
  extends
    WorkflowRetentionReport,
    CaseRetentionReport,
    CaseExportRetentionReport,
    AnalyticsRetentionReport,
    AuditLogRetentionReport,
    ExportRetentionReport,
    ConnectRetentionReport,
    AccountExportRetentionReport {
  /** C135.3 (Workflow 8B (F)): rendition pages whose objects the C16 pass deleted, then their rows. */
  purgedRenditionPages: number;
  redactedInquiries: number;
  failedRedactions: number;
  /** C73.6 (P14): reports past their environment's `report-retention-days`. */
  redactedReports: number;
  failedReportRedactions: number;
  purgedFiles: number;
  /** Files of redacted inquiries whose storage object could not be deleted (2B F031). */
  failedPurges: number;
  deletedApiLogs: number;
  deletedWebhookDeliveries: number;
  deletedIdempotencyKeys: number;
  deletedEvents: number;
  /** Dashboard user sessions 30 days past their expiry (Workflow 2B F022). */
  deletedUserSessions: number;
  /** One-time links 30 days past their expiry (Workflow 2B F022). */
  deletedOneTimeLinks: number;
  /** Expired MFA login and WebAuthn registration challenges (Workflow 2B F032). */
  deletedAuthChallenges: number;
  /** C42.6: face templates past `face-template-retention-days`. */
  deletedFaceTemplates: number;
  /** C42.6: their background rows. */
  deletedSelfieBackgrounds: number;
  /** C91.7 (Workflow 7A): signal bodies whose collector components passed their window. */
  nulledSignalComponents: number;
  /** C91.7: session and network rows whose address passed `ip-retention-days`. */
  nulledAddresses: number;
  /** C91.7: devices unseen past `device-retention-days`. */
  deletedDevices: number;
  /** C98.4 (Workflow 7B): items past their list's `item-retention-days`. */
  redactedListItems: number;
  /** C100.2 (Workflow 7B): importer objects 7 days after the import ended. */
  purgedImportObjects: number;
  /** C96.2 (Workflow 7A, P27): handoff tokens 30 days past their expiry. */
  deletedHandoffTokens: number;
  /** C174.3 (Workflow 9A): redacted inquiries whose leftover flow records were deleted. */
  cleanedFlowRecordInquiries: number;
  /** C221.3 (Workflow 10B): integrity challenges a day past their expiry. */
  deletedIntegrityChallenges: number;
  /** C221.3 (Workflow 10B): redacted inquiries whose leftover integrity records were deleted. */
  cleanedIntegrityRecordInquiries: number;
  /** C248.4 (Workflow 11B, sso-oidc): single-use SSO sign-in attempts a day past their expiry. */
  deletedSsoLoginStates: number;
  /** C105.5 (Workflow 7B): transactions past their environment's `transaction-retention-days`. */
  redactedTransactions: number;
  failedTransactionRedactions: number;
  /** C105.5: files of redacted transactions a redaction could not delete from storage. */
  purgedTransactionFiles: number;
  /** C102.7 (Workflow 7B): stored graph query results past `graph-query-retention-days`. */
  redactedGraphQueries: number;
}

/** C248.4 (amendment 11): an SSO sign-in attempt is deleted a day after its expiry. */
const SSO_LOGIN_STATE_GRACE_MS = 86_400_000;

/** Calls `deleteBatch` until a batch deletes fewer rows than the batch size. */
async function drain(
  deleteBatch: (options: DeleteOptions) => Promise<number>,
  options: Required<DeleteOptions>,
): Promise<number> {
  let total = 0;
  for (;;) {
    const deleted = await deleteBatch(options);
    total += deleted;
    if (deleted < options.limit) {
      return total;
    }
  }
}

/**
 * C91.7: nulls the addresses past `ip-retention-days` in batches. One call changes up to a batch
 * of sessions and a batch of networks, so it drains until a call changes none.
 */
async function drainAddresses(db: Db, options: Required<DeleteOptions>): Promise<number> {
  let total = 0;
  for (;;) {
    const changed = await nullExpiredAddresses(db, options);
    total += changed;
    if (changed === 0) {
      return total;
    }
  }
}

/** C42.6: deletes face data past its retention in batches; returns both counts. */
async function drainFaceData(
  db: Db,
  options: Required<DeleteOptions>,
): Promise<{ templates: number; backgrounds: number }> {
  const total = { templates: 0, backgrounds: 0 };
  for (;;) {
    const deleted = await deleteExpiredFaceData(db, options);
    total.templates += deleted.templates;
    total.backgrounds += deleted.backgrounds;
    if (deleted.templates < options.limit) {
      return total;
    }
  }
}

/** Redacts the inquiries due for retention; returns how many were redacted and failed. */
async function redactDueInquiries(
  options: RetentionOptions,
  now: Date,
  limit: number,
): Promise<{ redacted: number; failed: number }> {
  const { db, redaction, logger } = options;
  const organizations = new Map<string, string>();
  const organizationOf = async (environmentId: string): Promise<string> => {
    let organizationId = organizations.get(environmentId);
    if (organizationId === undefined) {
      const environment = await getEnvironment(db, environmentId);
      if (environment === null) {
        throw new Error('retention: the inquiry environment is gone');
      }
      organizationId = environment.organizationId;
      organizations.set(environmentId, organizationId);
    }
    return organizationId;
  };
  const failed = new Set<string>();
  const done = new Set<string>();
  for (;;) {
    // Failed inquiries stay due; fetch past them so they never block the rest.
    const due = (await listInquiriesDueForRetention(db, { now, limit: limit + failed.size }))
      .filter((candidate) => !failed.has(candidate.id))
      .slice(0, limit);
    if (due.length === 0 || due.every((candidate) => done.has(candidate.id))) {
      return { redacted: done.size, failed: failed.size };
    }
    for (const { id, environmentId } of due) {
      try {
        const organizationId = await organizationOf(environmentId);
        await redaction.redactInquiry({ organizationId, environmentId }, id, null);
        done.add(id);
      } catch (error) {
        failed.add(id);
        logger?.warn(
          { inquiryId: id, environmentId, error: (error as Error).name },
          'retention could not redact an inquiry',
        );
      }
    }
  }
}

/** What {@link redactDueObjects} needs of a kind of object that retention redacts on its own. */
interface RetainedKind {
  noun: 'report' | 'transaction';
  listDue: (db: Db, options: { now: Date; limit: number }) => Promise<RetentionCandidate[]>;
  redact: (redaction: RedactionService, ctx: ServiceContext, id: string) => Promise<unknown>;
}

const RETAINED_REPORTS: RetainedKind = {
  noun: 'report',
  listDue: listReportsDueForRetention,
  redact: (redaction, ctx, id) => redaction.redactReport(ctx, id, null),
};

const RETAINED_TRANSACTIONS: RetainedKind = {
  noun: 'transaction',
  listDue: listTransactionsDueForRetention,
  redact: (redaction, ctx, id) => redaction.redactTransaction(ctx, id, null),
};

/**
 * C73.6 (P14), C105.5: redacts the reports or transactions due for retention; how many were redacted
 * and failed.
 */
async function redactDueObjects(
  kind: RetainedKind,
  options: RetentionOptions,
  now: Date,
  limit: number,
): Promise<{ redacted: number; failed: number }> {
  const { db, redaction, logger } = options;
  const organizations = new Map<string, string>();
  const failed = new Set<string>();
  const done = new Set<string>();
  for (;;) {
    // Failed ones stay due; fetch past them so they never block the rest.
    const due = (await kind.listDue(db, { now, limit: limit + failed.size }))
      .filter((candidate) => !failed.has(candidate.id))
      .slice(0, limit);
    if (due.length === 0 || due.every((candidate) => done.has(candidate.id))) {
      return { redacted: done.size, failed: failed.size };
    }
    for (const { id, environmentId } of due) {
      try {
        let organizationId = organizations.get(environmentId);
        if (organizationId === undefined) {
          const environment = await getEnvironment(db, environmentId);
          if (environment === null) {
            throw new Error(`retention: the ${kind.noun} environment is gone`);
          }
          organizationId = environment.organizationId;
          organizations.set(environmentId, organizationId);
        }
        await kind.redact(redaction, { organizationId, environmentId }, id);
        done.add(id);
      } catch (error) {
        failed.add(id);
        logger?.warn(
          { [`${kind.noun}Id`]: id, environmentId, error: (error as Error).name },
          `retention could not redact a ${kind.noun}`,
        );
      }
    }
  }
}

/**
 * Whether a run left PII it should have removed: an inquiry it could not redact, or a file of
 * a redacted inquiry it could not delete. The job then fails (BullMQ records and retries it)
 * and `retention:run` exits non-zero, so the failure is seen, not only logged (2B F031).
 */
export function isRetentionIncomplete(report: RetentionReport): boolean {
  return (
    report.failedRedactions > 0 ||
    report.failedReportRedactions > 0 ||
    report.failedTransactionRedactions > 0 ||
    report.failedPurges > 0
  );
}

/** A run that left PII behind (see {@link isRetentionIncomplete}); counts only. */
export class RetentionIncompleteError extends Error {
  override name = 'RetentionIncompleteError';

  constructor(report: RetentionReport) {
    super(
      `The retention run could not redact ${String(report.failedRedactions)} inquiries and ` +
        `could not delete ${String(report.failedPurges)} files; the next run retries them.`,
    );
  }
}

/** One C16 retention run. See the module comment. */
export async function runRetention(options: RetentionOptions): Promise<RetentionReport> {
  const { db, storage } = options;
  const clock = options.clock ?? systemClock;
  const events = options.events ?? createOutboxOnlyPublisher(db);
  const now = clock.now();
  const limit = options.batchSize ?? DEFAULT_SWEEP_LIMIT;
  // C253.4 (Workflow 11B Stage 1b (D), `foundation-11b`'s hook): first, the access exports past
  // `account-export-ttl-days` expire and their manifests go (`dsar-export`'s account-export/hooks.ts);
  // an export listing an item the pass then redacts goes with that item's cascade.
  const accountExportRetention = await accountExportHooks.retention(
    { db, storage },
    { now, limit },
  );
  const inquiries = await redactDueInquiries(options, now, limit);
  const reports = await redactDueObjects(RETAINED_REPORTS, options, now, limit);
  const transactions = await redactDueObjects(RETAINED_TRANSACTIONS, options, now, limit);
  const batch = { now, limit };
  const unpurged = new Set<string>();
  const purgedFiles = await purgeRedactedFiles({
    db,
    storage,
    clock,
    limit,
    onFailure: (fileId) => unpurged.add(fileId),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });
  // C105.5: the objects a transaction's redaction could not delete; a failure is a failed purge.
  const purgedTransactionFiles = await purgeRedactedTransactionFiles({
    db,
    storage,
    clock,
    limit,
    onFailure: (fileId) => unpurged.add(fileId),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });
  // C135.3 (Workflow 8B (F); `api-case-files`): beside the leftover files, the rendition pages a
  // failed delete left or whose source row is gone, with their own count.
  const purgedRenditionPages = await purgeDiscardedRenditions({
    db,
    storage,
    clock,
    limit,
    logger: options.logger,
  });
  const faceData = await drainFaceData(db, batch);
  const workflowRetention = await runWorkflowRetention({ db, storage }, batch);
  // C139.3, C134.4 (Workflow 8B): the case steps, `api-cases`'.
  const caseRetention = await runCaseRetention({ db, storage, events }, batch);
  // C138.1, C143.1 (Workflow 8B (F)): export files past their 24 hours, `api-case-files`'.
  const exportRetention = await runCaseExportRetention({ db, storage }, batch);
  // C163.6 (Workflow 9B Stage 1b (A); review P20): the rollups past `analytics-retention-months` and
  // the assignee rollup past `analytics-assignee-retention-months`, `api-analytics`'.
  const analyticsRetention = await runAnalyticsRetention({ db }, batch);
  // C168.6 (Workflow 9B Stage 1b (U)): audit entries past `audit-log-retention-days`, with their
  // address index rows, `api-access`'s.
  const auditLogRetention = await runAuditLogRetention({ db }, batch);
  // C166.1, C166.5 (Workflow 9B Stage 1b (X)): export files past their 24 hours and the CSVs of
  // ended or day-old bulk report jobs, `api-exports`'.
  const dataExportRetention = await runExportRetention({ db, storage }, batch);
  // C241.3, C241.4 (Workflow 11A Stage 1b (K), `foundation-11a`'s hook): Connect's tokens, consent
  // records and texts past their terms (`api-consent`'s connect/retention.ts).
  const connectRetention = await runConnectRetention({ db, clock, now, batch });
  const report: RetentionReport = {
    redactedInquiries: inquiries.redacted,
    failedRedactions: inquiries.failed,
    redactedReports: reports.redacted,
    failedReportRedactions: reports.failed,
    purgedFiles,
    failedPurges: unpurged.size,
    deletedApiLogs: await drain((o) => deleteExpiredApiLogs(db, o), batch),
    deletedWebhookDeliveries: await drain((o) => deleteExpiredWebhookDeliveries(db, o), batch),
    deletedIdempotencyKeys: await drain((o) => deleteExpiredIdempotencyKeys(db, o), batch),
    deletedEvents: await drain((o) => deleteExpiredEvents(db, o), batch),
    deletedUserSessions: await drain((o) => deleteExpiredUserSessions(db, o), batch),
    deletedOneTimeLinks: await drain((o) => deleteExpiredOneTimeLinks(db, o), batch),
    deletedAuthChallenges: await deleteExpiredAuthChallenges(db, { now }),
    deletedFaceTemplates: faceData.templates,
    deletedSelfieBackgrounds: faceData.backgrounds,
    // C91.7 (Workflow 7A): the collector components, the addresses and the devices.
    nulledSignalComponents: await drain((o) => nullExpiredSignalComponents(db, o), batch),
    nulledAddresses: await drainAddresses(db, batch),
    deletedDevices: await drain((o) => deleteExpiredDevices(db, o), batch),
    // C98.4, C100.2 (Workflow 7B): list items past their retention, and imported objects.
    redactedListItems: await drain(async (o) => {
      const staged: StagedEvent[] = [];
      const count = await redactExpiredListItems(db, {
        ...o,
        deleteObjects: async (keys) => {
          await Promise.all(keys.map((key) => storage.delete(key)));
        },
        // C127.12, C128.1 (F20, V25): in each batch's transaction.
        onRedacted: async (tx, environmentId, redaction) => {
          staged.push(
            ...(await afterListItemsRedactedInTx(tx, { events }, environmentId, redaction, now)),
          );
        },
      });
      await events.dispatch(staged);
      return count;
    }, batch),
    purgedImportObjects: await drain((o) => purgeExpiredImportObjects({ db, storage }, o), batch),
    // C96.2 (Workflow 7A, P27): handoff tokens, as one-time links.
    deletedHandoffTokens: await drain((o) => deleteExpiredHandoffTokens(db, o), batch),
    // C174.3 (Workflow 9A Stage 1b (S)): the flow records a redacted inquiry still holds (its
    // redaction deletes them; this catches a race), so they follow their inquiry's retention.
    cleanedFlowRecordInquiries: await drain(
      (o) => deleteFlowRecordsOfRedactedInquiries(db, o),
      batch,
    ),
    // C221.3 (Workflow 10B Stage 1b (I)): integrity challenges a day past their expiry, with any
    // token still sealed in them, and the records a redacted inquiry still holds (a race).
    deletedIntegrityChallenges: await drain((o) => deleteExpiredIntegrityChallenges(db, o), batch),
    cleanedIntegrityRecordInquiries: await drain(
      (o) => deleteIntegrityRecordsOfRedactedInquiries(db, o),
      batch,
    ),
    // C248.4 (Workflow 11B, sso-oidc's borrowed edit; amendment 11): the single-use SSO sign-in
    // attempts, a day past their 10-minute expiry.
    deletedSsoLoginStates: await drain(
      (o) =>
        deleteExpiredSsoLoginStates(
          db,
          new Date((o.now ?? now).getTime() - SSO_LOGIN_STATE_GRACE_MS),
          o.limit,
        ),
      batch,
    ),
    // C105.5 (Workflow 7B).
    redactedTransactions: transactions.redacted,
    failedTransactionRedactions: transactions.failed,
    purgedTransactionFiles,
    // C102.7 (Workflow 7B): stored graph query results past their window (default 30 days).
    redactedGraphQueries: await drain((o) => redactExpiredGraphQueries(db, o), batch),
    // C120.8, C118.1 (Workflow 8A).
    ...workflowRetention,
    // C139.3, C134.4 (Workflow 8B).
    ...caseRetention,
    // C135.3, C138.1 (Workflow 8B (F)).
    purgedRenditionPages,
    ...exportRetention,
    // C163.6 (Workflow 9B).
    ...analyticsRetention,
    // C168.6 (Workflow 9B).
    ...auditLogRetention,
    // C166.1, C166.5 (Workflow 9B).
    ...dataExportRetention,
    // C241.3, C241.4 (Workflow 11A).
    ...connectRetention,
    // C253.4 (Workflow 11B).
    ...accountExportRetention,
  };
  options.logger?.info({ ...report }, 'retention run finished');
  return report;
}
