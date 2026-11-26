import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CreateTemplateForm } from '../../components/cases/template-forms';
import { DataTable } from '../../components/data-table';
import { EmptyState } from '../../components/empty-state';
import { LINK_CLASS } from '../../components/link-styles';
import { PageHeader } from '../../components/page-header';
import { PageMain } from '../../components/page-main';
import { Pagination } from '../../components/pagination';
import { Timestamp } from '../../components/timestamp';
import { listCaseTemplates } from '../../lib/api/case-templates';
import { hasPermission } from '../../lib/api/me';
import { renderPage } from '../../lib/api/page';
import { cursorFromNextLink, parseCursor } from '../../lib/list-query';
import { createCaseTemplate } from './actions';

export const metadata: Metadata = { title: 'Case templates' };

export interface CaseTemplatesPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const version = (number: number | null, none: string) =>
  number === null ? none : `v${String(number)}`;

/**
 * The case templates (C130, C142.1): each with its key, its status, and its published and open
 * draft versions, and creation with `case-templates:write`. Reads `GET /case-templates` with
 * `case-templates:read`.
 */
export default async function CaseTemplatesPage({
  searchParams,
}: CaseTemplatesPageProps): Promise<ReactNode> {
  const after = parseCursor((await searchParams).after, 'ctmpl');
  return renderPage({ permissions: ['case-templates:read'] }, async ({ session }) => {
    const page = await listCaseTemplates({ after });
    return (
      <PageMain>
        <PageHeader
          title="Case templates"
          description="What a case of each template holds: its statuses and the moves between them, resolutions, fields, queue, policies and SLA, in immutable versions. Each case keeps the version it was created under."
        />
        {hasPermission(session, 'case-templates:write') && (
          <CreateTemplateForm environmentId={session.environment.id} action={createCaseTemplate} />
        )}
        {page.data.length === 0 && after === undefined ? (
          <EmptyState title="No case templates yet">
            A case template is needed before a case can be opened.
          </EmptyState>
        ) : (
          <DataTable
            caption="Case templates"
            captionHidden
            rows={page.data}
            getRowKey={(template) => template.id}
            emptyMessage="No more case templates."
            columns={[
              {
                id: 'name',
                header: 'Name',
                rowHeader: true,
                cell: (template) => (
                  <Link href={`/case-templates/${template.id}`} className={LINK_CLASS}>
                    {template.attributes.name}
                  </Link>
                ),
              },
              {
                id: 'key',
                header: 'Key',
                cell: (template) => (
                  <code className="font-mono text-xs">{template.attributes.key}</code>
                ),
              },
              {
                id: 'status',
                header: 'Status',
                cell: (template) =>
                  template.attributes.status === 'active'
                    ? 'Active'
                    : 'Archived: takes no new case',
              },
              {
                id: 'published',
                header: 'Published version',
                cell: (template) =>
                  version(template.attributes['published-version'], 'Not published yet'),
              },
              {
                id: 'draft',
                header: 'Open draft',
                cell: (template) => version(template.attributes['draft-version'], 'None'),
              },
              {
                id: 'created',
                header: 'Created (UTC)',
                cell: (template) => <Timestamp value={template.attributes['created-at']} />,
              },
            ]}
          />
        )}
        <Pagination
          path="/case-templates"
          query={{}}
          after={after}
          nextCursor={cursorFromNextLink(page.links.next, 'ctmpl')}
        />
      </PageMain>
    );
  });
}
