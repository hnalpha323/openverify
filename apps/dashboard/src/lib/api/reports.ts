/**
 * Report reads of the reports console (C72.3, C86): the dashboard API's list and detail, which
 * mask PII for an operator without `pii:view` (C70.3). The console never unmasks: what a page
 * shows is what these answered. Failures are `@openverify/node` errors, which `renderPage` maps.
 */
import 'server-only';
import {
  dashboardReportDocumentSchema,
  dashboardReportListDocumentSchema,
} from '@openverify/contracts';
import type { LinkedReportList } from '../../components/reports/linked-reports';
import type { DashboardReportDocument, DashboardReportListDocument } from '../report-documents';
import { reportApiFilters, type ReportFilters } from '../report-query';
import { apiRequest } from './client';

/** Reports per list page. */
export const REPORT_PAGE_SIZE = 25;

/** `GET /dashboard/reports`: one page, newest first, after the report `after`. */
export function listReports(
  filters: ReportFilters,
  after?: string,
  size: number = REPORT_PAGE_SIZE,
): Promise<DashboardReportListDocument> {
  return apiRequest({
    method: 'GET',
    path: '/dashboard/reports',
    query: { ...reportApiFilters(filters), 'page[after]': after, 'page[size]': String(size) },
    schema: dashboardReportListDocumentSchema,
  });
}

/** `GET /dashboard/reports/:id`: the report with its matches, runs and actions. */
export function getReport(id: string): Promise<DashboardReportDocument> {
  return apiRequest({
    method: 'GET',
    path: `/dashboard/reports/${encodeURIComponent(id)}`,
    schema: dashboardReportDocumentSchema,
  });
}

/** Reports shown in an inquiry's or an account's reports section (Phase 6 decision 25). */
export const LINKED_REPORT_PAGE_SIZE = 25;
/** At most this many of them are read in full for their runs (Phase 6 decision 25, C173.1). */
export const LINKED_REPORT_DETAIL_READS = 10;

const ALREADY_DECIDED = 'inquiry_already_decided';

/**
 * The completion reports of `reports` whose runs found their inquiry already decided (C84.3). At
 * most `LINKED_REPORT_DETAIL_READS` of them, newest first, are read once more for their runs
 * (Phase 6 decision 25); the rest are judged by the latest run's notes the masked list served
 * (C173.1), and `capped` says that happened. A report the API created never moves an inquiry.
 */
async function decidedReports(
  reports: readonly DashboardReportListDocument['data'][number][],
): Promise<{ readonly decided: string[]; readonly capped: boolean }> {
  const completion = reports.filter((report) => report.attributes.origin === 'inquiry_completion');
  const read = completion.slice(0, LINKED_REPORT_DETAIL_READS);
  const rest = completion.slice(LINKED_REPORT_DETAIL_READS);
  const documents = await Promise.all(read.map((report) => getReport(report.id)));
  const decided = documents
    .filter((document) =>
      (document.included ?? []).some(
        (entry) => entry.type === 'report-run' && entry.attributes.notes.includes(ALREADY_DECIDED),
      ),
    )
    .map((document) => document.data.id);
  const decidedByNotes = rest
    .filter((report) => (report.attributes['latest-run-notes'] ?? []).includes(ALREADY_DECIDED))
    .map((report) => report.id);
  return { decided: [...decided, ...decidedByNotes], capped: rest.length > 0 };
}

/**
 * The reports of an inquiry or an account, for its page's section (C70.5): the masked dashboard
 * list filtered to it (an account's as home or linked account), newest first; for an inquiry,
 * which completion reports found it already decided.
 */
export async function loadLinkedReports(
  target: { readonly inquiryId: string } | { readonly accountId: string },
): Promise<LinkedReportList> {
  const page = await listReports(
    { types: [], statuses: [], tags: [], ...target },
    undefined,
    LINKED_REPORT_PAGE_SIZE,
  );
  const runs =
    'inquiryId' in target ? await decidedReports(page.data) : { decided: [], capped: false };
  return {
    reports: page.data,
    decided: runs.decided,
    more: page.links.next !== null,
    detailReadsCapped: runs.capped,
  };
}
