/**
 * C127.2, C127.3, C127.12: Run Report, Re-run Report and Run Verification, each a claim followed by
 * a wait. An `errored` report is the step error `report_errored`, never `has-match: false`, and a
 * timeout is always `report_timed_out` or `verification_timed_out`: this config has no `on-timeout`.
 * Everything a report read is an id or a code here; the hits stay on the report.
 */
import {
  REPORT_REVIEW_MODELS,
  checkStageSchema,
  checkStatusSchema,
  reportStatusSchema,
  reportTypeSchema,
  verificationTypeSchema,
} from '@openverify/core';
import { reportCoverageSchema } from '@openverify/contracts';
import { z } from 'zod';
import { actionReferenceSchema, actionValueMapSchema, plain, provisional } from './common.js';
import { VERIFICATION_RUNNABLE_WITHOUT_CAPTURE } from './registry.js';

/** C127.2: Phase 6's types finish in seconds to minutes; media can take hours. */
export const REPORT_ACTION_LIMITS = Object.freeze({
  'timeout-seconds': provisional(3_600, 'C127.2'),
  'timeout-seconds-ceiling': provisional(86_400, 'C127.2'),
  'selector-reports': provisional(100, 'C127.12: past it, `report_selector_limit`'),
});

const timeoutSchema = z
  .int()
  .min(1)
  .max(REPORT_ACTION_LIMITS['timeout-seconds-ceiling'].value)
  .optional();

const reportIdSchema = z.string().regex(/^rep_/);

const exactlyOneSubject = (config: {
  readonly 'inquiry-id'?: string | undefined;
  readonly 'account-id'?: string | undefined;
}): boolean => (config['inquiry-id'] === undefined) !== (config['account-id'] === undefined);

export const runReportConfigSchema = z
  .strictObject({
    'report-template-id': actionReferenceSchema,
    'inquiry-id': actionReferenceSchema.optional(),
    'account-id': actionReferenceSchema.optional(),
    /** The report's editable fields; a missing template input is `missing-input-error`. */
    fields: actionValueMapSchema.optional(),
    'timeout-seconds': timeoutSchema,
  })
  .refine(exactlyOneSubject, 'a report runs against an inquiry or an account');
export type RunReportConfig = z.infer<typeof runReportConfigSchema>;

/** H10: a match with what a decision needs to know of it, and no matched value. */
const reportMatchSchema = z.strictObject({
  id: z.string().min(1).max(64),
  method: z.string().min(1).max(64),
  tier: z.string().min(1).max(8),
  stage: checkStageSchema,
  confidence: z.number().min(0).max(1).nullable(),
  approximate: z.boolean(),
});

interface ReportAnswer {
  readonly status: string;
  readonly 'has-match': boolean | null;
  readonly 'match-count': number | null;
  readonly flagged: boolean | null;
}

/** C127.2, outcome 15: nothing reads as an answer until the report is `ready`. */
const heldUntilReady = (value: ReportAnswer): boolean =>
  value.status === 'ready' ||
  (value['has-match'] === null && value['match-count'] === null && value.flagged === null);

export const runReportOutputSchema = z
  .strictObject({
    'report-id': plain(reportIdSchema),
    'report-type': plain(reportTypeSchema),
    'review-model': plain(z.enum(REPORT_REVIEW_MODELS)),
    status: plain(reportStatusSchema),
    /** `null` unless `ready`, and for a type of review model `none`. */
    'has-match': plain(z.boolean().nullable()),
    'match-count': plain(z.int().min(0).nullable()),
    coverage: plain(reportCoverageSchema.nullable()),
    'unavailable-fields': plain(z.array(z.string().min(1).max(64))),
    errors: plain(z.array(z.string().min(1).max(64))),
    matches: plain(z.array(reportMatchSchema)),
    /** The type's own flag where `has-match` means nothing, such as `ip-address`'s. */
    flagged: plain(z.boolean().nullable()),
  })
  .refine(heldUntilReady, {
    message: 'a report that is not ready has no answer',
    path: ['has-match'],
  });
export type RunReportOutput = z.infer<typeof runReportOutputSchema>;

/** C127.12: chosen on the server; past the cap the step errors, never a silent truncation. */
const reportSelectorSchema = z.union([
  z.strictObject({ 'list-id': actionReferenceSchema }),
  z.strictObject({ 'account-id': actionReferenceSchema }),
]);

