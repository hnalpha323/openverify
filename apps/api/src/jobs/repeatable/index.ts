/**
 * C54.1 (5B Stage 1): the registry of the Phase 5 repeatable jobs, which `startWorkers` schedules
 * after its own (`inquiry-expiry`, then the `api-lifecycle` block). Each job is scheduled only when
 * the operator turned its feature on:
 *
 * - `malicious-feed-refresh` (C61.5, `api-kyb`, `feeds.ts`): when the worker loaded a feed list
 *   (a `feed-list` binding of `maliciousWebsite`) that holds at least one feed;
 * - `trust-anchor-refresh` (C62.7, `api-nfc`, `trust-anchors.ts`): with
 *   `OPENVERIFY_TRUST_ANCHOR_REFRESH=true`.
 *
 * The `submitted-verification-sweep` (Workflow 5C review K1, `submitted-verifications.ts`) runs
 * first, whenever the worker has the verification queue: it enqueues again a verification whose
 * enqueue after a commit failed.
 *
 * Phase 6 (C85.4): `phase6RepeatableJobs` adds the `report-sweep` and the `watchlists-refresh`
 * tick, which `startWorkers` schedules after these. Phase 7 (C107.1): `phase7RepeatableJobs` adds
 * the `inquiry-signals-sweep` (with the signals producer), the `list-screen-sweep`,
 * `list-import-sweep` and `list-item-embed-sweep` (with the list producers), the `graph-index-sweep`,
 * `graph-query-sweep`, `graph-backfill` and `graph-components` (with the graph producers) and the
 * `network-refresh` tick after them. Phase 8 (C143.1): `phase8RepeatableJobs` adds the engine's
 * sweeps and `publisher-rights`.
 *
 * An owner builds its job in its own file; this registry and its tests stay as they are.
 */
import type { Db, Keyring } from '@openverify/db';
import type {
  NetworkSettings,
  NfcSettings,
  ReportLimits,
  WatchlistSettings,
} from '../../config.js';
import type { OutboundHttp } from '../../http/index.js';
import type {
  Clock,
  CaseAttachmentScanQueue,
  CaseBulkQueue,
  CaseExportQueue,
  CaseRenditionQueue,
  FileStorage,
  GraphIndexQueue,
  GraphQueryQueue,
  InquirySignalsQueue,
  KeyValueCache,
  ListImportQueue,
  ListItemEmbedQueue,
  ListRescreenQueue,
  ListScreenQueue,
  Mailer,
  ReportRescreenQueue,
  ReportRunQueue,
  VerificationQueue,
} from '../../ports.js';
import type { MaliciousFeedList } from '../../providers/malicious-website/feed-list.js';
import type { RepeatableJob } from '../../worker.js';
import {
  PUBLISHER_RIGHTS_INTERVAL_MS,
  PUBLISHER_RIGHTS_QUEUE,
  WORKFLOW_SCHEDULED_RUNS_QUEUE,
  WORKFLOW_SCHEDULE_SWEEP_QUEUE,
  WORKFLOW_STEP_SWEEP_QUEUE,
  WORKFLOW_SWEEP_INTERVAL_MS,
  WORKFLOW_TRIGGER_SWEEP_QUEUE,
  WORKFLOW_WAIT_MATCH_SWEEP_QUEUE,
} from '../workflow-queues.js';
import { runWorkflowStepSweep, runWorkflowWaitMatchSweep } from '../workflows/sweeps.js';
import type { WorkflowWorkerDeps } from '../../workflows/worker.js';
import { runPublisherRightsSweep } from './publisher-rights.js';
import { runCaseAssignmentDrain, runCaseReassignSweep, runCaseSlaSweep } from './cases.js';
import { runCaseExportSweep } from '../cases/export-sweep.js';
import { requeueUnfinishedCaseBulkActions } from '../../services/cases/bulk/service.js';
import { runCaseNotificationEmails } from '../cases/notification-emails.js';
import { requeueUnfinishedCaseFileWork } from '../cases/recovery.js';
import {
  CASE_BULK_SWEEP_INTERVAL_MS,
  CASE_BULK_SWEEP_QUEUE,
  CASE_ASSIGNMENT_DRAIN_INTERVAL_MS,
  CASE_ASSIGNMENT_DRAIN_QUEUE,
  CASE_EXPORT_SWEEP_INTERVAL_MS,
  CASE_EXPORT_SWEEP_QUEUE,
  CASE_NOTIFICATION_EMAIL_INTERVAL_MS,
  CASE_NOTIFICATION_EMAIL_QUEUE,
  CASE_REASSIGN_INTERVAL_MS,
  CASE_REASSIGN_QUEUE,
  CASE_SLA_INTERVAL_MS,
  CASE_SLA_QUEUE,
} from '../case-sweep-queues.js';
import {
  runScheduledRunsSweep,
  runWorkflowScheduleSweep,
  runWorkflowTriggerSweep,
} from './workflows.js';
import type { TransactionalEventPublisher } from '../../events/index.js';
import type { WorkerLogger } from '../logger.js';
import { maliciousFeedRefreshJob } from './feeds.js';
import { submittedVerificationSweepJob } from './submitted-verifications.js';
import { trustAnchorRefreshJob } from './trust-anchors.js';
import {
  flowActionSweepJob,
  runFlowActionSweep,
  type FlowActionSweepDeps,
  type FlowActionSweepResult,
} from './flow-actions.js';

