import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { DataTable } from '../../../components/data-table';
import { CreateTemplateForm } from '../../../components/graph/template-forms';
import { PageSection } from '../../../components/lifecycle/page-section';
import { LINK_CLASS } from '../../../components/link-styles';
import { PageHeader } from '../../../components/page-header';
import { PageMain } from '../../../components/page-main';
import { Pagination } from '../../../components/pagination';
import { Badge } from '../../../components/status-badge';
import { Timestamp } from '../../../components/timestamp';
import { hasPermission } from '../../../lib/api/me';
import { renderPage } from '../../../lib/api/page';
import { cursorFromNextLink, parseCursor } from '../../../lib/list-query';
import { createGraphTemplate } from '../actions';

export const metadata: Metadata = { title: 'Query templates' };

export interface TemplatesPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The graph query templates (C102.1, C108): each with its status and published version, read
 * with `graph:read`; with `graph:write`, a form that creates one and opens its draft.
 */
export default async function TemplatesPage({
  searchParams,
}: TemplatesPageProps): Promise<ReactNode> {
  const after = parseCursor((await searchParams).after, 'grqt');
  return renderPage({ permissions: ['graph:read'] }, async ({ session, api }) => {
    const page = await api.graphQueryTemplates.list({
      page: { size: 50, ...(after === undefined ? {} : { after }) },
    });
    return (
      <PageMain className="gap-8">
        <PageHeader
          breadcrumbs={[{ label: 'Graph', href: '/graph' }, { label: 'Query templates' }]}
          title="Query templates"
          description="Versioned graph queries: where a search starts, which kinds it connects through, and its limits. A query runs a template’s published version."
        />
        <DataTable
          caption="Query templates"
          captionHidden
          columns={[
            {
              id: 'name',
              header: 'Name',
              rowHeader: true,
              cell: (template) => (
                <Link href={`/graph/templates/${template.id}`} className={LINK_CLASS}>
                  {template.attributes.name}
                </Link>
              ),
            },
            {
              id: 'status',
              header: 'Status',
              cell: (template) => (
                <Badge
                  status={template.attributes.status}
                  label={template.attributes.status === 'active' ? 'Active' : 'Archived'}
                  tone="neutral"
                />
              ),
            },
            {
              id: 'published',
              header: 'Published version',
              cell: (template) =>
                template.attributes['published-version'] === null
                  ? 'Not published'
                  : `Version ${String(template.attributes['published-version'])}`,
            },
            {
              id: 'latest',
              header: 'Latest version',
              cell: (template) => template.attributes['latest-version'],
            },
            {
              id: 'updated',
              header: 'Updated (UTC)',
              cell: (template) => <Timestamp value={template.attributes['updated-at']} />,
            },
          ]}
          rows={page.data}
          getRowKey={(template) => template.id}
          emptyMessage="No query templates yet."
        />
        <Pagination
          path="/graph/templates"
          query={{}}
          after={after}
          nextCursor={cursorFromNextLink(page.links.next, 'grqt')}
        />
        {hasPermission(session, 'graph:write') && (
          <PageSection
            id="graph-template-create"
            title="Create a template"
            description="It starts as a draft you can edit and publish."
          >
            <CreateTemplateForm action={createGraphTemplate} />
          </PageSection>
        )}
      </PageMain>
    );
  });
}
