/**
 * C74.1 (Workflow 6A Stage 3, owner `api-reports`): the `report-run` processor, the run framework.
 * The worker (`worker.ts`, `reportRunProcessor`) calls {@link processReportRun} for each job of
 * the `report-run` queue (`jobs/report-queues.ts`) and maps a `PermanentJobError` to BullMQ's
 * `UnrecoverableError`; everything else is the framework's:
 *
 * - claim the run with one conditional update (pending and due, or running with an expired
 *   claim), a fresh claim token and `claimed_until` now + 10 minutes; a job whose run is finished,
 *   redacted, held by another live claim or not yet due returns `not_claimed` and writes nothing;
 *   an eleventh claim ends the run `errored` instead of running it;
 * - build the `ReportRunContext` (the decrypted query, the pinned configuration, the
 *   providers of the environment kind, a 5-minute abort signal) and call the type's job
 *   (`jobs/report-types/index.ts`, `reportTypeJob(type).run`);
 * - persist the outcome under the C73.7 locks, fenced by the claim token (`persist.ts`): the match
 *   state machine, the report columns, events, `on-report-match`, the schedule; a wait (C81.2)
 *   goes back to `pending` with `not_before`, without counting the claim;
 * - on a retryable error, release the claim and rethrow; on the last attempt, a permanent error or
 *   a type whose job is not built, end the run `errored` with `execution_error`, fenced as
 *   completion is.
 *
 * The signature and the deps are frozen by `foundation-6` (Stage 1b).
 */
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { resolveReportTemplateConfig } from '@openverify/contracts';
import {
  claimReportRun,
  deferReportRun,
  getEnvironment,
  getReport,
  getReportTemplateVersion,
  releaseReportRunClaim,
  type Keyring,
} from '@openverify/db';
import type { TransactionalEventPublisher } from '../../events/index.js';
import type { ReportRunJob, ReportRunQueue } from '../../ports.js';
import { isPermanentJobFailure } from '../process-verification.js';
import {
  reportTypeJob as registeredJob,
  ReportTypeNotBuiltError,
  type ReportJobDeps,
  type ReportRunContext,
  type ReportTypeJob,
} from '../report-types/index.js';
import { endRunErrored, persistRunResult } from './persist.js';

/** What the framework reads; the worker passes all of it. */
export interface ReportRunProcessorDeps extends ReportJobDeps {
  /** Stages the run's events in its completion transaction, dispatched after commit (C70.4). */
  events: TransactionalEventPublisher;
  /** The keyring of the uploads and sealed columns (the default keyring is set as well). */
  keyring: Keyring;
  /** C74.5: the producer of a run the framework inserts (a resume catch-up), after commit. */
  reportRuns?: ReportRunQueue | undefined;
}

/** What the worker tells the framework about this BullMQ attempt. */
export interface ReportRunAttempt {
  /** BullMQ will not retry if this attempt throws: the framework ends the run `errored`. */
  lastAttempt: boolean;
}

/** What one job did; ids and statuses only. */
export type ReportRunProcessResult =
  | { outcome: 'completed'; status: 'ready' | 'errored' }
  | { outcome: 'waiting'; notBefore: Date }
  | { outcome: 'not_claimed' };

export type ProcessReportRun = (
  job: ReportRunJob,
  deps: ReportRunProcessorDeps,
  attempt: ReportRunAttempt,
) => Promise<ReportRunProcessResult>;

/** C74.1: a claim's lease, longer than a run may take. */
export const REPORT_RUN_CLAIM_MS = 10 * 60_000;
/** C74.1: a run aborts itself after this long, so its claim never expires under it. */
export const REPORT_RUN_TIMEOUT_MS = 5 * 60_000;
/** C74.1: an eleventh claim ends the run `errored` (a run that kills its worker cannot loop). */
export const REPORT_RUN_MAX_CLAIMS = 10;

export interface ReportRunProcessorOptions {
  /** The type jobs (`REPORT_TYPE_JOBS` by default). */
  jobs?: ((type: ReportRunContext['report']['type']) => ReportTypeJob) | undefined;
  /** A fresh claim token. */
  token?: (() => string) | undefined;
}

const WORKER = `${hostname()}:${String(process.pid)}`;

