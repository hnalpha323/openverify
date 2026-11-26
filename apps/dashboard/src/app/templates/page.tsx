import type { InquiryTemplateResource } from '@openverify/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { DataTable, type Column } from '../../components/data-table';
import { EmptyState } from '../../components/empty-state';
import { TemplateStatusBadge } from '../../components/lifecycle/badges';
import { LINK_CLASS } from '../../components/link-styles';
import { PageHeader } from '../../components/page-header';
import { PageMain } from '../../components/page-main';
import { Pagination } from '../../components/pagination';
import { Timestamp } from '../../components/timestamp';
import { renderPage } from '../../lib/api/page';
import { cursorFromNextLink, parseCursor } from '../../lib/list-query';

export const metadata: Metadata = { title: 'Templates' };

const PAGE_SIZE = 25;

export interface TemplatesPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const COLUMNS: readonly Column<InquiryTemplateResource>[] = [
  {
    id: 'name',
    header: 'Name',
    rowHeader: true,
    cell: (template) => (
      <Link href={`/templates/${template.id}`} className={LINK_CLASS}>
        {template.attributes.name}
      </Link>
    ),
  },
  {
    id: 'id',
    header: 'ID',
    cell: (template) => <code className="font-mono text-xs">{template.id}</code>,
  },
  {
    id: 'status',
    header: 'Status',
    cell: (template) => <TemplateStatusBadge status={template.attributes.status ?? 'active'} />,
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

/** The environment's inquiry templates (C11, C23), newest first, cursor paged. */
export default async function TemplatesPage({ searchParams }: TemplatesPageProps) {
  const after = parseCursor((await searchParams).after, 'itmpl');
  return renderPage({ permissions: ['inquiry-templates:read'] }, async ({ api }) => {
    // F029: this list takes no created-at range.
    const page = await api.inquiryTemplates.list({
      page: { size: PAGE_SIZE, ...(after === undefined ? {} : { after }) },
    });
    return (
      <PageMain>
        <PageHeader
          title="Templates"
          description="What each inquiry asks of the end user: its flow, its checks and its settings, in published versions."
        />
        {page.data.length === 0 && after === undefined ? (
          <EmptyState title="No templates yet">
            Templates are created with the API (POST /api/v1/inquiry-templates).
          </EmptyState>
        ) : (
          <DataTable
            caption="Templates"
            captionHidden
            columns={COLUMNS}
            rows={page.data}
            getRowKey={(template) => template.id}
            emptyMessage="No more templates."
          />
        )}
        <Pagination
          path="/templates"
          query={{}}
          after={after}
          nextCursor={cursorFromNextLink(page.links.next, 'itmpl')}
        />
      </PageMain>
    );
  });
}