import {
  runAnalyticsRollup,
  type AnalyticsRollupDeps,
  type AnalyticsRollupResult,
} from '../analytics/rollup.js';
import type { AnalyticsRebuildQueue, ExportQueue, ReportBulkQueue } from '../../ports.js';
import { ANALYTICS_ROLLUP_INTERVAL_MS, ANALYTICS_ROLLUP_QUEUE } from '../analytics-queues.js';
import {
  WEBHOOK_FAILURE_ALERTS_INTERVAL_MS,
  WEBHOOK_FAILURE_ALERTS_QUEUE,
} from '../webhook-alert-queues.js';
import { runWebhookFailureAlerts, type RunWebhookFailureAlerts } from './webhook-alerts.js';
import { EXPORT_SWEEP_INTERVAL_MS, EXPORT_SWEEP_QUEUE } from '../export-queues.js';
import { runExportSweep, type RunExportSweep } from '../exports/sweep.js';

/** The worker's producers the flow's sweep passes its events and steps to (C152.2). */
export type FlowSweepProducers = Pick<FlowActionSweepDeps, 'events' | 'workflowSteps'>;
import {
  REPORT_SWEEP_INTERVAL_MS,
  REPORT_SWEEP_QUEUE,
  WATCHLISTS_REFRESH_INTERVAL_MS,
  WATCHLISTS_REFRESH_QUEUE,
} from '../report-queues.js';
import { runReportSweep } from '../reports/sweep.js';
import { runWatchlistsRefresh } from './watchlists.js';
import { runNetworkRefresh } from './network.js';
import {
  INQUIRY_SIGNALS_SWEEP_INTERVAL_MS,
  INQUIRY_SIGNALS_SWEEP_QUEUE,
} from '../signal-queues.js';
import { runInquirySignalsSweep } from '../signals/sweep.js';
import { runListImportSweep } from '../importers/sweep.js';
import { LIST_RESCREEN_INTERVAL_MS, LIST_RESCREEN_SWEEP_QUEUE } from '../list-rescreen-queue.js';
import { runListItemEmbedSweep } from '../lists/embed.js';
import { runListRescreenSweep } from '../reports/list-rescreen.js';
import { runListScreenSweep } from '../lists/sweep.js';
import {
  LIST_IMPORT_SWEEP_QUEUE,
  LIST_ITEM_EMBED_SWEEP_QUEUE,
  LIST_SCREEN_SWEEP_QUEUE,
  LIST_SWEEP_INTERVAL_MS,
} from '../list-queues.js';
import { runGraphBackfill } from '../graph/backfill.js';
import { runGraphComponents } from '../graph/components.js';
import { runGraphIndexSweep } from '../graph/index-sweep.js';
import { runGraphQuerySweep } from '../graph/query-sweep.js';
import {
  GRAPH_BACKFILL_INTERVAL_MS,
  GRAPH_BACKFILL_QUEUE,
  GRAPH_COMPONENTS_PATTERN,
  GRAPH_COMPONENTS_QUEUE,
  GRAPH_INDEX_SWEEP_QUEUE,
  GRAPH_QUERY_SWEEP_QUEUE,
  GRAPH_SWEEP_INTERVAL_MS,
} from '../graph-queues.js';

