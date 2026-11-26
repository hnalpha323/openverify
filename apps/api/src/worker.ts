/**
 * The background worker process (`pnpm --filter @openverify/api dev:worker`). It runs two
 * BullMQ workers over the Redis protocol (Valkey):
 *
 * - `process-verification`: decrypts the files, calls vision, evaluates the checks, decides
 *   the verification and settles the inquiry (`processVerification`). Transient failures
 *   such as a vision outage are retried with backoff; the job is told when it runs its last
 *   attempt, so a vision or provider failure is then recorded on its checks (C30.3). When the
 *   job fails for good otherwise (a permanent failure, or the last attempt of another transient
 *   one), the verification is failed and its inquiry settled (`failVerificationAfterError`),
 *   because nothing would ever enqueue it again. The job gets the blind index key (C31.8) and
 *   the providers bound per environment kind (C35) from the configuration.
 * - `webhook-delivery`: one signed delivery attempt per job (`deliverWebhook`), through the
 *   SSRF-guarded sender; plus a periodic sweep that re-enqueues overdue deliveries.
 * - repeatable jobs, each on its own queue with a BullMQ job scheduler and one job at a time
 *   per process: `inquiry-expiry` every 60 seconds (C10, `runInquiryExpiry`), then the Phase 5
 *   jobs (`jobs/repeatable/index.ts`: the repair sweep of verifications left `submitted`, every
 *   minute; the malicious-feed refresh for a `feed-list` binding with a feed, the trust-store
 *   refresh with `OPENVERIFY_TRUST_ANCHOR_REFRESH=true`), then the Phase 6 `report-sweep` every
 *   15 seconds and, with `OPENVERIFY_WATCHLIST_REFRESH=true`, the 15-minute `watchlists-refresh`;
 *   then, with `OPENVERIFY_NETWORK_REFRESH=true`, the 15-minute `network-refresh` (Phase 7).
 * - `report-run` and `report-rescreen` (Phase 6, C74): the report run framework and the re-screen
 *   after a list update; their jobs are removed when they finish (`jobs/report-queues.ts`).
 *
 * Shutdown closes every worker, then every queue, and keeps going when one of them fails to
 * close: each failure is logged (Workflow 1B finding F015).
 *
 * Logs carry ids, statuses and error classes; never images, embeddings, secrets or bodies. A
 * failed job is logged and handed to BullMQ described by its class and code, never by its message,
 * which can hold a query's parameters (`describeJobError`, Workflow 4B review H001).
 */
import { pathToFileURL } from 'node:url';
import {
  createDatabase,
  setDefaultKeyring,
  useAuditIpIndexKey,
  type Db,
  type Keyring,
} from '@openverify/db';
import {
  Queue,
  UnrecoverableError,
  Worker,
  type ConnectionOptions,
  type WorkerOptions,
} from 'bullmq';
import { Pool } from 'pg';
import {
  loadConfig,
  type AppMode,
  type WorkflowCodeRunnerSetting,
  type NetworkSettings,
  type NfcSettings,
  type ReportLimits,
  type WatchlistSettings,
  type ApiConfig,
} from './config.js';
// foundation-11b: begin (Workflow 11B Stage 1b common; review F30)
import { logStartupWarnings } from './config/startup-warnings.js';
import { applyStoreTls } from './config/store-tls.js';
import { drainWorkers } from './worker-health/drain.js';
import { startWorkerHeartbeat } from './worker-health/heartbeat.js';
// foundation-11b: end
import { createEventPublisher, type TransactionalEventPublisher } from './events/index.js';
import { createCacheRedis, createKeyValueCache } from './cache/index.js';
import { createDnsResolver } from './dns/index.js';
import { createOutboundHttp, type OutboundHttp } from './http/index.js';
import { createVerificationQueue, PROCESS_VERIFICATION_QUEUE } from './jobs/index.js';
import {
  installQueueLimitsOf,
  withReportRunAdmission,
  withVerificationAdmission,
} from './jobs/admitted-producers.js';
import type { InstallQueueLimits } from './services/quotas/caps.js';
import {
  createQuotaAdmissionDeps,
  quotaQueuePasses,
  type QuotaProducers,
} from './services/quotas/queue-rows.js';
import { quotaRepeatableJobs } from './jobs/quota-sweep.js';
import {
  WORKFLOW_STEP_BATCH_QUEUE,
  WORKFLOW_STEP_QUEUE,
  WORKFLOW_TRIGGER_QUEUE,
  WORKFLOW_WAIT_MATCH_QUEUE,
  createWorkflowStepQueue,
  createWorkflowTriggerQueue,
  createWorkflowWaitMatchQueue,
} from './jobs/workflow-queues.js';
import { LIST_RESCREEN_QUEUE, createListRescreenQueue } from './jobs/list-rescreen-queue.js';
import {
  INQUIRY_EXPIRY_INTERVAL_MS,
  INQUIRY_EXPIRY_QUEUE,
  runInquiryExpiry,
  type InquiryExpiryResult,
} from './jobs/inquiry-expiry.js';
import { describeJobError, withoutJobData } from './jobs/error-description.js';
import { createWorkerLogger, type WorkerLogger } from './jobs/logger.js';
import {
  failVerificationAfterError,
  isPermanentJobFailure,
  processVerification,
  type ProcessVerificationDeps,
  type ProcessVerificationResult,
} from './jobs/process-verification.js';
import { createBullQueue, type JobQueue } from './jobs/queue.js';
import {
  phase5RepeatableJobs,
  phase6RepeatableJobs,
  phase7RepeatableJobs,
  caseRepeatableJobs,
  webhookAlertRepeatableJobs,
  phase8RepeatableJobs,
  phase9RepeatableJobs,
  analyticsRepeatableJobs,
  exportRepeatableJobs,
} from './jobs/repeatable/index.js';
import {
  processReportRun,
  type ProcessReportRun,
  type ReportRunProcessResult,
  type ReportRunProcessorDeps,
} from './jobs/reports/run.js';
import {
  processReportRescreen,
  type ProcessReportRescreen,
  type ReportRescreenDeps,
  type ReportRescreenResult,
} from './jobs/reports/rescreen.js';
import {
  createReportRescreenQueue,
  createReportRunQueue,
  REPORT_RESCREEN_QUEUE,
  REPORT_RUN_QUEUE,
} from './jobs/report-queues.js';
import { createInquirySignalsQueue, INQUIRY_SIGNALS_QUEUE } from './jobs/signal-queues.js';
import { createIntegrityDecodeQueue, INTEGRITY_DECODE_QUEUE } from './jobs/integrity-queues.js';
import {
  ACCOUNT_EXPORT_QUEUE,
  createAccountExportQueue,
  type AccountExportJob,
} from './jobs/account-export-queues.js';
import { processAccountExport, type ProcessAccountExport } from './jobs/account-export/process.js';
import {
  CONNECT_REDEEM_QUEUE,
  createConnectRedeemQueue,
  connectRepeatableJobs,
  type ConnectRedeemJob,
} from './jobs/connect-queues.js';
import {
  processConnectRedeem,
  type ConnectRedeemResult,
  type ProcessConnectRedeem,
} from './jobs/connect-redeem/process.js';
import type { RunConnectTokenExpiry } from './jobs/connect-token-expiry.js';
import { createFlowSignalSnapshotQueue, FLOW_SIGNAL_SNAPSHOT_QUEUE } from './jobs/flow-queues.js';
import { createAnalyticsRebuildQueue, ANALYTICS_REBUILD_QUEUE } from './jobs/analytics-queues.js';
import {
  processAnalyticsRebuild,
  type AnalyticsRebuildDeps,
  type AnalyticsRebuildResult,
  type ProcessAnalyticsRebuild,
} from './jobs/analytics/rebuild.js';
import {
  createExportQueue,
  createReportBulkQueue,
  EXPORT_QUEUE,
  REPORT_BULK_QUEUE,
} from './jobs/export-queues.js';
import { processExport, type ExportJobDeps, type ProcessExport } from './jobs/exports/export.js';
import type { RunExportSweep } from './jobs/exports/sweep.js';
import {
  processReportBulk,
  type ProcessReportBulk,
  type ReportBulkJobDeps,
} from './jobs/reports/report-bulk.js';
import type { RunAnalyticsRollup } from './jobs/analytics/rollup.js';
import type { RunWebhookFailureAlerts } from './jobs/repeatable/webhook-alerts.js';
import {
  processFlowSignalSnapshot,
  type FlowSignalSnapshotDeps,
  type FlowSignalSnapshotResult,
  type ProcessFlowSignalSnapshot,
} from './jobs/flow/signal-snapshot.js';
import {
  processIntegrityDecode,
  type IntegrityDecodeDeps,
  type IntegrityDecodeResult,
  type ProcessIntegrityDecode,
} from './jobs/integrity/decode.js';
import {
  processInquirySignals,
  type InquirySignalsDeps,
  type InquirySignalsResult,
  type ProcessInquirySignals,
} from './jobs/signals/process.js';
import {
  processListImport,
  type ListImportDeps,
  type ProcessListImport,
} from './jobs/importers/process.js';
import {
  processListItemEmbed,
  type ListItemEmbedDeps,
  type ProcessListItemEmbed,
} from './jobs/lists/embed.js';
import {
  processListScreen,
  type ListScreenDeps,
  type ProcessListScreen,
} from './jobs/lists/screen.js';
import {
  processGraphIndex,
  type GraphIndexDeps,
  type ProcessGraphIndex,
} from './jobs/graph/index-job.js';
import {
  processGraphQuery,
  type GraphQueryDeps,
  type ProcessGraphQuery,
} from './jobs/graph/query.js';
import {
  GRAPH_INDEX_QUEUE,
  GRAPH_QUERY_QUEUE,
  createGraphIndexQueue,
  createGraphQueryQueue,
} from './jobs/graph-queues.js';
import {
  LIST_IMPORT_QUEUE,
  LIST_ITEM_EMBED_QUEUE,
  LIST_SCREEN_QUEUE,
  createListImportQueue,
  createListItemEmbedQueue,
  createListScreenQueue,
} from './jobs/list-queues.js';
import { createBiometricListMatcher } from './services/lists/biometric/matcher.js';
import { useGraphIndexKey } from './services/graph/keys.js';
import { processListRescreen, type ListRescreenDeps } from './jobs/reports/list-rescreen.js';
import { processWorkflowStep } from './jobs/workflows/step.js';
import { CASE_BULK_QUEUE, createCaseBulkQueue } from './jobs/case-bulk-queue.js';
import { createMailer } from './mail/index.js';
import {
  processCaseBulkAction,
  type CaseBulkDeps,
  type ProcessCaseBulkAction,
} from './services/cases/bulk/process.js';
import {
  processCaseAttachmentScan,
  processCaseExport,
  processCaseRendition,
  type CaseFileJobDeps,
  type ProcessCaseAttachmentScan,
  type ProcessCaseExport,
  type ProcessCaseRendition,
} from './jobs/cases/index.js';
import {
  CASE_ATTACHMENT_SCAN_QUEUE,
  CASE_EXPORT_QUEUE,
  CASE_RENDITION_QUEUE,
  createCaseAttachmentScanQueue,
  createCaseExportQueue,
  createCaseRenditionQueue,
} from './jobs/case-file-queues.js';
import { processWorkflowWaitMatch } from './jobs/workflows/wait-match.js';
import { checkValkeyEvictionPolicy } from './workflows/engine/valkey-check.js';
import { egressConfigOf } from './workflows/actions/https/egress-config.js';
import { createWorkflowServices, type WorkflowServices } from './workflows/services.js';
import { processWorkflowTrigger } from './workflows/triggers/deliver.js';
import type { WorkflowWorkerDeps } from './workflows/worker.js';
import { createCompromisedIdLookup } from './services/lists/compromised-ids.js';
import { createListItemWriter, unbuiltListItemWriter } from './services/lists/item-writer.js';
import { reconcileWatchlistSources } from './watchlists/reconcile.js';
import { watchlistReconcileOptIn } from './watchlists/un-opt-in.js';
import { reconcileNetworkSources } from './network/reconcile.js';
import { createNetworkSnapshots } from './network/snapshots.js';
import { loadMatcherData, type MatcherData } from './watchlists/matcher-data.js';
// api-lifecycle: begin
import { startRetentionJob } from './jobs/retention.js';
// api-lifecycle: end
import { workerSettingsFromEnv } from './jobs/worker-config.js';
import {
  closeRateLimitRedis,
  createRateLimiter,
  createRateLimitRedis,
} from './rate-limit/index.js';
import {
  systemClock,
  ulidIdGenerator,
  type Clock,
  type DnsResolver,
  type FileStorage,
  type GraphIndexQueue,
  type GraphQueryQueue,
  type WorkflowStepQueue,
  type ListRescreenQueue,
  type WorkflowTriggerQueue,
  type WorkflowWaitMatchQueue,
  type CaseAttachmentScanQueue,
  type CaseBulkQueue,
  type CaseExportQueue,
  type CaseRenditionQueue,
  type InquirySignalsJob,
  type FlowSignalSnapshotJob,
  type FlowSignalSnapshotQueue,
  type IntegrityDecodeJob,
  type AnalyticsRebuildJob,
  type AnalyticsRebuildQueue,
  type ExportQueue,
  type ReportBulkQueue,
  type InquirySignalsQueue,
  type KeyValueCache,
  type ListImportQueue,
  type Mailer,
  type ListItemEmbedQueue,
  type ListItemWriter,
  type ListScreenQueue,
  type ManagedNetworkSnapshots,
  type NetworkSnapshots,
  type ProcessVerificationJob,
  type ProviderBindings,
  type RateLimiter,
  type ReportRescreenJob,
  type ReportRescreenQueue,
  type ReportRunJob,
  type ReportRunQueue,
  type VerificationQueue,
  type VisionClient,
} from './ports.js';
import { logPoolErrors } from './pool-errors.js';
import {
  bindsMaliciousFeedList,
  createProviderBindings,
  type ProviderBindingOptions,
} from './providers/index.js';
import {
  defaultMaliciousFeedListPath,
  loadMaliciousFeedList,
  type MaliciousFeedList,
} from './providers/malicious-website/feed-list.js';
import { createFileStorage } from './storage/index.js';
import { nfcSelfTest } from './jobs/types/government-id-nfc.js';
import { createVisionClient } from './vision/index.js';
import {
  deliverWebhook,
  sweepDueWebhookDeliveries,
  type DeliverWebhookDeps,
  type DeliveryResult,
  type WebhookRetryPolicy,
} from './webhooks/dispatcher.js';
import type { ApiDependencies } from './services/context.js';
import { createGuardedWebhookSender, type WebhookSender } from './webhooks/http-sender.js';
import {
  WEBHOOK_DELIVERY_QUEUE,
  createWebhookDeliveryScheduler,
  type WebhookDeliveryJob,
} from './webhooks/queue.js';