export const rerunReportConfigSchema = z.strictObject({
  selector: reportSelectorSchema,
  'timeout-seconds': timeoutSchema,
});
export type RerunReportConfig = z.infer<typeof rerunReportConfigSchema>;

interface RerunAnswer {
  readonly reports: readonly { readonly status: string }[];
  readonly 'any-match': boolean | null;
}

/** C127.12: `any-match` is `null` unless every run is `ready`. */
const anyMatchHeldUntilReady = (value: RerunAnswer): boolean =>
  value['any-match'] === null || value.reports.every(({ status }) => status === 'ready');

export const rerunReportOutputSchema = z
  .strictObject({
    reports: plain(
      z.array(
        z.strictObject({
          'report-id': reportIdSchema,
          status: reportStatusSchema,
          'has-match': z.boolean().nullable(),
        }),
      ),
    ),
    count: plain(z.int().min(0)),
    'any-match': plain(z.boolean().nullable()),
    errored: plain(z.array(reportIdSchema)),
  })
  .refine(anyMatchHeldUntilReady, {
    message: 'any-match has no answer until every run is ready',
    path: ['any-match'],
  });
export type RerunReportOutput = z.infer<typeof rerunReportOutputSchema>;

/**
 * K8-7 (C127.12, C140.5; ours): for each monitored report of one account whose query reads a field
 * the account now holds otherwise, a new report from the same template with the account's current
 * value, then a wait for each, as `rerun_report` waits. More than 100 monitored reports is
 * `report_selector_limit`, never a silent truncation.
 */
export const rescreenAccountReportsConfigSchema = z.strictObject({
  'account-id': actionReferenceSchema,
  'timeout-seconds': timeoutSchema,
});
export type RescreenAccountReportsConfig = z.infer<typeof rescreenAccountReportsConfigSchema>;

interface RescreenAnswer extends RerunAnswer {
  readonly count: number;
}

/** Nothing re-screened is no answer: `any-match` is `null` then, never `false`. */
const nothingScreenedHasNoAnswer = (value: RescreenAnswer): boolean =>
  value.count > 0 || value['any-match'] === null;

export const rescreenAccountReportsOutputSchema = z
  .strictObject({
    /** The new reports, one per stale monitored report. */
    reports: plain(
      z.array(
        z.strictObject({
          'report-id': reportIdSchema,
          status: reportStatusSchema,
          'has-match': z.boolean().nullable(),
        }),
      ),
    ),
    count: plain(z.int().min(0)),
    /** The account's monitored reports read, stale or not. */
    'monitored-count': plain(z.int().min(0)),
    'any-match': plain(z.boolean().nullable()),
    errored: plain(z.array(reportIdSchema)),
  })
  .refine(anyMatchHeldUntilReady, {
    message: 'any-match has no answer until every run is ready',
    path: ['any-match'],
  })
  .refine(nothingScreenedHasNoAnswer, {
    message: 'nothing re-screened is no answer',
    path: ['any-match'],
  });
export type RescreenAccountReportsOutput = z.infer<typeof rescreenAccountReportsOutputSchema>;

export const runVerificationConfigSchema = z.strictObject({
  'inquiry-id': actionReferenceSchema,
  /** Stage 1a amendment 8: only the types that need no end-user capture. */
  type: z.enum(VERIFICATION_RUNNABLE_WITHOUT_CAPTURE),
  /** The type's entered values, sealed like the flow's. */
  inputs: actionValueMapSchema.optional(),
  'timeout-seconds': timeoutSchema,
  /** C127.3: sandbox only; the action refuses it elsewhere. */
  'debug-forced-status': z.enum(['passed', 'failed']).optional(),
});
export type RunVerificationConfig = z.infer<typeof runVerificationConfigSchema>;

/** C127.3: no derived pass flag; a verification that ends `not_applicable` says so in its checks. */
export const runVerificationOutputSchema = z.strictObject({
  'verification-id': plain(z.string().regex(/^ver_/)),
  type: plain(verificationTypeSchema),
  status: plain(z.string().min(1).max(32)),
  checks: plain(
    z.array(
      z.strictObject({
        name: z.string().min(1).max(64),
        status: checkStatusSchema,
        tier: z.string().min(1).max(8),
        stage: checkStageSchema,
      }),
    ),
  ),
  provider: plain(z.string().min(1).max(64).nullable()),
  sandbox: plain(z.boolean()),
});
export type RunVerificationOutput = z.infer<typeof runVerificationOutputSchema>;