/** What the Phase 5 repeatable jobs read. */
export interface RepeatableJobDeps {
  db: Db;
  clock: Clock;
  logger: WorkerLogger;
  cache?: KeyValueCache | undefined;
  outboundHttp?: OutboundHttp | undefined;
  /** C61.5: the feed list, loaded only when `maliciousWebsite` is bound to `feed-list`. */
  maliciousFeeds?: MaliciousFeedList | undefined;
  /** C62.7: the trust-store settings; absent means the refresh is off. */
  nfc?: NfcSettings | undefined;
  /** Workflow 5C review K1: the `process-verification` producer of the repair sweep. */
  verificationQueue?: VerificationQueue | undefined;
}

/** C74.3, C76.2 (Phase 6): what the report repeatable jobs read; the worker passes it with its producers. */
export interface ReportRepeatableDeps {
  /** The `report-run` producer of the sweep. */
  runs: ReportRunQueue;
  /** The `report-rescreen` producer of the sweep's recovery and the refresh tick. */
  rescreens: ReportRescreenQueue;
  limits: ReportLimits;
  watchlists: WatchlistSettings;
}

/**
 * C74.3, C76.2, C85.4 (Phase 6): the report repeatable jobs: `report-sweep` every 15 seconds
 * whenever the worker runs reports, then `watchlists-refresh` every 15 minutes with
 * `OPENVERIFY_WATCHLIST_REFRESH=true`. Their names and periods are frozen here; each runs its
 * owner's function (`runReportSweep`, `api-reports`; `runWatchlistsRefresh`, `api-watchlists`).
 */
export function phase6RepeatableJobs(
  deps: RepeatableJobDeps,
  reports: ReportRepeatableDeps | undefined,
): RepeatableJob[] {
  if (reports === undefined) {
    return [];
  }
  const { db, clock, logger } = deps;
  const jobs: RepeatableJob[] = [
    {
      name: REPORT_SWEEP_QUEUE,
      repeat: { every: REPORT_SWEEP_INTERVAL_MS },
      run: () =>
        runReportSweep({
          db,
          clock,
          logger,
          runs: reports.runs,
          rescreens: reports.rescreens,
          limits: reports.limits,
        }),
    },
  ];
  if (reports.watchlists.refresh) {
    jobs.push({
      name: WATCHLISTS_REFRESH_QUEUE,
      repeat: { every: WATCHLISTS_REFRESH_INTERVAL_MS },
      run: () =>
        runWatchlistsRefresh({
          db,
          clock,
          logger,
          outboundHttp: deps.outboundHttp,
          watchlists: reports.watchlists,
          rescreens: reports.rescreens,
        }),
    });
  }
  return jobs;
}

/** C92.2 (Workflow 7A): the network refresh tick's queue and period. */
export const NETWORK_REFRESH_QUEUE = 'network-refresh';
export const NETWORK_REFRESH_INTERVAL_MS = 15 * 60 * 1000;

/** C92.2 (Workflow 7A): what the network repeatable jobs read beyond the Phase 5 deps. */
export interface NetworkRepeatableDeps {
  /** Where an applied sync writes its snapshot (C92.3). */
  storage: FileStorage;
  network: NetworkSettings;
}

/** C90.5, C107.1 (Workflow 7A): what the `inquiry-signals-sweep` reads beyond the Phase 5 deps. */
export interface InquirySignalsRepeatableDeps {
  /** The `inquiry-signals` producer of the sweep. */
  signals: InquirySignalsQueue;
}

/** C99.4, C99.7, C100.2, C107.1 (Workflow 7B): what the list sweeps read beyond the Phase 5 deps. */
export interface ListRepeatableDeps {
  /** C127.12: a sweep that redacts stages `list.updated`. */
  events: TransactionalEventPublisher;
  screens: ListScreenQueue;
  imports: ListImportQueue;
  embeds: ListItemEmbedQueue;
}

/**
 * C143.1, C121.5 (Workflow 8A): the engine's sweeps, whenever the worker runs the engine, each calling
 * its owner's function (`jobs/workflows/sweeps.ts`, `api-engine`; `jobs/repeatable/workflows.ts`,
 * `api-triggers`; `jobs/repeatable/publisher-rights.ts`, `api-workflows`).
 */