/**
 * C76.4 (V01): reconciles the watchlist source rows before the jobs start, logging counts only; a
 * failure is logged and the worker starts all the same (the next start reconciles again).
 */
export async function reconcileWatchlistSourcesAtStart(
  db: Db,
  disabled: readonly string[],
  logger: Pick<WorkerLogger, 'info' | 'error'>,
  /** C254.1 (Q10 granted; KP11-31): `OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED`. */
  unOptInAllowed = false,
): Promise<void> {
  try {
    const result = await reconcileWatchlistSources(db, {
      disabled,
      ...(await watchlistReconcileOptIn(db, unOptInAllowed)),
    });
    logger.info({ ...result }, 'watchlist sources reconciled');
  } catch (error) {
    logger.error({ error: (error as Error).name }, 'watchlist sources not reconciled');
  }
}

/**
 * C92.3, C92.5 (Workflow 7A, F41): reconciles the network source rows, then starts the worker's
 * network snapshots, before the jobs start; each failure is logged by its name and the worker
 * starts all the same (a report run then reads the sources as unavailable).
 */
export async function startNetworkDataAtStart(
  db: Db,
  settings: Pick<NetworkSettings, 'sourcesDisabled' | 'sourcesEnabled'>,
  snapshots: ManagedNetworkSnapshots,
  logger: Pick<WorkerLogger, 'info' | 'error'>,
  clock: Clock,
): Promise<void> {
  try {
    const result = await reconcileNetworkSources(db, {
      sourcesDisabled: settings.sourcesDisabled,
      sourcesEnabled: settings.sourcesEnabled,
      clock,
    });
    logger.info({ ...result }, 'network sources reconciled');
  } catch (error) {
    logger.error({ error: (error as Error).name }, 'network sources not reconciled');
  }
  try {
    await snapshots.start();
  } catch (error) {
    logger.error({ error: (error as Error).name }, 'network snapshots not loaded');
  }
}

/**
 * C78.3 (F14): says once, at worker start, whether the filtered variant groups loaded; without
 * them person-name report runs end `errored` with `matcher_data_unavailable` (never a "no
 * match"), and the sync refuses with `refused_matcher_data`. Loading here also keeps the first
 * report run from paying for it.
 */
/**
 * C123.3 (P17): the in-worker pool shares the worker's network namespace, because Node's permission
 * model has no network permission. So a production worker on the pool says so, once.
 */
/** C63: the worker's providers, from its own settings and what `main` holds. */
export function workerProviderBindings(
  config: ApiConfig,
  infra: Pick<ProviderBindingOptions, 'maliciousFeeds' | 'outboundHttp' | 'cache' | 'rateLimiter'>,
): ProviderBindings {
  return createProviderBindings(config.providers, {
    // C126.6, decision 76: workflow messages go out from the worker.
    twilio: config.twilio,
    evmRpc: config.evmRpc,
    // C61.1, C61.5: the registers' credentials and the feed list, read by the worker only.
    companiesHouse: config.companiesHouse,
    secEdgar: config.secEdgar,
    // C83: the report providers' acknowledgement and credentials, read by the worker only.
    reportProviders: config.reportProviders,
    // C93.5 (Workflow 7A): the ip-address report's ipReputation file.
    ipReputation: { mmdbPath: config.network.ipReputationMmdbPath },
    // C135.5 (Workflow 8B): clamd's socket, while attachmentScanner is bound to clamd.
    clamdSocket: config.clamdSocket,
    // C211.4 (Workflow 10B): the play-integrity decode's settings, while it is bound.
    playIntegrity: config.playIntegrity,
    ...infra,
  });
}

export function logWorkflowCodeRunnerAtStart(
  mode: AppMode,
  runner: WorkflowCodeRunnerSetting,
  logger: Pick<WorkerLogger, 'warn'>,
): void {
  if (mode === 'production' && runner.kind === 'pool') {
    logger.warn(
      {},
      'Evaluate Code runs in the worker’s pool, with no network isolation: set ' +
        'OPENVERIFY_WORKFLOW_CODE_RUNNER=socket:<path> and run the code-runner service',
    );
  }
}

/** C117.10 (decision 18): the check runs at start, and never refuses to start. */
export async function checkValkeyAtStart(
  check: () => Promise<void>,
  logger: Pick<WorkerLogger, 'error'>,
): Promise<void> {
  try {
    await check();
  } catch (error) {
    logger.error({ error: (error as Error).name }, 'Valkey eviction policy not checked');
  }
}

export function logMatcherDataAtStart(
  load: () => MatcherData,
  logger: Pick<WorkerLogger, 'info' | 'warn'>,
): void {
  const data = load();
  if (data.status === 'loaded') {
    logger.info({ keysVersion: data.keysVersion }, 'variant groups loaded');
    return;
  }
  logger.warn(
    { matcherData: data.status },
    'variant groups not loaded: person-name reports error matcher_data_unavailable until ' +
      'python3 scripts/fetch_data.py and pnpm --filter @openverify/watchlist build:variant-groups run',
  );
}

/** The part of a BullMQ job a processor reads. */
export interface ProcessorJob<Data> {
  id?: string | undefined;
  data: Data;
  /** Attempts that failed before this one (BullMQ's `attemptsMade`). */
  attemptsMade?: number | undefined;
  opts?: { attempts?: number | undefined } | undefined;
}

/** Whether BullMQ will not retry this attempt if it fails (its `shouldRetryJob` rule). */
function isLastAttempt(job: ProcessorJob<unknown>): boolean {
  return (job.attemptsMade ?? 0) + 1 >= (job.opts?.attempts ?? 1);
}

export type WorkerProcessor<Data = unknown> = (job: ProcessorJob<Data>) => Promise<unknown>;

/** The part of a BullMQ job the `failed` listener reads. */
interface FailedJob {
  id?: string | undefined;
  attemptsMade: number;
  opts: { attempts?: number | undefined };
}

