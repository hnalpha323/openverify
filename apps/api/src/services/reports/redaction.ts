/**
 * C73.5: the report redaction hooks the shared redaction and retention code calls
 * (`services/redaction.ts`, `services/retention.ts`). Owner: `api-reports` (Workflow 6A Stage 3);
 * their signatures are frozen by `foundation-6` (Stage 1b).
 *
 * Redacting a report nulls `query`, `result` and `crypto_address_index`, every match's `snapshot`,
 * `entry_index` and `evidence_hash` and every action's `details` (under the trigger's
 * `openverify.report_redaction` case), sets `redacted_at`, cancels monitoring (a claimed run
 * re-checks `redacted_at` under the lock and discards its result), stubs the report's earlier
 * events and clears its stored API copies, and stages `report/<type>.redacted` once, all in the
 * caller's transaction under the C73.7 lock order (the caller holds the inquiry or the accounts;
 * the report row is locked here). Scores, statuses, counts and the runs stay.
 */
import { newId } from '@openverify/contracts';
import { reportEventName } from '@openverify/core';
import {
  forgetReportCopies,
  getReport,
  insertReportAction,
  listAccountReportIds,
  listInquiryReportIds,
  redactReportRecords,
  type Db,
} from '@openverify/db';
import { UNMASKED } from '../../auth/pii.js';
import type { StagedEvent } from '../../events/index.js';
import type { ReportHookDeps } from './hooks.js';
import { reportViewOf } from './reports.js';
import { reportResource } from './resources.js';
import { redactRunsForSubjectsInTx } from '../../workflows/runs/redaction.js';

/**
 * Who redacts (owner decision 12 after 6B, K6A-8 (d)): the user or API key of `DELETE
 * /reports/:id`, the workflow run of a Redact Object step (C121.1), or `system` for the inquiry and
 * account cascades and retention.
 */
export type ReportRedactionActor =
  | { actorType: 'user' | 'api_key' | 'workflow_run'; actorId: string }
  | { actorType: 'system'; actorId: null };

export interface ReportRedactionOptions {
  /** The redaction time of a first redaction. */
  at: Date;
  /** Who redacts: the first redaction writes a `redact` action naming it (owner decision 12). */
  actor: ReportRedactionActor;
}

/** What redacting one report did; counts only, never data. */
export interface ReportRedactionOutcome {
  /** It had been redacted before, which then changed nothing. */
  alreadyRedacted: boolean;
  /** When it was redacted: `at`, or the earlier time. */
  redactedAt: Date;
  /** `report/<type>.redacted`, staged on the first redaction only. */
  staged: StagedEvent[];
  /** For the audit entry: the matches and actions redacted. */
  counts: { matches: number; actions: number };
}

/**
 * C73.5: redacts one report of the environment in `tx`. `null` when the report is not in the
 * environment.
 */
export async function redactReportInTx(
  tx: Db,
  deps: ReportHookDeps,
  environmentId: string,
  reportId: string,
  options: ReportRedactionOptions,
): Promise<ReportRedactionOutcome | null> {
  const report = await getReport(tx, environmentId, reportId, { lock: 'update' });
  if (report === null) {
    return null;
  }
  // C120.9 (F35): the runs that recorded the report (`api-engine`); also on a re-run.
  await redactRunsForSubjectsInTx(tx, { environmentId, subjectIds: [reportId], at: options.at });
  const earlier = (redactedAt: Date): ReportRedactionOutcome => ({
    alreadyRedacted: true,
    redactedAt,
    staged: [],
    counts: { matches: 0, actions: 0 },
  });
  if (report.redactedAt !== null) {
    return earlier(report.redactedAt);
  }
  // The earlier events are stubbed before `.redacted` is staged, which keeps its own payload.
  await forgetReportCopies(tx, environmentId, [reportId], options.at);
  const counts = await redactReportRecords(tx, environmentId, reportId, options.at);
  if (counts === null) {
    return earlier(options.at);
  }
  // Owner decision 12: the audit trail names who removed the data. Written after the redaction,
  // with no details, so it holds nothing to redact and is not among the actions counted.
  await insertReportAction(tx, environmentId, {
    id: newId('ract'),
    reportId,
    actionType: 'redact',
    actorType: options.actor.actorType,
    actorId: options.actor.actorId,
    details: null,
    createdAt: options.at,
  });
  const redacted = await getReport(tx, environmentId, reportId);
  const staged: StagedEvent[] =
    redacted === null
      ? []
      : [
          await deps.events.stage(tx, {
            environmentId,
            name: reportEventName(redacted.reportType, 'redacted'),
            payload: { data: reportResource(await reportViewOf(tx, redacted), UNMASKED) },
          }),
        ];
  return { alreadyRedacted: false, redactedAt: options.at, staged, counts };
}

export interface InquiryReportsRedaction extends ReportRedactionOptions {
  environmentId: string;
  inquiryId: string;
}

/**
 * C73.5: redacts every report whose `inquiry_id` is the inquiry, inside the inquiry's redaction
 * transaction (the inquiry is locked). Returns the events it staged.
 */
export type RedactInquiryReportsInTx = (
  tx: Db,
  deps: ReportHookDeps,
  input: InquiryReportsRedaction,
) => Promise<StagedEvent[]>;

/** The staged events of redacting each report, in id order. */
async function redactEach(
  tx: Db,
  deps: ReportHookDeps,
  environmentId: string,
  reportIds: readonly string[],
  options: ReportRedactionOptions,
): Promise<StagedEvent[]> {
  const staged: StagedEvent[] = [];
  for (const reportId of reportIds) {
    const outcome = await redactReportInTx(tx, deps, environmentId, reportId, {
      at: options.at,
      actor: options.actor,
    });
    staged.push(...(outcome?.staged ?? []));
  }
  return staged;
}

export const redactInquiryReportsInTx: RedactInquiryReportsInTx = async (tx, deps, input) =>
  redactEach(
    tx,
    deps,
    input.environmentId,
    await listInquiryReportIds(tx, input.environmentId, input.inquiryId),
    input,
  );

export interface AccountReportsRedaction extends ReportRedactionOptions {
  environmentId: string;
  accountId: string;
}

/**
 * C73.5 (F04): redacts every report linked to the account, as its home or through
 * `report_accounts`. The account redaction calls it inside its transaction (the account is
 * locked), then once more after the commit for the reports linked while it ran (the catch-up).
 * Returns the events it staged.
 */
export type RedactAccountReportsInTx = (
  tx: Db,
  deps: ReportHookDeps,
  input: AccountReportsRedaction,
) => Promise<StagedEvent[]>;

export const redactAccountReportsInTx: RedactAccountReportsInTx = async (tx, deps, input) =>
  redactEach(
    tx,
    deps,
    input.environmentId,
    await listAccountReportIds(tx, input.environmentId, input.accountId),
    input,
  );