export function phase8RepeatableJobs(
  deps: RepeatableJobDeps,
  workflows: WorkflowWorkerDeps | undefined,
  listRescreens?: ListRescreenQueue,
): RepeatableJob[] {
  // C127.12: with the worker's lists, because a monitored report re-screens with no workflow at all.
  const rescreenSweep: RepeatableJob[] =
    listRescreens === undefined
      ? []
      : [
          {
            name: LIST_RESCREEN_SWEEP_QUEUE,
            repeat: { every: LIST_RESCREEN_INTERVAL_MS },
            run: () =>
              runListRescreenSweep({
                db: deps.db,
                logger: deps.logger,
                rescreens: listRescreens,
              }),
          },
        ];
  if (workflows === undefined) {
    return rescreenSweep;
  }
  const every = { every: WORKFLOW_SWEEP_INTERVAL_MS };
  return [
    ...rescreenSweep,
    { name: WORKFLOW_STEP_SWEEP_QUEUE, repeat: every, run: () => runWorkflowStepSweep(workflows) },
    {
      name: WORKFLOW_TRIGGER_SWEEP_QUEUE,
      repeat: every,
      run: () => runWorkflowTriggerSweep(workflows),
    },
    {
      name: WORKFLOW_WAIT_MATCH_SWEEP_QUEUE,
      repeat: every,
      run: () => runWorkflowWaitMatchSweep(workflows),
    },
    {
      name: WORKFLOW_SCHEDULE_SWEEP_QUEUE,
      repeat: every,
      run: () => runWorkflowScheduleSweep(workflows),
    },
    {
      name: WORKFLOW_SCHEDULED_RUNS_QUEUE,
      repeat: every,
      run: () => runScheduledRunsSweep(workflows),
    },
    {
      name: PUBLISHER_RIGHTS_QUEUE,
      repeat: { every: PUBLISHER_RIGHTS_INTERVAL_MS },
      run: () => runPublisherRightsSweep(workflows),
    },
  ];
}

/**
 * C101.3, C101.5, C101.6, C102.4, C107.1 (Workflow 7B): what the graph's repeatable jobs read beyond
 * the Phase 5 deps: the producers of the sweeps, and the keys the backfill indexes with.
 */
export interface GraphRepeatableDeps {
  index: GraphIndexQueue;
  queries: GraphQueryQueue;
  keyring: Keyring;
  blindIndexKey?: Uint8Array | undefined;
}

/**
 * C92.2, C107.1 (Workflow 7A): the network repeatable jobs: `network-refresh` every 15 minutes with
 * `OPENVERIFY_NETWORK_REFRESH=true` (never in CI), running `runNetworkRefresh` (`api-network`). Its
 * name and period are frozen here.
 */