/** The part of a BullMQ `Worker` the process uses, so tests can start fakes. */
export interface FakeableWorker {
  on(event: 'failed', listener: (job: FailedJob | undefined, error: Error) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  close(): Promise<void>;
}

export type WorkerFactory = <Data>(
  name: string,
  processor: WorkerProcessor<Data>,
  options: WorkerOptions,
) => FakeableWorker;

export type QueueFactory = (
  name: string,
  options: { connection: ConnectionOptions; prefix?: string | undefined },
) => JobQueue<WebhookDeliveryJob>;

/** How often a repeatable job runs: every `every` milliseconds, or on a cron `pattern`. */
export type RepeatSchedule = { every: number } | { pattern: string };

/** The part of a BullMQ `Queue` that schedules repeatable jobs. */
export interface RepeatableQueue {
  upsertJobScheduler(
    id: string,
    repeat: RepeatSchedule,
    template: { name: string },
  ): Promise<unknown>;
  close(): Promise<void>;
}

export type RepeatableQueueFactory = (
  name: string,
  options: { connection: ConnectionOptions; prefix?: string | undefined },
) => RepeatableQueue;

/**
 * A job BullMQ runs on a schedule. Its name is also its queue's and its scheduler's, so a
 * restart upserts the same scheduler instead of adding another.
 */
export interface RepeatableJob {
  name: string;
  repeat: RepeatSchedule;
  run(): Promise<unknown>;
}

export interface VerificationProcessorDeps extends ProcessVerificationDeps {
  /** Replaces `processVerification`, for tests. */
  process?: typeof processVerification;
}

/**
 * The `process-verification` processor. Permanent failures become BullMQ's
 * `UnrecoverableError` (no retry); anything else is rethrown for a retry with backoff. Before
 * a job fails for good (a permanent failure, or the last attempt), the verification is failed
 * so it does not stay `submitted`. If that write fails transiently, its error is thrown
 * instead, so BullMQ retries while attempts remain.
 */
export function processVerificationProcessor(
  deps: VerificationProcessorDeps,
): (job: ProcessorJob<ProcessVerificationJob>) => Promise<ProcessVerificationResult> {
  const process = deps.process ?? processVerification;
  return async (job) => {
    try {
      return await process(job.data, deps, { lastAttempt: isLastAttempt(job) });
    } catch (error) {
      const permanent = isPermanentJobFailure(error);
      if (permanent || isLastAttempt(job)) {
        await failVerificationAfterError(
          job.data,
          deps,
          permanent ? describeJobError(error) : (error as Error).name,
        );
      }
      if (permanent) {
        throw new UnrecoverableError(describeJobError(error));
      }
      throw error;
    }
  };
}

/** The `report-run` processor's deps, and a replacement of the framework for tests. */
export interface ReportRunWorkerDeps extends ReportRunProcessorDeps {
  process?: ProcessReportRun | undefined;
}

/**
 * C74.1: the `report-run` processor. The framework (`processReportRun`, `api-reports`) claims,
 * runs, persists, releases and ends the run itself, told whether this is the job's last attempt;
 * a `PermanentJobError` it throws becomes BullMQ's `UnrecoverableError` (no retry).
 */
export function reportRunProcessor(
  deps: ReportRunWorkerDeps,
): (job: ProcessorJob<ReportRunJob>) => Promise<ReportRunProcessResult> {
  const process = deps.process ?? processReportRun;
  return async (job) => {
    try {
      return await process(job.data, deps, { lastAttempt: isLastAttempt(job) });
    } catch (error) {
      if (isPermanentJobFailure(error)) {
        throw new UnrecoverableError(describeJobError(error));
      }
      throw error;
    }
  };
}

/** The `report-rescreen` processor's deps, and a replacement of the re-screen for tests. */
export interface ReportRescreenWorkerDeps extends ReportRescreenDeps {
  process?: ProcessReportRescreen | undefined;
}

/** C74.4: the `report-rescreen` processor (`processReportRescreen`, `api-watchlists`). */
export function reportRescreenProcessor(
  deps: ReportRescreenWorkerDeps,
): (job: ProcessorJob<ReportRescreenJob>) => Promise<ReportRescreenResult> {
  const process = deps.process ?? processReportRescreen;
  return async (job) => {
    try {
      return await process(job.data, deps);
    } catch (error) {
      if (isPermanentJobFailure(error)) {
        throw new UnrecoverableError(describeJobError(error));
      }
      throw error;
    }
  };
}

/** C90.5 (Workflow 7A): the `inquiry-signals` processor's deps, and a replacement of the job. */
export interface InquirySignalsWorkerDeps extends InquirySignalsDeps {
  process?: ProcessInquirySignals | undefined;
}

/**
 * C90.5: the `inquiry-signals` processor (`processInquirySignals`, `api-signals`); a
 * `PermanentJobError` it throws becomes BullMQ's `UnrecoverableError` (no retry).
 */
export function inquirySignalsProcessor(
  deps: InquirySignalsWorkerDeps,
): (job: ProcessorJob<InquirySignalsJob>) => Promise<InquirySignalsResult> {
  const process = deps.process ?? processInquirySignals;
  return async (job) => {
    try {
      return await process(job.data, deps);
    } catch (error) {
      if (isPermanentJobFailure(error)) {
        throw new UnrecoverableError(describeJobError(error));
      }
      throw error;
    }
  };
}

/** C211.4 (Workflow 10B Stage 1b (I)): the `integrity-decode` processor's deps, and a replacement. */
export interface IntegrityDecodeWorkerDeps extends IntegrityDecodeDeps {
  process?: ProcessIntegrityDecode | undefined;
}

/**
 * C211.4: the `integrity-decode` processor (`processIntegrityDecode`, `api-integrity`); a
 * `PermanentJobError` it throws becomes BullMQ's `UnrecoverableError` (no retry).
 */
export function integrityDecodeProcessor(
  deps: IntegrityDecodeWorkerDeps,
): (job: ProcessorJob<IntegrityDecodeJob>) => Promise<IntegrityDecodeResult> {
  const process = deps.process ?? processIntegrityDecode;
  return async (job) => {
    try {
      return await process(job.data, deps);
    } catch (error) {
      if (isPermanentJobFailure(error)) {
        throw new UnrecoverableError(describeJobError(error));
      }
      throw error;
    }
  };
}

/** C150.9 (Workflow 9A Stage 1b (S)): the `flow-signal-snapshot` processor's deps. */
export interface FlowSignalSnapshotWorkerDeps extends FlowSignalSnapshotDeps {
  process?: ProcessFlowSignalSnapshot | undefined;
}

/**
 * C150.9: the `flow-signal-snapshot` processor (`processFlowSignalSnapshot`, `api-flow-actions`); a
 * `PermanentJobError` it throws becomes BullMQ's `UnrecoverableError` (no retry).
 */
export function flowSignalSnapshotProcessor(
  deps: FlowSignalSnapshotWorkerDeps,
): (job: ProcessorJob<FlowSignalSnapshotJob>) => Promise<FlowSignalSnapshotResult> {
  const process = deps.process ?? processFlowSignalSnapshot;
  return async (job) => {
    try {
      return await process(job.data, deps);
    } catch (error) {
      if (isPermanentJobFailure(error)) {
        throw new UnrecoverableError(describeJobError(error));
      }
      throw error;
    }
  };
}

/** C163.2 (Workflow 9B Stage 1b (A)): the `analytics-rebuild` processor's deps. */
export interface AnalyticsRebuildWorkerDeps extends AnalyticsRebuildDeps {
  process?: ProcessAnalyticsRebuild | undefined;
}

/**
 * C163.2: the `analytics-rebuild` processor (`processAnalyticsRebuild`, `api-analytics`); a
 * `PermanentJobError` it throws becomes BullMQ's `UnrecoverableError` (no retry).
 */
export function analyticsRebuildProcessor(
  deps: AnalyticsRebuildWorkerDeps,
): (job: ProcessorJob<AnalyticsRebuildJob>) => Promise<AnalyticsRebuildResult> {
  const process = deps.process ?? processAnalyticsRebuild;
  return async (job) => {
    try {
      return await process(job.data, deps);
    } catch (error) {
      if (isPermanentJobFailure(error)) {
        throw new UnrecoverableError(describeJobError(error));
      }
      throw error;
    }
  };
}

/**
 * A list job's processor (`list-screen`, `list-import`, `list-item-embed`): a `PermanentJobError`
 * becomes BullMQ's `UnrecoverableError` (no retry).
 */
export function listJobProcessor<Job, Deps, Result>(
  process: (job: Job, deps: Deps) => Promise<Result>,
  deps: Deps,
): (job: ProcessorJob<Job>) => Promise<Result> {
  return async (job) => {
    try {
      return await process(job.data, deps);
    } catch (error) {
      if (isPermanentJobFailure(error)) {
        throw new UnrecoverableError(describeJobError(error));
      }
      throw error;
    }
  };
}

/**
 * C90.5, C107.1, C107.2 (Workflow 7A): what the worker needs to compute signals. With it,
 * `startWorkers` starts the `inquiry-signals` worker and schedules the `inquiry-signals-sweep`.
 */
export interface WorkerSignalOptions {
  /** The `inquiry-signals` producer of the sweep (`jobs/signal-queues.ts`). */
  queue: InquirySignalsQueue;
  /** Replaces `processInquirySignals`, for tests. */
  process?: ProcessInquirySignals | undefined;
}

/**
 * C150.9, C152.2 (Workflow 9A Stage 1b (S)): what the worker needs to run the flow's jobs. With it,
 * `startWorkers` starts the `flow-signal-snapshot` worker (with the deps the `inquiry-signals`
 * processor receives) and schedules `flow-action-sweep`, and the verification job's engine can ask
 * for a branch's snapshot.
 */
/**
 * C211.4 (Workflow 10B Stage 1b (I)): with it, `startWorkers` starts the `integrity-decode` worker,
 * whose jobs read the bound `deviceIntegrity` providers and the outbound client.
 */
/**
 * C232.5 (Workflow 11A Stage 1b (C)): with it (Connect is on, `OPENVERIFY_CONNECT_ENABLED`),
 * `startWorkers` schedules the `connect-token-expiry` minute sweep.
 */
export interface WorkerConnectOptions {
  /** Replaces `runConnectTokenExpiry`, for tests. */
  runTokenExpiry?: RunConnectTokenExpiry | undefined;
  /** C234.2 (Stage 1b (R)): replaces `processConnectRedeem`, for tests. */
  processRedeem?: ProcessConnectRedeem | undefined;
}

/** C251.1 (Workflow 11B, `integration-11b`): the quota sweep's limits and unwrapped producers. */
export interface WorkerQuotaOptions {
  limits: InstallQueueLimits;
  producers: QuotaProducers;
}

/** C253.2 (Workflow 11B Stage 1b (D)): the `account-export` worker's options. */
export interface WorkerAccountExportOptions {
  /** Replaces `processAccountExport`, for tests. */
  process?: ProcessAccountExport | undefined;
}

export interface WorkerIntegrityOptions {
  /** Replaces `processIntegrityDecode`, for tests. */
  process?: ProcessIntegrityDecode | undefined;
}

export interface WorkerFlowOptions {
  /** The `flow-signal-snapshot` producer (`jobs/flow-queues.ts`). */
  signalSnapshots: FlowSignalSnapshotQueue;
  /** Replaces `processFlowSignalSnapshot`, for tests. */
  processSignalSnapshot?: ProcessFlowSignalSnapshot | undefined;
}

/**
 * C163.2, C163.4 (Workflow 9B Stage 1b (A)): what the worker needs to run analytics. With it,
 * `startWorkers` starts the `analytics-rebuild` worker and schedules `analytics-rollup`, whose passes
 * hold the rebuild producer.
 */
export interface WorkerAnalyticsOptions {
  /** The `analytics-rebuild` producer (`jobs/analytics-queues.ts`). */
  rebuilds: AnalyticsRebuildQueue;
  /** Replaces `processAnalyticsRebuild`, for tests. */
  processRebuild?: ProcessAnalyticsRebuild | undefined;
  /** Replaces `runAnalyticsRollup`, for tests. */
  runRollup?: RunAnalyticsRollup | undefined;
}

/**
 * C169.6, C174.3 (Workflow 9B Stage 1b (W)): what the worker needs to run the webhook failure alerts.
 * With it, `startWorkers` schedules `webhook-failure-alerts` every 60 seconds.
 */
export interface WorkerWebhookAlertOptions {
  /** The mailer of the link-only alert emails; without one, console notifications only. */
  mailer?: Mailer | undefined;
  /** The console's public URL the emails' links name. */
  dashboardPublicUrl?: string | undefined;
  /** Replaces `runWebhookFailureAlerts`, for tests. */
  runAlerts?: RunWebhookFailureAlerts | undefined;
}

/**
 * C166.1, C166.5, C174.3 (Workflow 9B Stage 1b (X)): what the worker needs to run exports and bulk
 * reports. With it, `startWorkers` starts the `export` and `report-bulk` workers and schedules
 * `export-sweep` every 60 seconds, which holds both producers.
 */
export interface WorkerExportOptions {
  /** The `export` producer (`jobs/export-queues.ts`). */
  exports: ExportQueue;
  /** The `report-bulk` producer (`jobs/export-queues.ts`). */
  reportBulk: ReportBulkQueue;
  /** Replaces `processExport`, for tests. */
  processExport?: ProcessExport | undefined;
  /** Replaces `processReportBulk`, for tests. */
  processReportBulk?: ProcessReportBulk | undefined;
  /** Replaces `runExportSweep`, for tests. */
  runSweep?: RunExportSweep | undefined;
}

/**
 * C99.4, C99.7, C100.2, C107.1, C107.2 (Workflow 7B): what the worker needs to run lists. With it,
 * `startWorkers` starts the `list-screen`, `list-import` and `list-item-embed` workers and schedules
 * their sweeps.
 */
/** C137.4, C135, C138, C143.2 (Workflow 8B): what the worker needs to run the case jobs. */
export interface WorkerCaseOptions {
  /**
   * C135.3 (V27): the `case-rendition` producer, through which the verification job asks for its
   * files' renditions after its commit (`requestRenditionsForFiles`); none asked for without it.
   */
  renditions?: CaseRenditionQueue | undefined;
  /** C137.4, C143.2: the `case-bulk` producer, through which `case-bulk-sweep` enqueues again. */
  bulk?: CaseBulkQueue | undefined;
  /**
   * K8-28 (Workflow 8D): the `case-export` and `case-attachment-scan` producers, through which
   * `case-export-sweep` enqueues again what was left unfinished (with `renditions`).
   */
  exports?: CaseExportQueue | undefined;
  scans?: CaseAttachmentScanQueue | undefined;
  /**
   * K8-20 (Workflow 8D; decision 76): the mailer of the link-only case emails, and the console's
   * public URL their links name (none: a message without its link).
   */
  mailer?: Mailer | undefined;
  dashboardPublicUrl?: string | undefined;
  /** Replace the jobs, for tests. */
  process?: {
    bulk?: ProcessCaseBulkAction | undefined;
    export?: ProcessCaseExport | undefined;
    scan?: ProcessCaseAttachmentScan | undefined;
    rendition?: ProcessCaseRendition | undefined;
  };
}

export interface WorkerListOptions {
  /** The producers of the sweeps (`jobs/list-queues.ts`). */
  screens: ListScreenQueue;
  imports: ListImportQueue;
  embeds: ListItemEmbedQueue;
  /** C127.12: `list-rescreen` and its sweep run with the lists, and need no workflow. */
  rescreens?: ListRescreenQueue | undefined;
  /** Replace the jobs, for tests. */
  process?: {
    screen?: ProcessListScreen | undefined;
    import?: ProcessListImport | undefined;
    embed?: ProcessListItemEmbed | undefined;
    rescreen?: typeof processListRescreen | undefined;
  };
  /** Replaces the writer the import job uses, for tests. */
  writer?: ListItemWriter | undefined;
}

/**
 * C101.3, C101.5, C101.6, C102.4, C107.1, C107.2 (Workflow 7B): what the worker needs to run the
 * graph. With it, `startWorkers` starts the `graph-index` and `graph-query` workers and schedules
 * the `graph-index-sweep`, `graph-query-sweep`, `graph-backfill` and `graph-components` jobs.
 */
export interface WorkerGraphOptions {
  /** The producers of the sweeps (`jobs/graph-queues.ts`). */
  index: GraphIndexQueue;
  queries: GraphQueryQueue;
  /** `OPENVERIFY_DASHBOARD_PUBLIC_URL`, resolved: the base of a query's `explorer-url`. */
  dashboardPublicUrl?: string | undefined;
  /** Replace the jobs, for tests. */
  process?: {
    index?: ProcessGraphIndex | undefined;
    query?: ProcessGraphQuery | undefined;
  };
}

/**
 * C117, C118.1, C119.3, C143.1, C143.2 (Workflow 8A): what the worker needs to run the engine. With
 * it, `startWorkers` starts the `workflow-step`, `workflow-step-batch`, `workflow-trigger` and
 * `workflow-wait-match` workers, gives the event publisher its schedulers, schedules the engine's
 * sweeps and builds the services once.
 */
export interface WorkerWorkflowOptions {
  /** Called once with the worker's publisher (F11): `createWorkflowServices`. */
  createServices: (events: TransactionalEventPublisher) => WorkflowServices;
  steps: WorkflowStepQueue;
  triggers: WorkflowTriggerQueue;
  waitMatches: WorkflowWaitMatchQueue;
  /** C117.8: `OPENVERIFY_WORKFLOW_IN_FLIGHT_CAP`, which an environment's setting overrides. */
  inFlightCap?: number;
  /** Replace the jobs, for tests. */
  process?: {
    step?: typeof processWorkflowStep | undefined;
    trigger?: typeof processWorkflowTrigger | undefined;
    waitMatch?: typeof processWorkflowWaitMatch | undefined;
  };
}

/**
 * C74, C76.2, C85.4 (Phase 6): what the worker needs to run reports. With it, `startWorkers`
 * starts the `report-run` and `report-rescreen` workers and schedules the `report-sweep` and,
 * with `OPENVERIFY_WATCHLIST_REFRESH=true`, the `watchlists-refresh` tick.
 */
export interface WorkerReportOptions {
  watchlists: WatchlistSettings;
  limits: ReportLimits;
  /** The `report-run` producer of the sweep and the framework (`jobs/report-queues.ts`). */
  runs: ReportRunQueue;
  /** The `report-rescreen` producer of the sweep's recovery and the refresh tick. */
  rescreens: ReportRescreenQueue;
  /** Replaces `processReportRun`, for tests. */
  processRun?: ProcessReportRun | undefined;
  /** Replaces `processReportRescreen`, for tests. */
  processRescreen?: ProcessReportRescreen | undefined;
}

/** The `webhook-delivery` processor: one attempt per job. */
export function webhookDeliveryProcessor(
  deps: DeliverWebhookDeps,
): (job: ProcessorJob<WebhookDeliveryJob>) => Promise<DeliveryResult> {
  return (job) => deliverWebhook(job.data, deps);
}

export interface StartWorkersOptions {
  /** Valkey connection, e.g. `{ url: 'redis://...' }`. */
  connection: ConnectionOptions;
  /** Key prefix, to isolate tests or deployments. */
  prefix?: string | undefined;
  db: Db;
  storage: FileStorage;
  keyring: Keyring;
  vision: VisionClient;
  sender: WebhookSender;
  logger: WorkerLogger;
  clock?: Clock;
  /** Jobs each queue runs at once. Defaults to 4. */
  concurrency?: number;
  /** Sweep period for overdue webhook deliveries; 0 disables the sweep. Defaults to 30 s. */
  sweepIntervalMs?: number;
  retry?: WebhookRetryPolicy;
  /** Face match threshold; defaults to `FACE_MATCH_DEFAULTS.threshold` (C39.3). */
  faceMatchThreshold?: number;
  /** C31.8 key of the identification-number blind index. */
  blindIndexKey?: Uint8Array | undefined;
  /** C35 providers per environment kind; none bound when omitted. */
  providers?: ProviderBindings | undefined;
  /** C54.3: the key-value cache in Valkey. */
  cache?: KeyValueCache | undefined;
  /** C54.6: the outbound HTTP client factory. */
  outboundHttp?: OutboundHttp | undefined;
  /** C54.3: the DNS resolver of the MX and website checks. */
  dnsResolver?: DnsResolver | undefined;
  /** C54.3: the GCRA limiter of the provider limits. */
  rateLimiter?: RateLimiter | undefined;
  /** C59.6: the queue a decision hook enqueues the verifications it created on. */
  verificationQueue?: VerificationQueue | undefined;
  /** C61.5: the malicious-feed list, loaded when `maliciousWebsite` is bound to `feed-list`. */
  maliciousFeeds?: MaliciousFeedList | undefined;
  /** C62.7: the trust-store settings (`OPENVERIFY_TRUST_ANCHOR_REFRESH`, ICAO CRLs). */
  nfc?: NfcSettings | undefined;
  /** C74, C85.4 (Phase 6): the report settings and producers; no report worker without them. */
  reports?: WorkerReportOptions | undefined;
  /** C92.3 (Workflow 7A): the worker's network snapshots, which the `ip-address` report reads. */
  networkSnapshots?: NetworkSnapshots | undefined;
  /** C92.2 (Workflow 7A): the network settings; the `network-refresh` tick needs `refresh`. */
  network?: NetworkSettings | undefined;
  /** C90.5 (Workflow 7A): the signals producer; no `inquiry-signals` worker or sweep without it. */
  signals?: WorkerSignalOptions | undefined;
  /**
   * C150.9, C152.2 (Workflow 9A Stage 1b (S)): the flow's producer; without it no
   * `flow-signal-snapshot` worker and no `flow-action-sweep`.
   */
  flow?: WorkerFlowOptions | undefined;
  /** C211.4 (Workflow 10B Stage 1b (I)): the `integrity-decode` worker; none without it. */
  integrity?: WorkerIntegrityOptions | undefined;
  /** C232.5 (Workflow 11A Stage 1b (C)): the Connect jobs; none without it (Connect off). */
  connect?: WorkerConnectOptions | undefined;
  /** C253.2 (Workflow 11B Stage 1b (D)): the `account-export` worker; none without it. */
  accountExport?: WorkerAccountExportOptions | undefined;
  /**
   * C251.1 (Workflow 11B, `integration-11b`): the quota sweep and recovery over the UNWRAPPED
   * producers; none without it.
   */
  quotas?: WorkerQuotaOptions | undefined;
  /**
   * C163.2, C163.4 (Workflow 9B Stage 1b (A)): the analytics producer; without it no
   * `analytics-rebuild` worker and no `analytics-rollup`.
   */
  analytics?: WorkerAnalyticsOptions | undefined;
  /**
   * C169.6 (Workflow 9B Stage 1b (W)): the webhook failure alerts; without it no
   * `webhook-failure-alerts`.
   */
  webhookAlerts?: WorkerWebhookAlertOptions | undefined;
  /**
   * C166.1, C166.5 (Workflow 9B Stage 1b (X)): the export and bulk report producers; without them no
   * `export` or `report-bulk` worker and no `export-sweep`.
   */
  exports?: WorkerExportOptions | undefined;
  /** C99.4, C100.2 (Workflow 7B): the list producers; no list worker or sweep without them. */
  lists?: WorkerListOptions | undefined;
  /** C101.3, C102.4 (Workflow 7B): the graph producers; no graph worker or job without them. */
  graph?: WorkerGraphOptions | undefined;
  /** C117, C143.2 (Workflow 8A): the engine's producers; no engine worker or job without them. */
  workflows?: WorkerWorkflowOptions | undefined;
  /** C137.4, C143.2 (Workflow 8B): the case jobs; no case worker without them. */
  cases?: WorkerCaseOptions | undefined;
  /** Replaces `processVerification`, for tests. */
  processVerification?: typeof processVerification | undefined;
  createWorker?: WorkerFactory;
  createQueue?: QueueFactory;
  /** Builds the queues of the repeatable jobs; defaults to BullMQ queues. */
  createRepeatableQueue?: RepeatableQueueFactory;
  /** Replaces the sweep, for tests. */
  sweep?: () => Promise<number>;
  /** Replaces the `inquiry-expiry` run, for tests. */
  expireInquiries?: () => Promise<InquiryExpiryResult>;
}

export interface RunningWorkers {
  close(): Promise<void>;
}

const bullWorker: WorkerFactory = (name, processor, options) =>
  new Worker(name, processor, options);

/**
 * `processor` with its failures rethrown without data (Workflow 4B review H001): BullMQ keeps a
 * failure's message and stack in Valkey, so they hold a description, never a query's parameters.
 */
function withoutFailureData<Data>(processor: WorkerProcessor<Data>): WorkerProcessor<Data> {
  return async (job) => {
    try {
      return await processor(job);
    } catch (error) {
      throw withoutJobData(error);
    }
  };
}

const bullQueue: QueueFactory = (name, options) => createBullQueue(name, options);

const bullRepeatableQueue: RepeatableQueueFactory = (name, options) =>
  new Queue(name, {
    connection: options.connection,
    ...(options.prefix === undefined ? {} : { prefix: options.prefix }),
  });

/** Closes each of `closables`, logging the ones that fail instead of stopping (F015). */
async function closeAll(
  closables: readonly { queue: string; close(): Promise<void> }[],
  logger: WorkerLogger,
  message: string,
): Promise<void> {
  const results = await Promise.allSettled(closables.map((closable) => closable.close()));
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      logger.error(
        { queue: closables[index]?.queue ?? null, error: (result.reason as Error).name },
        message,
      );
    }
  });
}

