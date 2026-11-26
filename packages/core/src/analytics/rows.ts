/**
 * C163.3, C163.4 (Phase 9, Workflow 9B Stage 1a, `contracts-9b`): the rollup row types, one per
 * table `foundation-9b` (A) creates, in the same order and with the same columns (camelCase here,
 * snake_case in the database). Frozen; `integration-9b` alone changes this file.
 *
 * Every row is environment-scoped and counts only: no id of an end user and no value, with one
 * exception, `AnalyticsCaseAssigneeDailyRow.userId`, an operator's id, so that table is personal data
 * about employees (review P20: deleted or re-keyed to "former user" with its user, kept for
 * `analytics-assignee-retention-months`). Every row carries:
 * - `day`, a local date `YYYY-MM-DD` in `timeZone`, the reporting zone it was computed in (C163.2:
 *   a zone change never relabels a bucket it did not rebuild, review H04);
 * - `source` (C163.4): `facts` rows are recomputed from unredacted inquiries while their day is
 *   open; `redacted` rows hold the frozen contribution of inquiries redacted while it was open.
 */
import type {
  FlowRecordDeviceKind,
  FlowRecordPlatform,
  FileCaptureMethod,
} from '../flow-records.js';
import type { AnalyticsCheckStatus, AnalyticsRollupSource } from './definitions.js';

/** The columns every rollup row has. */
export interface AnalyticsRowKey {
  readonly environmentId: string;
  /** The local day, `YYYY-MM-DD`, in `timeZone`. */
  readonly day: string;
  /** The IANA zone the day was computed in. */
  readonly timeZone: string;
  readonly source: AnalyticsRollupSource;
}

/** The inquiry dimensions of C163.3: the template and its version, the first platform and device. */
export interface AnalyticsInquiryDimensions {
  readonly inquiryTemplateId: string;
  readonly inquiryTemplateVersionId: string;
  /** The inquiry's `first_platform`; `null` when no session served a step. */
  readonly platform: FlowRecordPlatform | null;
  /** The inquiry's `first_device_kind`; `null` when unknown (a TV, no session). */
  readonly deviceKind: FlowRecordDeviceKind | null;
}

/** `analytics_inquiry_daily`: one row per day, source and dimension values. */
export interface AnalyticsInquiryDailyRow extends AnalyticsRowKey, AnalyticsInquiryDimensions {
  readonly created: number;
  readonly started: number;
  readonly interacted: number;
  readonly finished: number;
  readonly completed: number;
  readonly completedVerified: number;
  readonly completedWithFallback: number;
  readonly completedUnverified: number;
  readonly failed: number;
  readonly expiredBeforeStart: number;
  readonly expiredAfterStart: number;
  readonly approved: number;
  readonly declined: number;
  readonly needsReview: number;
  readonly markedForReview: number;
  readonly decidedAutomatic: number;
  readonly decidedManual: number;
  readonly decidedNotDeclared: number;
  /** C163.5: finished inquiries per duration bucket, `DURATION_BUCKET_COUNT` entries. */
  readonly finishSecondsHistogram: readonly number[];
}

/** `analytics_inquiry_tag_daily`: keyed by the tag's name (inquiry tags have no id; review F14). */
export interface AnalyticsInquiryTagDailyRow extends AnalyticsRowKey, AnalyticsInquiryDimensions {
  readonly tag: string;
  readonly created: number;
  readonly finished: number;
  readonly completed: number;
  readonly failed: number;
}

/** `analytics_step_daily`: a version's step (C164.2), from the step record. */
export interface AnalyticsStepDailyRow extends AnalyticsRowKey {
  readonly inquiryTemplateId: string;
  readonly inquiryTemplateVersionId: string;
  readonly stepId: string;
  readonly entered: number;
  readonly exited: number;
  readonly revisits: number;
}

/**
 * K9-24 (AL6): the reserved step a transition into an inquiry's first person-visible step comes from,
 * so the entry step has transitions into it. Outside the step id form, so it never names a step.
 */
export const ANALYTICS_FLOW_START_STEP_ID = '$start';

/** `analytics_transition_daily`: a move between two person-visible steps of a version. */
export interface AnalyticsTransitionDailyRow extends AnalyticsRowKey {
  readonly inquiryTemplateId: string;
  readonly inquiryTemplateVersionId: string;
  readonly fromStepId: string;
  readonly toStepId: string;
  readonly count: number;
}

