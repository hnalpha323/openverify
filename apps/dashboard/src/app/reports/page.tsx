import { Alert } from '@openverify/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '../../components/empty-state';
import { PRIMARY_LINK_BUTTON } from '../../components/integrations/link-button';
import { PageHeader } from '../../components/page-header';
import { PageMain } from '../../components/page-main';
import { Pagination } from '../../components/pagination';
import { ReportFilters } from '../../components/reports/report-filters';
import { ReportsTable } from '../../components/reports/reports-table';
import { hasPermission } from '../../lib/api/me';
import { renderPage } from '../../lib/api/page';
import { listTemplateChoices } from '../../lib/api/report-templates';
import { listReports } from '../../lib/api/reports';
import { cursorFromNextLink } from '../../lib/list-query';
import { hasReportFilters, parseReportListQuery, reportFilterQuery } from '../../lib/report-query';
import { SavedViewsSlot } from '../../components/saved-views/saved-views-slot';

export const metadata: Metadata = { title: 'Reports' };

export interface ReportsPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The session environment's reports (C86), newest first, with filters for type, template,
 * status, result, tag, account and inquiry kept in the URL (C23), and cursor paging. Each row
 * says its result beside its coverage; an errored report reads "Not screened", never "No match"
 * (C69.4). Reads `GET /dashboard/reports` (masked, C72.3), and the templates for the filter with
 * `report-templates:read`.
 */
export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const query = parseReportListQuery(await searchParams);
  return renderPage({ permissions: ['reports:read'] }, async ({ session, api }) => {
    const readTemplates = hasPermission(session, 'report-templates:read');
    // Workflow 6B R013: every page of the templates, up to the picker's cap.
    const choices = readTemplates ? await listTemplateChoices(api) : undefined;
    const header = (
      <PageHeader
        title="Reports"
        description="Screening and risk reports in this environment, newest first. A report says what it found only for what it screened."
        actions={
          hasPermission(session, 'reports:write') ? (
            <Link href="/reports/new" className={PRIMARY_LINK_BUTTON}>
              Create report
            </Link>
          ) : undefined
        }
      />
    );
    const filters = (
      <ReportFilters
        values={query.values}
        types={query.selected.types}
        statuses={query.selected.statuses}
        result={query.selected.result}
        errors={query.errors}
        templates={choices?.templates}
        templatesListedOf={choices?.truncated === true ? choices.templates.length : undefined}
      />
    );
    if (Object.keys(query.errors).length > 0) {
      return (
        <PageMain>
          {header}
          {filters}
          <Alert tone="warning" title="Check the filters">
            Some values cannot be used. Correct them to see the reports.
          </Alert>
        </PageMain>
      );
    }

    const page = await listReports(query.filters, query.after);
    const filtered = hasReportFilters(query.filters);
    return (
      <PageMain>
        {header}
        {filters}
        <SavedViewsSlot list="reports" />
        {page.data.length === 0 && !filtered && query.after === undefined ? (
          <EmptyState title="No reports yet">
            Reports appear here once your backend creates them with the API, an inquiry template
            runs them on completion, or you create one here.
          </EmptyState>
        ) : (
          <ReportsTable
            reports={page.data}
            linkTemplates={readTemplates}
            emptyMessage={filtered ? 'No reports match these filters.' : 'No more reports.'}
          />
        )}
        <Pagination
          path="/reports"
          query={reportFilterQuery(query.filters)}
          after={query.after}
          nextCursor={cursorFromNextLink(page.links.next, 'rep')}
        />
      </PageMain>
    );
  });
}