/** Starts the `process-verification` and `webhook-delivery` workers and the sweep. */
export function startWorkers(options: StartWorkersOptions): RunningWorkers {
  const { connection, prefix, db, logger } = options;
  // C62.9: the explicit-parameter brainpool self-test runs at worker start, so a platform that
  // cannot verify those chips logs it now; passive authentication reuses the memoised result.
  nfcSelfTest(logger);
  // C101.3 (Workflow 7B): the in-transaction graph indexer keys values with this process's key.
  useGraphIndexKey(options.blindIndexKey);
  // C168.6 (Workflow 9B): the audit log's IP index keys addresses with the same key; without one
  // it keeps reading OPENVERIFY_BLIND_INDEX_KEY from the environment.
  if (options.blindIndexKey !== undefined) useAuditIpIndexKey(options.blindIndexKey);
  const clock = options.clock ?? systemClock;
  const createWorker = options.createWorker ?? bullWorker;
  const queue = (options.createQueue ?? bullQueue)(WEBHOOK_DELIVERY_QUEUE, { connection, prefix });
  const scheduler = createWebhookDeliveryScheduler(queue);
  const { workflows } = options;
  const events = createEventPublisher({
    db,
    deliveries: scheduler,
    logger,
    // C118.1, C119.3 (F02): a run's events wake deliveries and waits after the commit.
    ...(workflows === undefined
      ? {}
      : { workflowTriggers: workflows.triggers, workflowSteps: workflows.waitMatches }),
    listRescreens: options.lists?.rescreens,
  });
  const workerOptions: WorkerOptions = {
    connection,
    ...(prefix === undefined ? {} : { prefix }),
    concurrency: options.concurrency ?? 4,
  };

  const verifications = processVerificationProcessor({
    db,
    storage: options.storage,
    keyring: options.keyring,
    vision: options.vision,
    events,
    clock,
    logger,
    blindIndexKey: options.blindIndexKey,
    providers: options.providers,
    // C99.9: the opted-in lists of `id_compromised_detection`.
    ...(options.blindIndexKey === undefined
      ? {}
      : {
          compromisedIds: createCompromisedIdLookup({
            db,
            blindIndexKey: options.blindIndexKey,
            events,
          }),
        }),
    // C54.3, C59.6: the Workflow 5A dependencies of the type hooks.
    cache: options.cache,
    outboundHttp: options.outboundHttp,
    dnsResolver: options.dnsResolver,
    rateLimiter: options.rateLimiter,
    queue: options.verificationQueue,
    // C135.3 (V27, Workflow 8B (F)): renditions of the files, asked for after the commit.
    renditions: options.cases?.renditions,
    // C150.9 (Workflow 9A Stage 1b (S)): the engine's snapshot requests from a decision.
    flowSignalSnapshots: options.flow?.signalSnapshots,
    ...(options.faceMatchThreshold === undefined
      ? {}
      : { faceMatchThreshold: options.faceMatchThreshold }),
    ...(options.processVerification === undefined ? {} : { process: options.processVerification }),
  });
  const deliveries = webhookDeliveryProcessor({
    db,
    sender: options.sender,
    scheduler,
    clock,
    logger,
    ...(options.retry === undefined ? {} : { retry: options.retry }),
  });
  const workers = [
    {
      queue: PROCESS_VERIFICATION_QUEUE,
      worker: createWorker(
        PROCESS_VERIFICATION_QUEUE,
        withoutFailureData(verifications),
        workerOptions,
      ),
    },
    {
      queue: WEBHOOK_DELIVERY_QUEUE,
      worker: createWorker(WEBHOOK_DELIVERY_QUEUE, withoutFailureData(deliveries), workerOptions),
    },
  ];
  // C74.1, C74.4 (Phase 6): the report run framework and the re-screen after a list update.
  const { reports } = options;
  if (reports !== undefined) {
    const runs = reportRunProcessor({
      db,
      clock,
      logger,
      events,
      keyring: options.keyring,
      providers: options.providers,
      cache: options.cache,
      outboundHttp: options.outboundHttp,
      dnsResolver: options.dnsResolver,
      rateLimiter: options.rateLimiter,
      blindIndexKey: options.blindIndexKey,
      watchlists: reports.watchlists,
      limits: reports.limits,
      reportRuns: reports.runs,
      networkSnapshots: options.networkSnapshots,
      process: reports.processRun,
    });
    const rescreens = reportRescreenProcessor({
      db,
      clock,
      logger,
      watchlists: reports.watchlists,
      blindIndexKey: options.blindIndexKey,
      process: reports.processRescreen,
    });
    workers.push(
      {
        queue: REPORT_RUN_QUEUE,
        worker: createWorker(REPORT_RUN_QUEUE, withoutFailureData(runs), workerOptions),
      },
      {
        queue: REPORT_RESCREEN_QUEUE,
        // One re-screen at a time per process: each holds up to 50,000 decrypted subjects.
        worker: createWorker(REPORT_RESCREEN_QUEUE, withoutFailureData(rescreens), {
          ...workerOptions,
          concurrency: 1,
        }),
      },
    );
  }

  // C90.5, C107.2 (Workflow 7A): the signals computation, with the keyring and the blind-index key.
  const { signals } = options;
  if (signals !== undefined) {
    const computations = inquirySignalsProcessor({
      db,
      clock,
      logger,
      events,
      keyring: options.keyring,
      blindIndexKey: options.blindIndexKey,
      networkSnapshots: options.networkSnapshots,
      // C211.5 (Workflow 10B): the bound deviceIntegrity provider gives the Play Integrity facts.
      providers: options.providers,
      process: signals.process,
    });
    workers.push({
      queue: INQUIRY_SIGNALS_QUEUE,
      worker: createWorker(INQUIRY_SIGNALS_QUEUE, withoutFailureData(computations), workerOptions),
    });
  }

  // C150.9 (Workflow 9A Stage 1b (S)): the flow's provisional signal snapshots, with the deps the
  // `inquiry-signals` processor receives (`processFlowSignalSnapshot`, `api-flow-actions`).
  const { flow } = options;
  if (flow !== undefined) {
    const snapshots = flowSignalSnapshotProcessor({
      db,
      clock,
      logger,
      events,
      keyring: options.keyring,
      blindIndexKey: options.blindIndexKey,
      networkSnapshots: options.networkSnapshots,
      // C211.5 (Workflow 10B): the bound deviceIntegrity provider gives the Play Integrity facts.
      providers: options.providers,
      process: flow.processSignalSnapshot,
    });
    workers.push({
      queue: FLOW_SIGNAL_SNAPSHOT_QUEUE,
      worker: createWorker(
        FLOW_SIGNAL_SNAPSHOT_QUEUE,
        withoutFailureData(snapshots),
        workerOptions,
      ),
    });
  }

  // C211.4 (Workflow 10B Stage 1b (I)): the integrity token decodes (`processIntegrityDecode`,
  // `api-integrity`), with the bound providers and the outbound client: never in a request.
  const { integrity } = options;
  if (integrity !== undefined) {
    const decodes = integrityDecodeProcessor({
      db,
      clock,
      logger,
      keyring: options.keyring,
      providers: options.providers,
      outboundHttp: options.outboundHttp,
      process: integrity.process,
    });
    workers.push({
      queue: INTEGRITY_DECODE_QUEUE,
      worker: createWorker(INTEGRITY_DECODE_QUEUE, withoutFailureData(decodes), workerOptions),
    });
  }

  // C253.2 (Workflow 11B Stage 1b (D)): the access exports (`processAccountExport`, `dsar-export`'s);
  // a job carries ids only.
  const { accountExport } = options;
  if (accountExport !== undefined) {
    const cut = accountExport.process ?? processAccountExport;
    const cuts = (job: ProcessorJob<AccountExportJob>) =>
      cut(job.data, {
        db,
        clock,
        logger,
        keyring: options.keyring,
        storage: options.storage,
      });
    workers.push({
      queue: ACCOUNT_EXPORT_QUEUE,
      worker: createWorker(ACCOUNT_EXPORT_QUEUE, withoutFailureData(cuts), workerOptions),
    });
  }

  // C234.2 (Workflow 11A Stage 1b (R)): the redemptions (`processConnectRedeem`, `api-redeem`), only
  // with Connect on; a job carries ids only, and a failure is final (one attempt).
  const { connect } = options;
  if (connect !== undefined) {
    const redeem = connect.processRedeem ?? processConnectRedeem;
    // integration-11a (api-redeem's deviation): the worker's publisher for both sides' events, and
    // the workflow services as the destination's write paths (a hydrate; F11's cast, as
    // `apiDepsOf` does for the actions).
    const redeemApi =
      workflows === undefined
        ? undefined
        : (workflows.createServices(events) as unknown as ApiDependencies);
    const redeems = async (job: ProcessorJob<ConnectRedeemJob>): Promise<ConnectRedeemResult> =>
      redeem(job.data, {
        db,
        clock,
        logger,
        keyring: options.keyring,
        storage: options.storage,
        events,
        ...(redeemApi === undefined ? {} : { api: redeemApi }),
      });
    workers.push({
      queue: CONNECT_REDEEM_QUEUE,
      worker: createWorker(CONNECT_REDEEM_QUEUE, withoutFailureData(redeems), workerOptions),
    });
  }

  // C163.2 (Workflow 9B Stage 1b (A)): the rebuilds of an environment's open days after a change of
  // its reporting zone (`processAnalyticsRebuild`, `api-analytics`).
  const { analytics } = options;
  if (analytics !== undefined) {
    const rebuilds = analyticsRebuildProcessor({
      db,
      clock,
      logger,
      process: analytics.processRebuild,
    });
    workers.push({
      queue: ANALYTICS_REBUILD_QUEUE,
      worker: createWorker(ANALYTICS_REBUILD_QUEUE, withoutFailureData(rebuilds), workerOptions),
    });
  }

  // C166.1, C166.5 (Workflow 9B Stage 1b (X)): an export's file and a bulk job's reports
  // (`processExport`, `processReportBulk`, `api-exports`), with the keyring and the blind-index key.
  const exportOptions = options.exports;
  if (exportOptions !== undefined) {
    const exportDeps: ExportJobDeps = {
      db,
      storage: options.storage,
      keyring: options.keyring,
      blindIndexKey: options.blindIndexKey,
      events,
      clock,
      logger,
    };
    const bulkDeps: ReportBulkJobDeps = {
      ...exportDeps,
      reports:
        options.reports === undefined
          ? undefined
          : { limits: options.reports.limits, runs: options.reports.runs },
    };
    workers.push(
      {
        queue: EXPORT_QUEUE,
        worker: createWorker(
          EXPORT_QUEUE,
          withoutFailureData(
            listJobProcessor(exportOptions.processExport ?? processExport, exportDeps),
          ),
          workerOptions,
        ),
      },
      {
        queue: REPORT_BULK_QUEUE,
        worker: createWorker(
          REPORT_BULK_QUEUE,
          withoutFailureData(
            listJobProcessor(exportOptions.processReportBulk ?? processReportBulk, bulkDeps),
          ),
          workerOptions,
        ),
      },
    );
  }

  // C99.4, C99.7, C100.2, C107.2 (Workflow 7B): the list jobs, with the keyring and the
  // blind-index key.
  const { lists } = options;
  if (lists !== undefined) {
    const shared = { db, clock, logger, keyring: options.keyring };
    const keyed = { ...shared, blindIndexKey: options.blindIndexKey };
    // C99.7: one matcher per process, so its decrypted cache is one bounded copy.
    const biometric = createBiometricListMatcher({
      ...shared,
      storage: options.storage,
      vision: options.vision,
    });
    const screen: ListScreenDeps = { ...keyed, events, biometric };
    const importing: ListImportDeps = {
      ...keyed,
      storage: options.storage,
      events,
      writer:
        lists.writer ??
        (options.blindIndexKey === undefined
          ? unbuiltListItemWriter
          : createListItemWriter({ blindIndexKey: options.blindIndexKey })),
    };
    const embed: ListItemEmbedDeps = {
      ...shared,
      events,
      storage: options.storage,
      vision: options.vision,
    };
    workers.push(
      {
        queue: LIST_SCREEN_QUEUE,
        worker: createWorker(
          LIST_SCREEN_QUEUE,
          withoutFailureData(listJobProcessor(lists.process?.screen ?? processListScreen, screen)),
          workerOptions,
        ),
      },
      {
        queue: LIST_IMPORT_QUEUE,
        worker: createWorker(
          LIST_IMPORT_QUEUE,
          withoutFailureData(
            listJobProcessor(lists.process?.import ?? processListImport, importing),
          ),
          workerOptions,
        ),
      },
      {
        queue: LIST_ITEM_EMBED_QUEUE,
        worker: createWorker(
          LIST_ITEM_EMBED_QUEUE,
          withoutFailureData(listJobProcessor(lists.process?.embed ?? processListItemEmbed, embed)),
          workerOptions,
        ),
      },
    );
    const { rescreens } = lists;
    if (rescreens !== undefined) {
      const rescreen: ListRescreenDeps = { db, logger, rescreens };
      workers.push({
        queue: LIST_RESCREEN_QUEUE,
        worker: createWorker(
          LIST_RESCREEN_QUEUE,
          withoutFailureData(
            listJobProcessor(lists.process?.rescreen ?? processListRescreen, rescreen),
          ),
          workerOptions,
        ),
      });
    }
  }

  // C101.3, C102.4, C107.2 (Workflow 7B): the graph jobs; the index job with the keyring and the
  // blind-index key.
  const { graph } = options;
  if (graph !== undefined) {
    const indexing: GraphIndexDeps = {
      db,
      clock,
      logger,
      keyring: options.keyring,
      blindIndexKey: options.blindIndexKey,
    };
    const querying: GraphQueryDeps = {
      db,
      clock,
      logger,
      events,
      dashboardPublicUrl: graph.dashboardPublicUrl,
    };
    workers.push(
      {
        queue: GRAPH_INDEX_QUEUE,
        worker: createWorker(
          GRAPH_INDEX_QUEUE,
          withoutFailureData(listJobProcessor(graph.process?.index ?? processGraphIndex, indexing)),
          workerOptions,
        ),
      },
      {
        queue: GRAPH_QUERY_QUEUE,
        worker: createWorker(
          GRAPH_QUERY_QUEUE,
          withoutFailureData(listJobProcessor(graph.process?.query ?? processGraphQuery, querying)),
          workerOptions,
        ),
      },
    );
  }

  // C117, C118.1, C119.3, C143.2 (Workflow 8A): the engine. The services are built once (F11).
  const workflowDeps: WorkflowWorkerDeps | undefined =
    workflows === undefined
      ? undefined
      : {
          db,
          clock,
          logger,
          services: workflows.createServices(events),
          steps: workflows.steps,
          triggers: workflows.triggers,
          waitMatches: workflows.waitMatches,
          ...(workflows.inFlightCap === undefined ? {} : { inFlightCap: workflows.inFlightCap }),
        };
  if (workflows !== undefined && workflowDeps !== undefined) {
    const stepProcessor = () =>
      withoutFailureData(
        listJobProcessor(workflows.process?.step ?? processWorkflowStep, workflowDeps),
      );
    workers.push(
      {
        queue: WORKFLOW_STEP_QUEUE,
        worker: createWorker(WORKFLOW_STEP_QUEUE, stepProcessor(), workerOptions),
      },
      {
        queue: WORKFLOW_STEP_BATCH_QUEUE,
        worker: createWorker(WORKFLOW_STEP_BATCH_QUEUE, stepProcessor(), workerOptions),
      },
      {
        queue: WORKFLOW_TRIGGER_QUEUE,
        worker: createWorker(
          WORKFLOW_TRIGGER_QUEUE,
          withoutFailureData(
            listJobProcessor(workflows.process?.trigger ?? processWorkflowTrigger, workflowDeps),
          ),
          workerOptions,
        ),
      },
      {
        queue: WORKFLOW_WAIT_MATCH_QUEUE,
        worker: createWorker(
          WORKFLOW_WAIT_MATCH_QUEUE,
          withoutFailureData(
            listJobProcessor(
              workflows.process?.waitMatch ?? processWorkflowWaitMatch,
              workflowDeps,
            ),
          ),
          workerOptions,
        ),
      },
    );
  }

  // C137.4, C143.2 (Workflow 8B): the case jobs, each processor `api-cases`'.
  const { cases } = options;
  if (cases !== undefined) {
    const caseDeps: CaseBulkDeps = { db, logger, events };
    workers.push({
      queue: CASE_BULK_QUEUE,
      worker: createWorker(
        CASE_BULK_QUEUE,
        withoutFailureData(
          listJobProcessor(cases.process?.bulk ?? processCaseBulkAction, caseDeps),
        ),
        workerOptions,
      ),
    });
    // C135.3, C135.5, C138.1 (Workflow 8B (F)): the case file jobs, each processor `api-case-files`'.
    const fileDeps: CaseFileJobDeps = {
      db,
      storage: options.storage,
      keyring: options.keyring,
      vision: options.vision,
      events,
      clock,
      logger,
      providers: options.providers,
    };
    const fileWorker = (
      queue: string,
      process: (job: never, deps: CaseFileJobDeps) => Promise<void>,
    ): void => {
      workers.push({
        queue,
        worker: createWorker(
          queue,
          withoutFailureData(listJobProcessor(process, fileDeps)),
          workerOptions,
        ),
      });
    };
    fileWorker(CASE_EXPORT_QUEUE, cases.process?.export ?? processCaseExport);
    fileWorker(CASE_ATTACHMENT_SCAN_QUEUE, cases.process?.scan ?? processCaseAttachmentScan);
    fileWorker(CASE_RENDITION_QUEUE, cases.process?.rendition ?? processCaseRendition);
  }

  // Repeatable jobs. Another owner adds its job inside its own marked block.
  const repeatableJobs: RepeatableJob[] = [
    {
      name: INQUIRY_EXPIRY_QUEUE,
      repeat: { every: INQUIRY_EXPIRY_INTERVAL_MS },
      run:
        options.expireInquiries ??
        (() => runInquiryExpiry({ db, storage: options.storage, events, clock, logger })),
    },
    // api-lifecycle: begin
    // api-lifecycle: end
    // C54.1 (5B Stage 1): the Phase 5 jobs the operator turned on (feed and trust refresh).
    ...phase5RepeatableJobs({
      db,
      clock,
      logger,
      cache: options.cache,
      outboundHttp: options.outboundHttp,
      maliciousFeeds: options.maliciousFeeds,
      nfc: options.nfc,
      verificationQueue: options.verificationQueue,
    }),
    // C85.4 (Phase 6): the report sweep and, when turned on, the list refresh tick.
    ...phase6RepeatableJobs(
      { db, clock, logger, outboundHttp: options.outboundHttp },
      reports === undefined
        ? undefined
        : {
            runs: reports.runs,
            rescreens: reports.rescreens,
            limits: reports.limits,
            watchlists: reports.watchlists,
          },
    ),
    // C90.5, C92.2, C107.1 (Workflow 7A): the signals sweep and, when turned on, the network
    // refresh tick.
    ...phase7RepeatableJobs(
      { db, clock, logger, outboundHttp: options.outboundHttp },
      options.network === undefined
        ? undefined
        : { storage: options.storage, network: options.network },
      signals === undefined ? undefined : { signals: signals.queue },
      lists === undefined
        ? undefined
        : { screens: lists.screens, imports: lists.imports, embeds: lists.embeds, events },
      graph === undefined
        ? undefined
        : {
            index: graph.index,
            queries: graph.queries,
            keyring: options.keyring,
            blindIndexKey: options.blindIndexKey,
          },
    ),
    // C143.1, C121.5 (Workflow 8A).
    ...phase8RepeatableJobs({ db, clock, logger }, workflowDeps, lists?.rescreens),
    // C152.2, C150.9 (Workflow 9A Stage 1b (S)): the flow's sweep, with the flow's jobs.
    ...phase9RepeatableJobs(
      { db, clock, logger },
      options.flow !== undefined && { events, workflowSteps: workflows?.steps },
    ),
    // C163.4 (Workflow 9B Stage 1b (A)): the analytics rollup, with the analytics producer.
    ...analyticsRepeatableJobs(
      { db, clock, logger },
      analytics === undefined ? undefined : { rebuilds: analytics.rebuilds },
      analytics?.runRollup,
    ),
    // C169.6 (Workflow 9B Stage 1b (W)): the webhook failure alerts, with their mailer.
    ...webhookAlertRepeatableJobs(
      { db, clock, logger },
      options.webhookAlerts === undefined
        ? undefined
        : {
            mailer: options.webhookAlerts.mailer,
            dashboardPublicUrl: options.webhookAlerts.dashboardPublicUrl,
          },
      options.webhookAlerts?.runAlerts,
    ),
    // C166.1, C166.5, C174.3 (Workflow 9B Stage 1b (X)): the export sweep, with both producers.
    ...exportRepeatableJobs(
      { db, clock, logger },
      exportOptions === undefined
        ? undefined
        : {
            storage: options.storage,
            exports: exportOptions.exports,
            reportBulk: exportOptions.reportBulk,
          },
      exportOptions?.runSweep,
    ),
    // C232.5 (Workflow 11A Stage 1b (C)): the share-token expiry sweep, with Connect on.
    ...connectRepeatableJobs({ db, clock, logger }, options.connect),
    // C251.1 (Workflow 11B, integration-11b): the fair quota sweep and the lost-job recovery, over
    // the UNWRAPPED producers (quotas' `jobs/quota-sweep.ts`).
    ...(options.quotas === undefined
      ? []
      : quotaRepeatableJobs(
          createQuotaAdmissionDeps({ db, clock, logger, limits: options.quotas.limits }),
          quotaQueuePasses(options.quotas.producers),
        )),
    // C132.6, C133.6, C143.1 (Workflow 8B): the case sweeps, with the case jobs.
    ...caseRepeatableJobs(
      { db, clock, logger },
      cases === undefined
        ? undefined
        : {
            events,
            storage: options.storage,
            bulk: cases.bulk,
            exports: cases.exports,
            scans: cases.scans,
            renditions: cases.renditions,
            mailer: cases.mailer,
            dashboardPublicUrl: cases.dashboardPublicUrl,
          },
    ),
  ];
  const createRepeatableQueue = options.createRepeatableQueue ?? bullRepeatableQueue;
  const repeatableQueues: { queue: string; close(): Promise<void> }[] = [];
  for (const job of repeatableJobs) {
    const queue = createRepeatableQueue(job.name, { connection, prefix });
    repeatableQueues.push({ queue: job.name, close: () => queue.close() });
    queue.upsertJobScheduler(job.name, job.repeat, { name: job.name }).catch((error: unknown) => {
      logger.error(
        { queue: job.name, error: (error as Error).name },
        'repeatable job not scheduled',
      );
    });
    workers.push({
      queue: job.name,
      worker: createWorker(
        job.name,
        withoutFailureData(() => job.run()),
        { ...workerOptions, concurrency: 1 },
      ),
    });
  }
  for (const { queue: name, worker } of workers) {
    worker.on('failed', (job, error) => {
      const attempts = job?.opts.attempts ?? 1;
      logger.error(
        {
          queue: name,
          jobId: job?.id ?? null,
          attemptsMade: job?.attemptsMade ?? null,
          final:
            job === undefined ||
            error instanceof UnrecoverableError ||
            job.attemptsMade >= attempts,
          error: error.name,
          detail: describeJobError(error),
        },
        'job failed',
      );
    });
    worker.on('error', (error) => {
      logger.error({ queue: name, error: error.name }, 'worker error');
    });
  }

  const sweep = options.sweep ?? (() => sweepDueWebhookDeliveries({ db, scheduler, clock }));
  const interval = options.sweepIntervalMs ?? 30_000;
  const timer =
    interval > 0
      ? setInterval(() => {
          sweep().catch((error: unknown) => {
            logger.warn({ error: (error as Error).name }, 'webhook sweep failed');
          });
        }, interval)
      : undefined;
  timer?.unref();

  return {
    async close() {
      clearInterval(timer);
      await closeAll(
        workers.map(({ queue: name, worker }) => ({ queue: name, close: () => worker.close() })),
        logger,
        'worker did not close',
      );
      await closeAll(
        [{ queue: WEBHOOK_DELIVERY_QUEUE, close: () => scheduler.close() }, ...repeatableQueues],
        logger,
        'queue did not close',
      );
      // C123.3: idle children keep the event loop alive.
      if (workflowDeps !== undefined) {
        await egressConfigOf(workflowDeps.services).codeRunner?.close();
      }
    },
  };
}