function freshToken(): string {
  return `${WORKER}:${randomBytes(8).toString('hex')}`;
}

/** The framework with its type jobs; {@link processReportRun} is it with the registered ones. */
export function createReportRunProcessor(
  options: ReportRunProcessorOptions = {},
): ProcessReportRun {
  const jobs = options.jobs ?? registeredJob;
  const token = options.token ?? freshToken;
  return async (job, deps, attempt) => {
    const { db, clock } = deps;
    const now = clock.now();
    const claimToken = token();
    const claimed = await claimReportRun(db, job.environmentId, job.runId, {
      token: claimToken,
      now,
      claimedUntil: new Date(now.getTime() + REPORT_RUN_CLAIM_MS),
    });
    if (claimed === null) {
      return { outcome: 'not_claimed' };
    }
    if (claimed.attempt > REPORT_RUN_MAX_CLAIMS) {
      return endRunErrored(deps, job, claimToken);
    }
    let context: ReportRunContext;
    try {
      context = await runContext(deps, job, claimed);
    } catch (error) {
      return failed(deps, job, claimToken, attempt, error);
    }
    let outcome;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, REPORT_RUN_TIMEOUT_MS);
    try {
      outcome = await jobs(context.report.type).run({ ...context, signal: controller.signal });
    } catch (error) {
      return await failed(deps, job, claimToken, attempt, error);
    } finally {
      clearTimeout(timer);
    }
    if (outcome.kind === 'wait') {
      await deferReportRun(db, job.environmentId, job.runId, claimToken, outcome.notBefore);
      return { outcome: 'waiting', notBefore: outcome.notBefore };
    }
    try {
      return await persistRunResult(deps, job, claimToken, outcome.result);
    } catch (error) {
      return failed(deps, job, claimToken, attempt, error);
    }
  };
}

/** A failed attempt: the last one (or a permanent failure) ends the run; any other gives it back. */
async function failed(
  deps: ReportRunProcessorDeps,
  job: ReportRunJob,
  token: string,
  attempt: ReportRunAttempt,
  error: unknown,
): Promise<ReportRunProcessResult> {
  if (
    attempt.lastAttempt ||
    error instanceof ReportTypeNotBuiltError ||
    isPermanentJobFailure(error)
  ) {
    deps.logger.warn(
      { reportId: job.reportId, runId: job.runId, error: describe(error) },
      'report run failed for good',
    );
    return endRunErrored(deps, job, token);
  }
  try {
    await releaseReportRunClaim(deps.db, job.environmentId, job.runId, token);
  } catch {
    // The claim expires on its own (C74.1).
  }
  throw error;
}

/** The error's class only: a message may carry a provider's body. */
function describe(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/** The run's context, as the framework read it under its claim. */
async function runContext(
  deps: ReportRunProcessorDeps,
  job: ReportRunJob,
  run: { id: string; runType: string; triggerSyncId: number | null; attempt: number },
): Promise<ReportRunContext> {
  const report = await getReport(deps.db, job.environmentId, job.reportId);
  const environment = await getEnvironment(deps.db, job.environmentId);
  if (report === null || environment === null || report.query === null) {
    throw new Error('the report of the run is gone or redacted');
  }
  const version = await getReportTemplateVersion(
    deps.db,
    job.environmentId,
    report.reportTemplateVersionId,
  );
  if (version === null) {
    throw new Error('the pinned report template version is gone');
  }
  const config = resolveReportTemplateConfig(report.reportType, version.config);
  return {
    report: {
      id: report.id,
      environmentId: report.environmentId,
      environmentKind: environment.kind,
      type: report.reportType,
      origin: report.origin,
      inquiryId: report.inquiryId,
      accountId: report.accountId,
      query: report.query,
      querySources: report.querySources,
      config,
      createdAt: report.createdAt,
    },
    run: {
      id: run.id,
      runType: run.runType as ReportRunContext['run']['runType'],
      triggerSyncId: run.triggerSyncId,
      attempt: run.attempt,
    },
    deps,
    providers: deps.providers?.[environment.kind] ?? {},
    signal: new AbortController().signal,
  };
}

/** C74.1: the framework with the registered type jobs (`REPORT_TYPE_JOBS`). */
export const processReportRun: ProcessReportRun = createReportRunProcessor();
