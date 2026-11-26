/**
 * Report and run lifecycle (plan C69.2, C69.3, C74.1). A report's status is about processing,
 * never about the result: `has-match` carries the result, and reads as "no match" only beside
 * `ready` (C69.4). A report's status is its latest completed run's.
 */
import { z } from 'zod';
import { DomainError } from './errors.js';
import type { ReportEventAction } from './report-registry.js';

/** C69.2: `submitted` is reserved for parity; no Phase 6 path enters it (decision 3). */
export const REPORT_STATUSES = ['pending', 'submitted', 'ready', 'errored'] as const;
export const reportStatusSchema = z.enum(REPORT_STATUSES);
export type ReportStatus = z.infer<typeof reportStatusSchema>;

/** The event action of a report entering each status; `pending` and `submitted` emit none. */
export const REPORT_EVENT_ACTION_BY_STATUS = Object.freeze({
  ready: 'ready',
  errored: 'errored',
} as const satisfies Partial<Record<ReportStatus, ReportEventAction>>);

/**
 * C69.2: `pending` ends in `ready` or `errored`; a recurrable report's later runs move it
 * `ready → ready | errored` and `errored → ready | errored`, never back to `pending`.
 */
export const REPORT_TRANSITIONS: Readonly<Record<ReportStatus, readonly ReportStatus[]>> =
  Object.freeze({
    pending: Object.freeze(['ready', 'errored'] as const),
    // Decision 3: reserved for parity; nothing enters it in Phase 6, so nothing leaves it.
    submitted: Object.freeze([]),
    ready: Object.freeze(['ready', 'errored'] as const),
    errored: Object.freeze(['ready', 'errored'] as const),
  });

/** Raised when a caller asks for a transition the state machine forbids. */
export class InvalidReportTransitionError extends DomainError {
  readonly from: string;
  readonly to: string;

  constructor(from: string, to: string) {
    super('invalid_report_transition', `Report cannot transition from "${from}" to "${to}"`);
    this.from = from;
    this.to = to;
  }
}

export interface ReportTransitionOptions {
  /** A recurrable type's report may run again after its initial run (C74.5); defaults to true. */
  readonly recurrable?: boolean;
}

function isKnownStatus(value: string): value is ReportStatus {
  // Own-property lookup, so prototype keys such as "constructor" are not statuses.
  return Object.hasOwn(REPORT_TRANSITIONS, value);
}

/**
 * Whether a report may move from `from` to `to`. A report of a type that does not recur
 * (`recurrable: false`) runs once, so it only ever leaves `pending`.
 */
export function canTransitionReport(
  from: ReportStatus,
  to: ReportStatus,
  options: ReportTransitionOptions = {},
): boolean {
  if (!isKnownStatus(from) || !isKnownStatus(to)) {
    return false;
  }
  if (options.recurrable === false && from !== 'pending') {
    return false;
  }
  return REPORT_TRANSITIONS[from].includes(to);
}

/**
 * Validates a status change and returns the event action to emit for it.
 * @throws {InvalidReportTransitionError} when the transition is not allowed.
 */
export function transitionReport(
  from: ReportStatus,
  to: ReportStatus,
  options: ReportTransitionOptions = {},
): Extract<ReportEventAction, 'ready' | 'errored'> {
  if (!canTransitionReport(from, to, options) || (to !== 'ready' && to !== 'errored')) {
    throw new InvalidReportTransitionError(from, to);
  }
  return REPORT_EVENT_ACTION_BY_STATUS[to];
}

/** C74.1: a run row's status. */
export const REPORT_RUN_STATUSES = ['pending', 'running', 'ready', 'errored'] as const;
export const reportRunStatusSchema = z.enum(REPORT_RUN_STATUSES);
export type ReportRunStatus = z.infer<typeof reportRunStatusSchema>;

/** C74.1: how a run came to be; `list_update` (a re-screen after a sync, C74.4) is ours. */
export const REPORT_RUN_TYPES = ['initial', 'scheduled', 'manual', 'list_update'] as const;
export const reportRunTypeSchema = z.enum(REPORT_RUN_TYPES);
export type ReportRunType = z.infer<typeof reportRunTypeSchema>;

/** C73.2: what a run records beside its result, codes only. */
export const REPORT_RUN_NOTES = [
  'inquiry_already_decided',
  'report_match',
  'report_errored',
  'recurring_limit',
  'evidence_changed',
  'risk_data_changed',
  'match_not_found_in_run',
] as const;
export const reportRunNoteSchema = z.enum(REPORT_RUN_NOTES);
export type ReportRunNote = z.infer<typeof reportRunNoteSchema>;

/** C69.3: why a report or run is `errored`; never PII, a provider body or a URL. */
export const REPORT_ERROR_CODES = [
  'insufficient_input',
  'list_unavailable',
  'list_stale',
  'result_truncated',
  'matcher_data_unavailable',
  'provider_not_configured',
  'provider_error',
  'execution_error',
] as const;
export const reportErrorCodeSchema = z.enum(REPORT_ERROR_CODES);
export type ReportErrorCode = z.infer<typeof reportErrorCodeSchema>;

/** C69.3: the codes that name the source they are about. */
export const REPORT_SOURCE_ERROR_CODES: readonly ReportErrorCode[] = Object.freeze([
  'list_unavailable',
  'list_stale',
  'matcher_data_unavailable',
]);

/**
 * C70.2: who created a report (P05); C166.5 (Workflow 9B Stage 1b (X); contracts B34): `bulk`, a
 * report a bulk job created, as the Postgres enum `report_origin` now holds it.
 */
export const REPORT_ORIGINS = [
  'inquiry_completion',
  'api',
  'dashboard',
  'workflow',
  'bulk',
] as const;
export const reportOriginSchema = z.enum(REPORT_ORIGINS);
export type ReportOrigin = z.infer<typeof reportOriginSchema>;

/** C74.5: why monitoring is paused. */
export const REPORT_PAUSED_REASONS = ['operator', 'match'] as const;
export const reportPausedReasonSchema = z.enum(REPORT_PAUSED_REASONS);
export type ReportPausedReason = z.infer<typeof reportPausedReasonSchema>;

/** C73.2: what a history action records. */
export const REPORT_ACTION_TYPES = [
  'dismiss',
  'review',
  'pause',
  'resume',
  'run',
  'redact',
] as const;
export const reportActionTypeSchema = z.enum(REPORT_ACTION_TYPES);
export type ReportActionType = z.infer<typeof reportActionTypeSchema>;

/** C73.2: who took an action. */
export const REPORT_ACTOR_TYPES = ['user', 'api_key', 'system', 'workflow_run'] as const;
export const reportActorTypeSchema = z.enum(REPORT_ACTOR_TYPES);
export type ReportActorType = z.infer<typeof reportActorTypeSchema>;

/**
 * C78.5, C81.5: why a run did not compare every name, or searched less than everything. A closed
 * set with no names or scripts.
 */
export const REPORT_COVERAGE_LIMITS = [
  'lossy_script',
  'not_compared',
  'truncated',
  'unclassified_format',
  'title_only',
  'window_90_days',
  'lexicon_languages',
] as const;
export const reportCoverageLimitSchema = z.enum(REPORT_COVERAGE_LIMITS);
export type ReportCoverageLimit = z.infer<typeof reportCoverageLimitSchema>;

/** The status a report takes when a run completes with `runStatus` (C69.2). */
export function reportStatusOfRun(runStatus: 'ready' | 'errored'): ReportStatus {
  return runStatus;
}
