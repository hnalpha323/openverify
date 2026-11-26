import {
  reportTemplateStatusSchema,
  type ReportTemplateResource,
  type ReportTemplateStatus,
} from '@openverify/contracts';
import { reportTypeSchema, toReportResourceType, type ReportType } from '@openverify/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { DataTable, type Column } from '../../components/data-table';
import { EmptyState } from '../../components/empty-state';
import { TemplateStatusBadge } from '../../components/lifecycle/badges';
import { PRIMARY_LINK_BUTTON } from '../../components/integrations/link-button';
import { LINK_CLASS } from '../../components/link-styles';
import { PageHeader } from '../../components/page-header';
import { PageMain } from '../../components/page-main';
import { Pagination } from '../../components/pagination';
import { ReportTemplateFilters } from '../../components/report-config/report-template-filters';
import { Timestamp } from '../../components/timestamp';
import { hasPermission } from '../../lib/api/me';
import { renderPage } from '../../lib/api/page';
import { TEMPLATE_FORMS_COPY } from '../../lib/copy/template-forms';
import { REPORT_TYPE_LABELS } from '../../lib/labels';
import { cursorFromNextLink, parseCursor } from '../../lib/list-query';

export const metadata: Metadata = { title: 'Report templates' };

const PAGE_SIZE = 25;

export interface ReportTemplatesPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const COLUMNS: readonly Column<ReportTemplateResource>[] = [
  {
    id: 'name',
    header: 'Name',
    rowHeader: true,
    cell: (template) => (
      <Link href={`/report-templates/${template.id}`} className={LINK_CLASS}>
        {template.attributes.name}
      </Link>
    ),
  },
  {
    id: 'type',
    header: 'Type',
    cell: (template) =>
      REPORT_TYPE_LABELS[toReportResourceType(template.attributes['report-type'])],
  },
  {
    id: 'status',
    header: 'Status',
    cell: (template) => <TemplateStatusBadge status={template.attributes.status} />,
  },
  {
    id: 'version',
    header: 'Current version',
    cell: (template) =>
      `Version ${String(template.attributes['current-version']['version-number'])}`,
  },
  {
    id: 'updated',
    header: 'Updated (UTC)',
    cell: (template) => <Timestamp value={template.attributes['updated-at']} />,
  },
];

/**
 * The environment's report templates (C71, C86), newest first, cursor paged and filtered by type
 * and status through the API.
 */
export default async function ReportTemplatesPage({ searchParams }: ReportTemplatesPageProps) {
  const query = await searchParams;
  // A value the API does not know is not sent.
  const type: ReportType | undefined = reportTypeSchema.safeParse(query.type).data;
  const status: ReportTemplateStatus | undefined = reportTemplateStatusSchema.safeParse(
    query.status,
  ).data;
  const after = parseCursor(query.after, 'rptp');
  return renderPage({ permissions: ['report-templates:read'] }, async ({ api, session }) => {
    const page = await api.reportTemplates.list({
      ...(type === undefined && status === undefined
        ? {}
        : {
            filter: {
              ...(type === undefined ? {} : { 'report-type': type }),
              ...(status === undefined ? {} : { status }),
            },
          }),
      page: { size: PAGE_SIZE, ...(after === undefined ? {} : { after }) },
    });
    const filtered = type !== undefined || status !== undefined;
    return (
      <PageMain>
        <PageHeader
          title="Report templates"
          description="What each report screens and how: its lists, its matching and its monitoring, in published versions. A report keeps the version it was created from."
          actions={
            hasPermission(session, 'report-templates:write') ? (
              <Link href="/report-templates/new" className={PRIMARY_LINK_BUTTON}>
                {TEMPLATE_FORMS_COPY.reportForms.newLink}
              </Link>
            ) : undefined
          }
        />
        <ReportTemplateFilters type={type} status={status} />
        {page.data.length === 0 && after === undefined ? (
          filtered ? (
            <EmptyState title="No template matches these filters" />
          ) : (
            <EmptyState title="No report templates yet">
              Templates are created with the API (POST /api/v1/report-templates); seed:dev creates a
              default template for each report type.
            </EmptyState>
          )
        ) : (
          <DataTable
            caption="Report templates"
            captionHidden
            columns={COLUMNS}
            rows={page.data}
            getRowKey={(template) => template.id}
            emptyMessage="No more templates."
          />
        )}
        <Pagination
          path="/report-templates"
          query={{ type, status }}
          after={after}
          nextCursor={cursorFromNextLink(page.links.next, 'rptp')}
        />
      </PageMain>
    );
  });
}