/**
 * Starts the worker from environment variables: the API's settings (`loadConfig`) plus
 * `OPENVERIFY_WORKER_CONCURRENCY` and `OPENVERIFY_WEBHOOK_ALLOW_PRIVATE_NETWORKS`.
 * @throws {ConfigError | WorkerConfigError | WebhookNetworkConfigError} before connecting
 * to anything when the configuration is invalid.
 */
export async function main(env: NodeJS.ProcessEnv = process.env): Promise<RunningWorkers> {
  // C63: the worker reads its own provider kinds and their credentials (the EVM RPC URLs).
  const config = loadConfig(env, { process: 'worker' });
  // C249.1 (Workflow 11B; platform-ops' store-tls.ts): the stores' TLS settings, before any client.
  applyStoreTls(config.storeTls);
  const settings = workerSettingsFromEnv(env, config.mode);
  const logger = createWorkerLogger({ level: config.logLevel });
  setDefaultKeyring(config.keyring);
  const pool = new Pool({ connectionString: config.databaseUrl });
  logPoolErrors(pool, logger);
  const storage = createFileStorage({ driver: 's3', ...config.s3 });
  const sender = createGuardedWebhookSender({ policy: settings.webhookPolicy });
  // C54.3: the Workflow 5A dependencies, each on its own lazy client.
  const cacheRedis = createCacheRedis(config.redisUrl);
  const cache = createKeyValueCache({ redis: cacheRedis });
  const limiterRedis = createRateLimitRedis(config.redisUrl);
  // C12, C55.7; Workflow 5C review K4: one GCRA limiter for the jobs and the KYB pacing.
  const rateLimiter = createRateLimiter({ redis: limiterRedis });
  const outboundHttp = createOutboundHttp();
  // C251.1 (Workflow 11B Stage 1b (P), `foundation-11b`'s hook): every process-verification and
  // report-run enqueue the worker makes asks the admission first (`services/quotas/admit.ts`).
  // integration-11b: with the install's limits (C251.2), and the unwrapped producers kept for the
  // quota sweep, which must not ask the admission again (foundation-11b amendment 13).
  const queueLimits = installQueueLimitsOf(config);
  const admission = { db: createDatabase(pool), clock: systemClock, limits: queueLimits };
  const rawVerifications = createVerificationQueue({ connection: { url: config.redisUrl } });
  const verificationQueue = withVerificationAdmission(rawVerifications, admission);
  // C74 (Phase 6): the report producers of the sweep, the framework and the refresh tick.
  const rawReportRuns = createReportRunQueue({ connection: { url: config.redisUrl } });
  const reportRuns = withReportRunAdmission(rawReportRuns, admission);
  // C251.1 (integration-11b): the producers the quota sweep admits held exports and decodes through.
  const accountExports = createAccountExportQueue({ connection: { url: config.redisUrl } });
  const integrityDecodes = createIntegrityDecodeQueue({ connection: { url: config.redisUrl } });
  // integration-11a (workflow-connect's deviation, C243.1): the producer through which a
  // `redeem_share_token` step enqueues its redemption, only while the install allows Connect.
  const connectRedeems = config.connect.enabled
    ? createConnectRedeemQueue({ connection: { url: config.redisUrl } })
    : undefined;
  const reportRescreens = createReportRescreenQueue({ connection: { url: config.redisUrl } });
  // C90.5 (Workflow 7A): the signals producer of the outbox sweep.
  const inquirySignals = createInquirySignalsQueue({ connection: { url: config.redisUrl } });
  // C99.4, C99.7, C100.2 (Workflow 7B): the list producers of the sweeps.
  const listScreens = createListScreenQueue({ connection: { url: config.redisUrl } });
  const listImports = createListImportQueue({ connection: { url: config.redisUrl } });
  const listItemEmbeds = createListItemEmbedQueue({ connection: { url: config.redisUrl } });
  // C101.3, C102.4 (Workflow 7B): the graph producers of the sweeps.
  const graphIndex = createGraphIndexQueue({ connection: { url: config.redisUrl } });
  const graphQueries = createGraphQueryQueue({ connection: { url: config.redisUrl } });
  // C117, C118.1, C119.3 (Workflow 8A): the engine's producers.
  const listRescreens = createListRescreenQueue({ connection: { url: config.redisUrl } });
  // C135.3 (V27, Workflow 8B (F)): the verification job asks for its files' renditions after commit.
  const caseRenditions = createCaseRenditionQueue({ connection: { url: config.redisUrl } });
  // C150.9 (Workflow 9A Stage 1b (S)): the flow's snapshot producer.
  const flowSignalSnapshots = createFlowSignalSnapshotQueue({
    connection: { url: config.redisUrl },
  });
  // C163.2 (Workflow 9B Stage 1b (A)): the producer the analytics rollup queues rebuilds on.
  const analyticsRebuilds = createAnalyticsRebuildQueue({ connection: { url: config.redisUrl } });
  // C166.1, C166.5 (Workflow 9B Stage 1b (X)): the producers `export-sweep` enqueues again on.
  const exportJobs = createExportQueue({ connection: { url: config.redisUrl } });
  const reportBulkJobs = createReportBulkQueue({ connection: { url: config.redisUrl } });
  // K8-20, C169.6: the worker's mailer, of the case notification and webhook failure alert emails.
  const workerMailer = createMailer({
    smtpUrl: config.operators.smtpUrl,
    from: config.operators.mailFrom,
  });
  // C137.4, C143.2 (Workflow 8B): the producer of the case-bulk sweep.
  const caseBulk = createCaseBulkQueue({ connection: { url: config.redisUrl } });
  // K8-28 (Workflow 8D): the producers through which the export sweep enqueues unfinished work again.
  const caseExports = createCaseExportQueue({ connection: { url: config.redisUrl } });
  const caseScans = createCaseAttachmentScanQueue({ connection: { url: config.redisUrl } });
  const workflowSteps = createWorkflowStepQueue({ connection: { url: config.redisUrl } });
  const workflowTriggers = createWorkflowTriggerQueue({ connection: { url: config.redisUrl } });
  const workflowWaitMatches = createWorkflowWaitMatchQueue({
    connection: { url: config.redisUrl },
  });
  // C123.3, C117.10 (Workflow 8A): what the engine says at start.
  logWorkflowCodeRunnerAtStart(config.mode, config.workflows.codeRunner, logger);
  await checkValkeyAtStart(() => checkValkeyEvictionPolicy(cacheRedis, logger), logger);
  // C61.5: the operator's feed list, read only for a `feed-list` binding; a malformed list stops
  // the worker naming the paths at fault.
  const maliciousFeeds = bindsMaliciousFeedList(config.providers)
    ? await loadMaliciousFeedList(defaultMaliciousFeedListPath())
    : undefined;
  // C78.3 (F14): whether person-name reports can screen, said once.
  logMatcherDataAtStart(() => loadMatcherData(), logger);
  // C76.4 (V01): the source rows exist before any report run reads them.
  await reconcileWatchlistSourcesAtStart(
    createDatabase(pool),
    config.watchlists.sourcesDisabled,
    logger,
    config.watchlistUnOptInAllowed,
  );
  // C92.3, C92.5 (Workflow 7A, F41): the network source rows, then the worker's snapshots, which
  // the ip-address report reads; released on close.
  const networkSnapshots = createNetworkSnapshots({
    db: createDatabase(pool),
    storage,
    clock: systemClock,
    logger,
  });
  await startNetworkDataAtStart(
    createDatabase(pool),
    config.network,
    networkSnapshots,
    logger,
    systemClock,
  );
  const providers = workerProviderBindings(config, {
    maliciousFeeds,
    outboundHttp,
    cache,
    rateLimiter,
  });
  const workers = startWorkers({
    connection: { url: config.redisUrl },
    db: createDatabase(pool),
    storage,
    keyring: config.keyring,
    vision: createVisionClient({
      baseUrl: config.vision.url,
      serviceToken: config.vision.serviceToken,
    }),
    sender,
    logger,
    concurrency: settings.concurrency,
    sweepIntervalMs: settings.sweepIntervalMs,
    blindIndexKey: config.blindIndexKey,
    providers,
    cache,
    outboundHttp,
    dnsResolver: createDnsResolver(),
    rateLimiter,
    verificationQueue,
    maliciousFeeds,
    nfc: config.nfc,
    reports: {
      // C254.1 (Q10 granted; KP11-31): the switch reaches the refresh tick and the screening path.
      watchlists: { ...config.watchlists, unOptInAllowed: config.watchlistUnOptInAllowed },
      limits: config.reports,
      runs: reportRuns,
      rescreens: reportRescreens,
    },
    networkSnapshots,
    network: config.network,
    signals: { queue: inquirySignals },
    flow: { signalSnapshots: flowSignalSnapshots },
    // C211.4 (Workflow 10B Stage 1b (I)): the integrity decodes.
    integrity: {},
    // C253.2 (Workflow 11B Stage 1b (D)): the access exports (`processAccountExport`, dsar-export's).
    accountExport: {},
    // C251.1 (integration-11b): the quota sweep and recovery over the unwrapped producers.
    quotas: {
      limits: queueLimits,
      producers: {
        verifications: rawVerifications,
        reportRuns: rawReportRuns,
        ...(connectRedeems === undefined ? {} : { connectRedeems }),
        accountExports,
        integrityDecodes,
      },
    },
    // C232.5 (Workflow 11A Stage 1b (C)): the Connect jobs, only while the install allows Connect.
    ...(config.connect.enabled ? { connect: {} } : {}),
    analytics: { rebuilds: analyticsRebuilds },
    exports: { exports: exportJobs, reportBulk: reportBulkJobs },
    lists: {
      screens: listScreens,
      imports: listImports,
      embeds: listItemEmbeds,
      rescreens: listRescreens,
    },
    graph: {
      index: graphIndex,
      queries: graphQueries,
      dashboardPublicUrl: config.operators.dashboardPublicUrl,
    },
    // C143.8 (F11): the services an action calls, built once, with the worker's own publisher.
    workflows: {
      createServices: (events) =>
        createWorkflowServices(config, {
          db: createDatabase(pool),
          storage,
          events,
          queue: verificationQueue,
          clock: systemClock,
          ids: ulidIdGenerator,
          rateLimiter,
          providers,
          cache,
          outboundHttp,
          reportRuns,
          listItemEmbeds,
          graphQueries,
          ...(connectRedeems === undefined ? {} : { connectRedeems }),
        }),
      steps: workflowSteps,
      triggers: workflowTriggers,
      waitMatches: workflowWaitMatches,
      inFlightCap: config.workflows.inFlightCap,
    },
    // C137.4 (Workflow 8B): the `case-bulk` worker; (F) the case file jobs, and the `case-rendition`
    // producer through which the verification job asks for its files' renditions.
    cases: {
      renditions: caseRenditions,
      bulk: caseBulk,
      exports: caseExports,
      scans: caseScans,
      // K8-20 (decision 76): the case notification emails go out from the worker.
      mailer: workerMailer,
      dashboardPublicUrl: config.operators.dashboardPublicUrl,
    },
    // C169.6 (Workflow 9B Stage 1b (W)): the failure alerts' link-only emails, from the same mailer.
    webhookAlerts: {
      mailer: workerMailer,
      dashboardPublicUrl: config.operators.dashboardPublicUrl,
    },
  });
  // api-lifecycle: begin
  // C16: the daily `retention` job (redacts inquiries past retention, deletes expired logs,
  // deliveries, idempotency keys and events). It upserts its own BullMQ job scheduler.
  const retention = startRetentionJob({
    connection: { url: config.redisUrl },
    db: createDatabase(pool),
    storage,
    logger,
  });
  // api-lifecycle: end
  // C249.1, C249.2 (Workflow 11B): the stores' transport and the secret files, never a value.
  logStartupWarnings(logger, config.startupWarnings);
  // C250.2 (Workflow 11B; platform-ops' worker-health/heartbeat.ts): the exec probe's heartbeat.
  const heartbeat = startWorkerHeartbeat({
    file: config.workerHeartbeatFile,
    logger,
    clock: systemClock,
  });
  logger.info(
    {
      mode: config.mode,
      concurrency: settings.concurrency,
      allowPrivateNetworks: settings.webhookPolicy.allowPrivateNetworks,
    },
    'worker started',
  );
  return Promise.resolve({
    async close() {
      await heartbeat.stop();
      // C250.4 (Workflow 11B; platform-ops' worker-health/drain.ts): stop taking jobs, then close.
      await drainWorkers(workers, { logger });
      // api-lifecycle: begin
      await retention.close().catch((error: unknown) => {
        logger.error({ error: (error as Error).name }, 'retention job did not close');
      });
      // api-lifecycle: end
      const results = await Promise.allSettled([
        sender.close(),
        storage.close(),
        verificationQueue.close(),
        reportRuns.close(),
        connectRedeems?.close(),
        accountExports.close(),
        integrityDecodes.close(),
        reportRescreens.close(),
        inquirySignals.close(),
        listScreens.close(),
        listImports.close(),
        listItemEmbeds.close(),
        graphIndex.close(),
        graphQueries.close(),
        listRescreens.close(),
        caseRenditions.close(),
        flowSignalSnapshots.close(),
        analyticsRebuilds.close(),
        exportJobs.close(),
        reportBulkJobs.close(),
        caseBulk.close(),
        caseExports.close(),
        caseScans.close(),
        workflowSteps.close(),
        workflowTriggers.close(),
        workflowWaitMatches.close(),
        networkSnapshots.close(),
        outboundHttp.close(),
        closeRateLimitRedis(cacheRedis),
        closeRateLimitRedis(limiterRedis),
        pool.end(),
      ]);
      for (const result of results) {
        if (result.status === 'rejected') {
          logger.error({ error: (result.reason as Error).name }, 'worker resource did not close');
        }
      }
    },
  });
}

/* v8 ignore start -- process entry point, exercised by `dev:worker` and the e2e stack */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (running) => {
      const stop = () => {
        void running.close().finally(() => process.exit(0));
      };
      process.once('SIGTERM', stop);
      process.once('SIGINT', stop);
    },
    (error: unknown) => {
      console.error((error as Error).message);
      process.exitCode = 1;
    },
  );
}
/* v8 ignore stop */
