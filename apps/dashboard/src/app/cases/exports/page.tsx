import type { CaseExportResource } from '@openverify/contracts';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import {
  EXPORT_STATUS_WORDS,
  casesCount,
  exportFailureWords,
  sizeWords,
} from '../../../components/cases/case-words';
import { ExportForm } from '../../../components/cases/export-form';
import { DataTable } from '../../../components/data-table';
import { PageSection } from '../../../components/lifecycle/page-section';
import { LINK_CLASS } from '../../../components/link-styles';
import { PageHeader } from '../../../components/page-header';
import { PageMain } from '../../../components/page-main';
import { Pagination } from '../../../components/pagination';
import { Timestamp, formatUtc } from '../../../components/timestamp';
import { listCaseExports } from '../../../lib/api/case-exports';
import { CASE_QUEUE_CHOICES, listCaseQueues } from '../../../lib/api/case-queues';
import { CASE_TEMPLATE_CHOICES, listCaseTemplates } from '../../../lib/api/case-templates';
import { hasPermission } from '../../../lib/api/me';
import { renderPage } from '../../../lib/api/page';
import { cursorFromNextLink, parseCursor } from '../../../lib/list-query';
import { createCaseExport } from './actions';

export const metadata: Metadata = { title: 'Case exports' };

export interface CaseExportsPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** What an export holds, in words, once written; failed and unwritten ones say so. */
function contentsOf(attributes: CaseExportResource['attributes']): string {
  if (attributes.status === 'failed') {
    return exportFailureWords(attributes['error-code']);
  }
  const count = attributes['case-count'];
  if (count === null) {
    return 'Not known until it is written';
  }
  const size = attributes['byte-size'];
  return [
    casesCount(count),
    attributes.format.toUpperCase(),
    ...(size === null ? [] : [sizeWords(size)]),
  ].join(', ');
}

/** How long its file is kept, in words. */
function keptOf(attributes: CaseExportResource['attributes']): ReactNode {
  const expires = attributes['expires-at'];
  if (attributes.status === 'expired') {
    return expires === null ? 'Deleted' : `Deleted ${formatUtc(expires)} UTC`;
  }
  if (attributes.status === 'failed') {
    return 'No file';
  }
  return expires === null
    ? '24 hours after it is written'
    : `Deleted ${formatUtc(expires)} UTC, 24 hours after it was written`;
}

const choicesOf = (resources: readonly { id: string; attributes: { name: string } }[]) =>
  resources.map((resource) => ({ id: resource.id, name: resource.attributes.name }));

/**
 * The caller's case exports (C138.1, C142.1), and asking for one, with `cases:export`: each with its
 * state, what it holds, whether it includes personal data, how long its file is kept (24 hours), and
 * its download while kept. Only the creator lists, reads and downloads an export (P26). Reads
 * `GET /case-exports`, and the templates and queues to choose from where the role reads them.
 */
export default async function CaseExportsPage({
  searchParams,
}: CaseExportsPageProps): Promise<ReactNode> {
  const after = parseCursor((await searchParams).after, 'cexp');
  return renderPage({ permissions: ['cases:export'] }, async ({ session }) => {
    const [page, templates, queues] = await Promise.all([
      listCaseExports(after),
      hasPermission(session, 'case-templates:read')
        ? listCaseTemplates({ size: CASE_TEMPLATE_CHOICES }).then((list) => choicesOf(list.data))
        : Promise.resolve([]),
      hasPermission(session, 'case-queues:read')
        ? listCaseQueues({}, { size: CASE_QUEUE_CHOICES }).then((list) => choicesOf(list.data))
        : Promise.resolve([]),
    ]);
    return (
      <PageMain className="gap-8">
        <PageHeader
          breadcrumbs={[{ label: 'Cases', href: '/cases' }, { label: 'Exports' }]}
          title="Case exports"
          description="Only you can see and download your exports. Each file is kept 24 hours after it is written, then deleted; every export and download is recorded in the audit log."
        />
        <PageSection id="case-export-new" title="New export">
          <ExportForm
            environmentId={session.environment.id}
            canIncludePersonalData={hasPermission(session, 'pii:view')}
            templates={templates}
            queues={queues}
            action={createCaseExport}
          />
        </PageSection>
        <PageSection id="case-export-list" title="Your exports">
          <DataTable
            caption="Your exports"
            captionHidden
            rows={page.data}
            getRowKey={(each) => each.id}
            emptyMessage="No exports yet."
            columns={[
              {
                id: 'id',
                header: 'Export',
                rowHeader: true,
                cell: (each) => <code className="font-mono text-xs">{each.id}</code>,
              },
              {
                id: 'status',
                header: 'Status',
                cell: (each) => EXPORT_STATUS_WORDS[each.attributes.status],
              },
              { id: 'contents', header: 'Holds', cell: (each) => contentsOf(each.attributes) },
              {
                id: 'personal',
                header: 'Personal data',
                cell: (each) =>
                  each.attributes['include-personal-data']
                    ? 'Includes personal data'
                    : 'No personal data',
              },
              {
                id: 'asked',
                header: 'Asked (UTC)',
                cell: (each) => <Timestamp value={each.attributes['created-at']} />,
              },
              { id: 'kept', header: 'Kept', cell: (each) => keptOf(each.attributes) },
              {
                id: 'download',
                header: 'File',
                cell: (each) =>
                  each.attributes.status === 'completed' ? (
                    // A plain link: the route streams the file as a download (no client code).
                    <a
                      href={`/cases/exports/${each.id}/download`}
                      className={LINK_CLASS}
                      aria-label={`Download ${each.id}`}
                    >
                      Download
                    </a>
                  ) : (
                    ''
                  ),
              },
            ]}
          />
          <Pagination
            path="/cases/exports"
            query={{}}
            after={after}
            nextCursor={cursorFromNextLink(page.links.next, 'cexp')}
          />
        </PageSection>
      </PageMain>
    );
  });
}