export function phase7RepeatableJobs(
  deps: RepeatableJobDeps,
  network: NetworkRepeatableDeps | undefined,
  signals?: InquirySignalsRepeatableDeps,
  lists?: ListRepeatableDeps,
  graph?: GraphRepeatableDeps,
): RepeatableJob[] {
  const { db, clock, logger, outboundHttp } = deps;
  // C90.5, C107.1: the signals outbox sweep, whenever the worker computes signals.
  const signalSweep: RepeatableJob[] =
    signals === undefined
      ? []
      : [
          {
            name: INQUIRY_SIGNALS_SWEEP_QUEUE,
            repeat: { every: INQUIRY_SIGNALS_SWEEP_INTERVAL_MS },
            run: () => runInquirySignalsSweep({ db, clock, logger, signals: signals.signals }),
          },
        ];
  // C99.4, C99.7, C100.2, C107.1 (Workflow 7B): the list sweeps, whenever the worker runs lists.
  const listSweeps: RepeatableJob[] =
    lists === undefined
      ? []
      : [
          {
            name: LIST_SCREEN_SWEEP_QUEUE,
            repeat: { every: LIST_SWEEP_INTERVAL_MS },
            run: () => runListScreenSweep({ db, clock, logger, screens: lists.screens }),
          },
          {
            name: LIST_IMPORT_SWEEP_QUEUE,
            repeat: { every: LIST_SWEEP_INTERVAL_MS },
            run: () => runListImportSweep({ db, clock, logger, imports: lists.imports }),
          },
          {
            name: LIST_ITEM_EMBED_SWEEP_QUEUE,
            repeat: { every: LIST_SWEEP_INTERVAL_MS },
            run: () =>
              runListItemEmbedSweep({
                db,
                clock,
                logger,
                embeds: lists.embeds,
                events: lists.events,
              }),
          },
        ];
  // C101.3, C101.5, C101.6, C102.4, C107.1 (Workflow 7B): the graph's sweeps, the backfill tick
  // and the nightly components, whenever the worker runs the graph.
  const graphJobs: RepeatableJob[] =
    graph === undefined
      ? []
      : [
          {
            name: GRAPH_INDEX_SWEEP_QUEUE,
            repeat: { every: GRAPH_SWEEP_INTERVAL_MS },
            run: () => runGraphIndexSweep({ db, clock, logger, index: graph.index }),
          },
          {
            name: GRAPH_QUERY_SWEEP_QUEUE,
            repeat: { every: GRAPH_SWEEP_INTERVAL_MS },
            run: () => runGraphQuerySweep({ db, clock, logger, queries: graph.queries }),
          },
          {
            name: GRAPH_BACKFILL_QUEUE,
            repeat: { every: GRAPH_BACKFILL_INTERVAL_MS },
            run: () =>
              runGraphBackfill({
                db,
                clock,
                logger,
                keyring: graph.keyring,
                blindIndexKey: graph.blindIndexKey,
              }),
          },
          {
            name: GRAPH_COMPONENTS_QUEUE,
            repeat: { pattern: GRAPH_COMPONENTS_PATTERN },
            run: () => runGraphComponents({ db, clock, logger }),
          },
        ];
  const sweep = [...signalSweep, ...listSweeps, ...graphJobs];
  if (network?.network.refresh !== true) {
    return sweep;
  }
  return [
    ...sweep,
    {
      name: NETWORK_REFRESH_QUEUE,
      repeat: { every: NETWORK_REFRESH_INTERVAL_MS },
      run: () =>
        runNetworkRefresh({
          db,
          clock,
          logger,
          outboundHttp,
          storage: network.storage,
          network: network.network,
        }),
    },
  ];
}

/** The Phase 5 repeatable jobs the operator turned on, in a stable order. */
export function phase5RepeatableJobs(deps: RepeatableJobDeps): RepeatableJob[] {
  const jobs: RepeatableJob[] = [];
  if (deps.verificationQueue !== undefined) {
    jobs.push(submittedVerificationSweepJob(deps, deps.verificationQueue));
  }
  if ((deps.maliciousFeeds?.feeds.length ?? 0) > 0) {
    jobs.push(maliciousFeedRefreshJob(deps));
  }
  if (deps.nfc?.trustAnchorRefresh === true) {
    jobs.push(trustAnchorRefreshJob(deps));
  }
  return jobs;
}

/** C132.6, C133.6, C138.1 (Workflow 8B): what the case sweeps read beyond the Phase 5 deps. */
export interface CaseRepeatableDeps {
  events: TransactionalEventPublisher;
  /** C138.1 (checkpoint (F)): `case-export-sweep` deletes expired export files. */
  storage: FileStorage;
  /** C137.4, C143.2: the `case-bulk` producer, through which `case-bulk-sweep` enqueues again. */
  bulk?: CaseBulkQueue | undefined;
  /**
   * K8-28 (Workflow 8D): the case file producers, through which `case-export-sweep` enqueues again
   * the exports, scans and renditions left unfinished (`jobs/cases/recovery.ts`).
   */
  exports?: CaseExportQueue | undefined;
  scans?: CaseAttachmentScanQueue | undefined;
  renditions?: CaseRenditionQueue | undefined;
  /**
   * K8-20 (Workflow 8D; decision 76): the worker's mailer, through which `case-notification-emails`
   * sends the link-only case emails, and the console's public URL their links name.
   */
  mailer?: Mailer | undefined;
  dashboardPublicUrl?: string | undefined;
}

/**
 * C143.1 (Workflow 8B Stage 1b (Q)): the case sweeps, whenever the worker runs the case jobs: `case-sla`
 * every 30 seconds and `case-reassign` every 60, each calling its owner's function
 * (`jobs/repeatable/cases.ts`, `api-queues-sla`) with its `CaseSweepDeps`.
 */
