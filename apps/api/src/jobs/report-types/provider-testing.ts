/**
 * Test support for the provider-backed report jobs (C81, C82): a run context over a report of a
 * type, with the worker's deps at their defaults, and the report resource a run's result would
 * serve, built through the contracts' `buildReportResource` so each test checks its output
 * against the frozen schema. Only tests import this file; every value is synthetic.
 */
import { newId, resolveReportTemplateConfig, type ReportResource } from '@openverify/contracts';
import { REPORT_REGISTRY, type ReportOrigin, type ReportType } from '@openverify/core';
import type { Db, StoredReport, StoredReportMatch } from '@openverify/db';
import { UNMASKED } from '../../auth/pii.js';
import { PHASE6_DEFAULTS, type ReportLimits, type WatchlistSettings } from '../../config.js';
import type { BoundProviders, EnvironmentKind } from '../../ports.js';
import { reportResource } from '../../services/reports/resources.js';
import { createCapturingLogger } from '../testing.js';
import type { ReportJobDeps, ReportRunContext, ReportRunResult } from './job.js';

export const REPORT_NOW = new Date('2026-10-27T12:00:00.000Z');

export const TEST_WATCHLIST_SETTINGS: WatchlistSettings = {
  sourcesDisabled: [],
  refresh: false,
  removedRetentionDays: PHASE6_DEFAULTS.removedRetentionDays,
  euFsfToken: null,
  wikidataUserAgent: null,
  wikidataSparqlUrl: PHASE6_DEFAULTS.wikidataSparqlUrl,
  pep: {
    openTenureMaxYears: PHASE6_DEFAULTS.pepOpenTenureMaxYears,
    includeRelatives: false,
    retentionMonths: PHASE6_DEFAULTS.pepRetentionMonths,
    headRetentionMonths: PHASE6_DEFAULTS.pepHeadRetentionMonths,
  },
};

export const TEST_REPORT_LIMITS: ReportLimits = {
  perMinute: PHASE6_DEFAULTS.reportsPerMinute,
  maxRecurringPerEnvironment: PHASE6_DEFAULTS.maxRecurringPerEnvironment,
  maxMediaRunsPerDay: PHASE6_DEFAULTS.maxMediaRunsPerDay,
};

export interface ReportContextOptions {
  type: ReportType;
  query: Readonly<Record<string, unknown>>;
  environmentId?: string;
  environmentKind?: EnvironmentKind;
  origin?: ReportOrigin;
  inquiryId?: string | null;
  config?: Readonly<Record<string, unknown>>;
  providers?: BoundProviders;
  deps?: Partial<ReportJobDeps>;
  attempt?: number;
  /** When the run was made (its id's time); now by default. */
  runCreatedAt?: Date;
  db?: Db;
}

/** A run context of a report of `type`. */
export function reportContext(options: ReportContextOptions): ReportRunContext & {
  deps: ReportJobDeps & { logger: ReturnType<typeof createCapturingLogger> };
} {
  const logger = createCapturingLogger();
  const deps = {
    db: options.db ?? ({} as Db),
    clock: { now: () => REPORT_NOW },
    watchlists: TEST_WATCHLIST_SETTINGS,
    limits: TEST_REPORT_LIMITS,
    ...options.deps,
    logger,
  };
  return {
    report: {
      id: newId('rep'),
      environmentId: options.environmentId ?? newId('env'),
      environmentKind: options.environmentKind ?? 'sandbox',
      type: options.type,
      origin: options.origin ?? 'api',
      inquiryId: options.inquiryId ?? null,
      accountId: null,
      query: options.query,
      querySources: {},
      config: resolveReportTemplateConfig(options.type, options.config ?? {}),
      createdAt: REPORT_NOW,
    },
    run: {
      id: newId('rpr', { now: options.runCreatedAt ?? REPORT_NOW }),
      runType: 'initial',
      triggerSyncId: null,
      attempt: options.attempt ?? 1,
    },
    deps,
    providers: options.providers ?? {},
    signal: new AbortController().signal,
  };
}

/**
 * The resource a completed run's result serves (C70.2): the report and match rows the framework
 * would persist (`jobs/reports/persist.ts`), served by the framework's own `reportResource`
 * (unmasked) through the frozen schema, so only the type's served names reach the attributes and
 * a media article is the match snapshot's `entity` with its match id and score.
 */
export function servedReport(ctx: ReportRunContext, result: ReportRunResult): ReportResource {
  const { report, run } = ctx;
  const reviewed = REPORT_REGISTRY[report.type].review === 'matches';
  const matches: StoredReportMatch[] = result.matches.map((found) => ({
    id: newId('rpm'),
    environmentId: report.environmentId,
    reportId: report.id,
    sourceId: found.sourceId,
    entryIndex: 'e'.repeat(64),
    evidenceHash: 'f'.repeat(64),
    score: found.score,
    snapshot: {
      ...found.snapshot,
      'entry-key': found.entryKey,
      'content-hash': found.contentHash,
      'risk-data-hash': found.riskDataHash,
      'matched-name': found.matchedName,
    },
    status: 'open',
    reviewStatus: 'pending',
    riskLevel: null,
    notifyOnChange: false,
    presentInLastRun: true,
    firstRunId: run.id,
    lastRunId: run.id,
    lapsedFrom: null,
    reviewedAt: null,
    delistedAt: null,
    createdAt: REPORT_NOW,
    updatedAt: REPORT_NOW,
  }));
  const stored: StoredReport = {
    id: report.id,
    environmentId: report.environmentId,
    reportType: report.type,
    reportTemplateId: newId('rptp'),
    reportTemplateVersionId: newId('rptpv'),
    versionNumber: 1,
    origin: report.origin,
    status: result.errors.length > 0 ? 'errored' : 'ready',
    query: { ...report.query },
    queryFields: Object.keys(report.query),
    querySources: {},
    result: { ...result.result },
    coverage:
      result.coverage === null
        ? null
        : { complete: result.coverage.complete, limits: [...result.coverage.limits] },
    hasMatch: reviewed && matches.length > 0,
    errors: result.errors.map((error) => ({ ...error })),
    unavailableFields: result.unavailableFields.map((entry) => ({ ...entry })),
    sources: [],
    matcherVersion: result.matcherVersion,
    provider: result.provider,
    thresholds: result.thresholds === null ? null : { ...result.thresholds },
    notices: [...result.notices],
    inquiryId: report.inquiryId,
    accountId: null,
    accountIds: [],
    recurrenceIntervalDays: null,
    nextRunAt: null,
    pausedAt: null,
    pausedReason: null,
    tags: [],
    cryptoAddressIndex: null,
    completedRunCount: 1,
    createdAt: REPORT_NOW,
    completedAt: REPORT_NOW,
    redactedAt: null,
  };
  return reportResource({ report: stored, matches }, UNMASKED);
}
