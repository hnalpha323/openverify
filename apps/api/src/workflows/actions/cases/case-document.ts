/**
 * C120.6, C129.2 (Workflow 8B): the case resource the workflow side reads, built by the contract's
 * builder from the case as `getWorkflowCase` reads it: each held kind's newest 50 with the totals,
 * the newest comments, and the fields opened. `services/cases/resources.ts` (`api-cases`) builds the
 * served case on this record with the row's own columns, and `./case-view.ts` reads a case through
 * it, so a run's view and `GET /cases/:id` are one.
 */
import {
  toReportResourceType,
  toVerificationResourceType,
  type CaseRecord,
  type SupportedVerificationType,
  type TransactionFieldValue,
} from '@openverify/contracts';
import type { ReportType } from '@openverify/core';
import type { WorkflowCase } from '@openverify/db';

/** The contract's record of a case as the workflow side read it, unmasked. */
export function caseRecordOf({ row, fields, held, commentIds }: WorkflowCase): CaseRecord {
  const identifiers = <Type extends string>(type: Type, ids: readonly string[]) =>
    ids.map((id) => ({ type, id }));
  return {
    ...row,
    fields: fields as Readonly<Record<string, TransactionFieldValue>> | null,
    heldObjectCounts: {
      accounts: held.accounts.count,
      inquiries: held.inquiries.count,
      reports: held.reports.count,
      'report-runs': held.reportRuns.count,
      transactions: held.transactions.count,
      verifications: held.verifications.count,
      'graph-queries': held.graphQueries.count,
    },
    commentIds,
    accounts: identifiers('account', held.accounts.items),
    inquiries: identifiers('inquiry', held.inquiries.items),
    reports: held.reports.items.map(({ id, reportType }) => ({
      type: toReportResourceType(reportType as ReportType),
      id,
    })),
    verifications: held.verifications.items.map(({ id, verificationType }) => ({
      type: toVerificationResourceType(verificationType as SupportedVerificationType),
      id,
    })),
    transactions: identifiers('transaction', held.transactions.items),
    reportRunIds: held.reportRuns.items,
    graphQueryIds: held.graphQueries.items,
  };
}