export function caseRepeatableJobs(
  deps: RepeatableJobDeps,
  cases: CaseRepeatableDeps | undefined,
): RepeatableJob[] {
  if (cases === undefined) {
    return [];
  }
  const sweepDeps = { db: deps.db, clock: deps.clock, logger: deps.logger, events: cases.events };
  return [
    {
      name: CASE_SLA_QUEUE,
      repeat: { every: CASE_SLA_INTERVAL_MS },
      run: () => runCaseSlaSweep(sweepDeps),
    },
    {
      name: CASE_REASSIGN_QUEUE,
      repeat: { every: CASE_REASSIGN_INTERVAL_MS },
      run: () => runCaseReassignSweep(sweepDeps),
    },
    // K8-24 (Workflow 8D; C132.2): each policy assigns its sources' waiting cases into its agents' room.
    {
      name: CASE_ASSIGNMENT_DRAIN_QUEUE,
      repeat: { every: CASE_ASSIGNMENT_DRAIN_INTERVAL_MS },
      run: () => runCaseAssignmentDrain(sweepDeps),
    },
    // C138.1, C143.1 (checkpoint (F)): expired export files, `api-case-files`'.
    {
      name: CASE_EXPORT_SWEEP_QUEUE,
      repeat: { every: CASE_EXPORT_SWEEP_INTERVAL_MS },
      run: async () => {
        await runCaseExportSweep({
          db: deps.db,
          clock: deps.clock,
          logger: deps.logger,
          storage: cases.storage,
        });
        // K8-28 (Workflow 8D): the exports, scans and renditions left unfinished for a period.
        const { exports, scans, renditions } = cases;
        if (exports !== undefined || scans !== undefined || renditions !== undefined) {
          const before = new Date(deps.clock.now().getTime() - CASE_EXPORT_SWEEP_INTERVAL_MS);
          await requeueUnfinishedCaseFileWork({ db: deps.db, exports, scans, renditions }, before);
        }
      },
    },
    // K8-20 (Workflow 8D; decision 76): the link-only case emails, with the worker's mailer.
    ...(cases.mailer === undefined
      ? []
      : [
          {
            name: CASE_NOTIFICATION_EMAIL_QUEUE,
            repeat: { every: CASE_NOTIFICATION_EMAIL_INTERVAL_MS },
            run: async () => {
              const mailer = cases.mailer;
              if (mailer !== undefined) {
                await runCaseNotificationEmails({
                  db: deps.db,
                  clock: deps.clock,
                  logger: deps.logger,
                  mailer,
                  dashboardPublicUrl: cases.dashboardPublicUrl,
                });
              }
            },
          },
        ]),
    // C137.4, C143.2 (Workflow 8B Stage 4): bulk actions left unfinished, enqueued again.
    ...(cases.bulk === undefined
      ? []
      : [
          {
            name: CASE_BULK_SWEEP_QUEUE,
            repeat: { every: CASE_BULK_SWEEP_INTERVAL_MS },
            run: async () => {
              const bulk = cases.bulk;
              if (bulk !== undefined) {
                const before = new Date(deps.clock.now().getTime() - CASE_BULK_SWEEP_INTERVAL_MS);
                await requeueUnfinishedCaseBulkActions(deps.db, bulk, before);
              }
            },
          },
        ]),
  ];
}

/**
 * C152.2, C150.9, C174.3 (Workflow 9A Stage 1b (S)): the flow's sweep, whenever the worker runs the
 * flow's jobs (`StartWorkersOptions.flow`), calling its owner's job (`jobs/repeatable/flow-actions.ts`,
 * `api-flow-actions`).
 */
/**
 * C152.2 (Workflow 9A): the flow's sweep, scheduled only with the flow. `flow` is the worker's
 * event publisher and workflow step producer, which each pass hands its events and steps to
 * (`true` alone: the outbox only). `runPass` is the pass, injected by tests.
 */
export function phase9RepeatableJobs(
  deps: RepeatableJobDeps,
  flow: boolean | FlowSweepProducers,
  runPass: (passDeps: FlowActionSweepDeps) => Promise<FlowActionSweepResult> = runFlowActionSweep,
): RepeatableJob[] {
  if (flow === false) {
    return [];
  }
  const producers = flow === true ? {} : flow;
  return [flowActionSweepJob(deps, producers, runPass)];
}

