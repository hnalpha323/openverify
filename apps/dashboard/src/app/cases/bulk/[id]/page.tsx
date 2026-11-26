import { idSchema } from '@openverify/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  BULK_ACTION_WORDS,
  BULK_OUTCOME_WORDS,
  BULK_STATUS_WORDS,
  bulkRefusalWords,
  casesCount,
} from '../../../../components/cases/case-words';
import { DataTable } from '../../../../components/data-table';
import { Detail } from '../../../../components/detail';
import { LINK_CLASS } from '../../../../components/link-styles';
import { PageHeader } from '../../../../components/page-header';
import { PageMain } from '../../../../components/page-main';
import { Timestamp } from '../../../../components/timestamp';
import { getCaseBulkAction } from '../../../../lib/api/cases';
import { renderPage } from '../../../../lib/api/page';

export const metadata: Metadata = { title: 'Bulk action' };

export interface CaseBulkActionPageProps {
  readonly params: Promise<{ id: string }>;
}

/**
 * A bulk action's outcomes (C137.4, C142.1), read by its creator alone: each case applied, without
 * change, or refused with the refusal's reason in words. While the job waits or runs the outcomes are
 * not known, and the page says so rather than show an empty list. Reads
 * `GET /case-bulk-actions/:id` with `cases:read`.
 */
export default async function CaseBulkActionPage({
  params,
}: CaseBulkActionPageProps): Promise<ReactNode> {
  const { id } = await params;
  if (!idSchema('cblk').safeParse(id).success) {
    notFound();
  }
  return renderPage({ permissions: ['cases:read'] }, async () => {
    const { data: action } = await getCaseBulkAction(id);
    const { attributes } = action;
    const done = attributes.status === 'completed';
    return (
      <PageMain className="gap-6">
        <PageHeader
          breadcrumbs={[{ label: 'Cases', href: '/cases' }, { label: 'Bulk action' }]}
          title={BULK_ACTION_WORDS[attributes.action]}
          description={<code className="font-mono text-xs">{action.id}</code>}
        />
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Detail term="Asked (UTC)">
            <Timestamp value={attributes['created-at']} />
          </Detail>
          {attributes['completed-at'] !== null && (
            <Detail term="Done (UTC)">
              <Timestamp value={attributes['completed-at']} />
            </Detail>
          )}
        </dl>
        {done ? (
          <>
            <p className="text-sm font-medium">
              {`${casesCount(attributes['requested-count'])}: ${String(attributes['applied-count'])} applied, ${String(attributes['no-change-count'])} without change, ${String(attributes['refused-count'])} refused.`}
            </p>
            <DataTable
              caption="Outcome of each case"
              rows={attributes.outcomes}
              getRowKey={(outcome) => outcome['case-id']}
              emptyMessage="No case was acted on."
              columns={[
                {
                  id: 'case',
                  header: 'Case',
                  rowHeader: true,
                  cell: (outcome) => (
                    <Link href={`/cases/${outcome['case-id']}`} className={LINK_CLASS}>
                      {outcome['case-id']}
                    </Link>
                  ),
                },
                {
                  id: 'outcome',
                  header: 'Outcome',
                  cell: (outcome) => BULK_OUTCOME_WORDS[outcome.outcome],
                },
                {
                  id: 'reason',
                  header: 'Reason',
                  cell: (outcome) =>
                    outcome.outcome === 'refused' ? bulkRefusalWords(outcome.code) : '',
                },
              ]}
            />
          </>
        ) : (
          <p role="status" className="flex flex-wrap items-center gap-3 text-sm">
            <span>{`${BULK_STATUS_WORDS[attributes.status]}. ${casesCount(attributes['requested-count'])} asked.`}</span>
            <Link href={`/cases/bulk/${action.id}`} className={LINK_CLASS}>
              Refresh
            </Link>
          </p>
        )}
      </PageMain>
    );
  });
}
