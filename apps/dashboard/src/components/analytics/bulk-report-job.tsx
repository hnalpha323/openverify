/**
 * A bulk report job (C166.5, C166.6): its state, its counts and every row's outcome, a failed row's
 * code in words with the code beside them (K9-21), a created row linking its report and a failed
 * row reported failed, never skipped.
 */
import type { ReportBulkJobResource } from '@openverify/contracts';
import Link from 'next/link';
import { ANALYTICS_COPY, fillCopy } from '../../lib/copy/analytics';
import { DataTable } from '../data-table';
import { PageSection } from '../lifecycle/page-section';
import { LINK_CLASS } from '../link-styles';
import { bulkCodeWords } from './bulk-code-words';

const COPY = ANALYTICS_COPY.bulk;

export function BulkReportJob({ job }: { readonly job: ReportBulkJobResource }) {
  const a = job.attributes;
  const ended = a.status === 'completed' || a.status === 'failed';
  return (
    <PageSection id="bulk-report-job" title={fillCopy(COPY.jobTitle, { id: job.id })}>
      <p className="text-sm">
        Status: {a.status}.{' '}
        {fillCopy(COPY.jobSummary, {
          created: a['created-count'],
          failed: a['failed-count'],
          rows: a['row-count'] ?? a.rows.length,
        })}
      </p>
      {!ended && <p className="text-sm text-ink-muted">{COPY.jobPending}</p>}
      {a['error-code'] !== null && (
        <p className="text-sm font-medium text-danger">
          {fillCopy(COPY.jobRefused, { code: bulkCodeWords(a['error-code']) })}
        </p>
      )}
      <DataTable
        caption={COPY.rows}
        rows={a.rows}
        getRowKey={(row) => String(row.row)}
        emptyMessage={ANALYTICS_COPY.chart.noData}
        columns={[
          { id: 'row', header: 'Row', rowHeader: true, cell: (row) => String(row.row) },
          {
            id: 'outcome',
            header: 'Outcome',
            cell: (row) => (row.outcome === 'created' ? COPY.created : COPY.failed),
          },
          {
            id: 'report',
            header: 'Report',
            cell: (row) =>
              row['report-id'] === null ? (
                ''
              ) : (
                <Link href={`/reports/${row['report-id']}`} className={LINK_CLASS}>
                  {row['report-id']}
                </Link>
              ),
          },
          {
            id: 'code',
            header: 'Code',
            cell: (row) => (row['error-code'] === null ? '' : bulkCodeWords(row['error-code'])),
          },
        ]}
      />
    </PageSection>
  );
}