/** C163.2 (Workflow 9B Stage 1b (A)): the worker's producer the analytics pass queues rebuilds on. */
export interface AnalyticsRepeatableDeps {
  rebuilds: AnalyticsRebuildQueue;
}

/**
 * C163.4, C174.3 (Workflow 9B Stage 1b (A)): `analytics-rollup` every 5 minutes, whenever the worker
 * runs analytics (`StartWorkersOptions.analytics`), calling its owner's pass (`jobs/analytics/rollup.ts`,
 * `api-analytics`) with the rebuild producer. `runPass` is the pass, injected by tests.
 */
export function analyticsRepeatableJobs(
  deps: RepeatableJobDeps,
  analytics: AnalyticsRepeatableDeps | undefined,
  runPass: (passDeps: AnalyticsRollupDeps) => Promise<AnalyticsRollupResult> = runAnalyticsRollup,
): RepeatableJob[] {
  if (analytics === undefined) {
    return [];
  }
  return [
    {
      name: ANALYTICS_ROLLUP_QUEUE,
      repeat: { every: ANALYTICS_ROLLUP_INTERVAL_MS },
      run: () =>
        runPass({
          db: deps.db,
          clock: deps.clock,
          logger: deps.logger,
          rebuilds: analytics.rebuilds,
        }),
    },
  ];
}

/** C169.6 (Workflow 9B Stage 1b (W)): what the webhook failure alerts read beyond the Phase 5 deps. */
export interface WebhookAlertRepeatableDeps {
  /** The mailer of the link-only alert emails. */
  mailer?: Mailer | undefined;
  /** The console's public URL the emails' links name. */
  dashboardPublicUrl?: string | undefined;
}

/**
 * C169.6, C174.3 (Workflow 9B Stage 1b (W)): `webhook-failure-alerts` every 60 seconds, whenever the
 * worker runs them (`StartWorkersOptions.webhookAlerts`), calling its owner's pass
 * (`jobs/repeatable/webhook-alerts.ts`, `api-keys-webhooks`). `runPass` is the pass, injected by tests.
 */
export function webhookAlertRepeatableJobs(
  deps: RepeatableJobDeps,
  alerts: WebhookAlertRepeatableDeps | undefined,
  runPass: RunWebhookFailureAlerts = runWebhookFailureAlerts,
): RepeatableJob[] {
  if (alerts === undefined) {
    return [];
  }
  return [
    {
      name: WEBHOOK_FAILURE_ALERTS_QUEUE,
      repeat: { every: WEBHOOK_FAILURE_ALERTS_INTERVAL_MS },
      run: async () => {
        await runPass({
          db: deps.db,
          clock: deps.clock,
          logger: deps.logger,
          mailer: alerts.mailer,
          dashboardPublicUrl: alerts.dashboardPublicUrl,
        });
      },
    },
  ];
}

/** C166.1, C166.5, C174.3 (Workflow 9B Stage 1b (X)): what `export-sweep` reads beyond the Phase 5 deps. */
export interface ExportRepeatableDeps {
  storage: FileStorage;
  /** The `export` producer, for an export left unfinished. */
  exports: ExportQueue;
  /** The `report-bulk` producer, for a bulk job left unfinished. */
  reportBulk: ReportBulkQueue;
}

/**
 * C166.1, C166.5, C174.3 (Workflow 9B Stage 1b (X)): `export-sweep` every 60 seconds, whenever the
 * worker runs exports (`StartWorkersOptions.exports`), calling its owner's pass
 * (`jobs/exports/sweep.ts`, `api-exports`) with the storage and both producers. `runPass` is the
 * pass, injected by tests.
 */
export function exportRepeatableJobs(
  deps: RepeatableJobDeps,
  exportDeps: ExportRepeatableDeps | undefined,
  runPass: RunExportSweep = runExportSweep,
): RepeatableJob[] {
  if (exportDeps === undefined) {
    return [];
  }
  return [
    {
      name: EXPORT_SWEEP_QUEUE,
      repeat: { every: EXPORT_SWEEP_INTERVAL_MS },
      run: async () => {
        await runPass({
          db: deps.db,
          storage: exportDeps.storage,
          clock: deps.clock,
          logger: deps.logger,
          exports: exportDeps.exports,
          reportBulk: exportDeps.reportBulk,
        });
      },
    },
  ];
}