/** `analytics_path_daily`: the per-path view (review H17); `pathSha256` keys `stepIds`. */
export interface AnalyticsPathDailyRow extends AnalyticsRowKey {
  readonly inquiryTemplateId: string;
  readonly inquiryTemplateVersionId: string;
  readonly pathSha256: string;
  readonly stepIds: readonly string[];
  readonly count: number;
}

/** `analytics_verification_daily`: attempts by type, capture method and the ID's country. */
export interface AnalyticsVerificationDailyRow extends AnalyticsRowKey {
  readonly inquiryTemplateId: string;
  readonly inquiryTemplateVersionId: string;
  readonly verificationType: string;
  /** `files.capture_method`, client-reported (C153.2); `null` when no client reported one. */
  readonly captureMethod: FileCaptureMethod | null;
  /** The government ID's country (ISO 3166-1 alpha-2); `null` for other types or unknown. */
  readonly country: string | null;
  readonly created: number;
  readonly submitted: number;
  readonly passed: number;
  readonly failed: number;
  readonly requiresRetry: number;
  readonly skipped: number;
  readonly needsReview: number;
  readonly canceled: number;
}

/** `analytics_verification_step_daily`: the per-person-and-step outcome (review H06). */
export interface AnalyticsVerificationStepDailyRow extends AnalyticsRowKey {
  readonly inquiryTemplateId: string;
  readonly inquiryTemplateVersionId: string;
  readonly stepId: string;
  readonly verificationType: string;
  readonly entered: number;
  readonly passed: number;
  readonly failedAfterAttempts: number;
  readonly needsReview: number;
  readonly skipped: number;
}

/** `analytics_check_daily`: results by check, requirement and status (C164.4, review H03). */
export interface AnalyticsCheckDailyRow extends AnalyticsRowKey {
  readonly inquiryTemplateId: string;
  readonly inquiryTemplateVersionId: string;
  readonly verificationType: string;
  readonly checkName: string;
  readonly requirement: 'required' | 'not_required';
  readonly status: AnalyticsCheckStatus;
  readonly count: number;
}

/** `analytics_check_reason_daily`: results by check, type, requirement and reason code. */
export interface AnalyticsCheckReasonDailyRow extends AnalyticsRowKey {
  readonly inquiryTemplateId: string;
  readonly inquiryTemplateVersionId: string;
  /** K9-24 (AL7): the type and requirement of the check results the reason belongs to. */
  readonly verificationType: string;
  readonly checkName: string;
  readonly requirement: 'required' | 'not_required';
  readonly reason: string;
  readonly count: number;
}

/** `analytics_case_daily`: cases on their own creation day (review H05). */
export interface AnalyticsCaseDailyRow extends AnalyticsRowKey {
  readonly caseTemplateId: string;
  readonly created: number;
  readonly resolved: number;
  readonly slaMet: number;
  readonly slaMissed: number;
  /** C163.5: resolved cases per duration bucket, `DURATION_BUCKET_COUNT` entries. */
  readonly resolutionSecondsHistogram: readonly number[];
}

/** `analytics_case_assignee_daily`: personal data about employees (review P20). */
export interface AnalyticsCaseAssigneeDailyRow extends AnalyticsRowKey {
  readonly caseTemplateId: string;
  /** The operator's `usr_` id, or `null` once re-keyed to "former user". */
  readonly userId: string | null;
  readonly assigned: number;
  readonly resolved: number;
}

/** `analytics_signal_daily`: values in the registry's fixed bins (`SIGNAL_BINS`, C164.6). */
export interface AnalyticsSignalDailyRow extends AnalyticsRowKey, AnalyticsInquiryDimensions {
  readonly signalName: string;
  /** A bin of `SIGNAL_BINS[signalName]`, or `SIGNAL_NOT_EVALUATED_BIN` for a null value. */
  readonly bin: string;
  readonly count: number;
}

/** The twelve rollup tables of C163.3, by name, in `foundation-9b`'s order. */
export const ANALYTICS_ROLLUP_TABLES = Object.freeze([
  'analytics_inquiry_daily',
  'analytics_inquiry_tag_daily',
  'analytics_step_daily',
  'analytics_transition_daily',
  'analytics_path_daily',
  'analytics_verification_daily',
  'analytics_verification_step_daily',
  'analytics_check_daily',
  'analytics_check_reason_daily',
  'analytics_case_daily',
  'analytics_case_assignee_daily',
  'analytics_signal_daily',
] as const);
export type AnalyticsRollupTable = (typeof ANALYTICS_ROLLUP_TABLES)[number];
