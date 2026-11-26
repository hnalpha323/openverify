/**
 * C70.5 (F08): the reports included in an inquiry or account document
 * (`GET /inquiries/:id?include=reports`, `GET /accounts/:id?include=reports`, and the dashboard's
 * inquiry and account documents): the reports linked to the inquiry, or to the account as its home
 * or through `report_accounts`, newest first, at most 50, each masked as `GET /reports/:id` serves
 * it to the caller.
 *
 * Owner: `api-reports` (Workflow 6A Stage 3); the signature is frozen by `foundation-6`
 * (Stage 1b).
 */
import type { ReportResource } from '@openverify/contracts';
import { getReports, listLinkedReportIds, type Db } from '@openverify/db';
import type { PiiMask } from '../../auth/pii.js';
import { reportResourceOf } from './reports.js';

/** C70.5: the most reports one document includes. */
export const MAX_INCLUDED_REPORTS = 50;

export type IncludedReportsTarget = { inquiryId: string } | { accountId: string };

export type IncludedReportsFor = (
  tx: Db,
  environmentId: string,
  target: IncludedReportsTarget,
  mask: PiiMask,
) => Promise<ReportResource[]>;

export const includedReportsFor: IncludedReportsFor = async (tx, environmentId, target, mask) => {
  const ids = await listLinkedReportIds(tx, environmentId, target, { limit: MAX_INCLUDED_REPORTS });
  const reports = new Map((await getReports(tx, environmentId, ids)).map((r) => [r.id, r]));
  const included: ReportResource[] = [];
  for (const id of ids) {
    const report = reports.get(id);
    if (report !== undefined) {
      included.push(await reportResourceOf(tx, report, mask));
    }
  }
  return included;
};
