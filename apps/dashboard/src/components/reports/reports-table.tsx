import { fromReportResourceType } from '@openverify/core';
import Link from 'next/link';
import { REPORT_TYPE_LABELS } from '../../lib/labels';
import type { Report } from '../../lib/report-documents';
import { reportResultOf } from '../../lib/report-result';
import { CoverageWords } from './coverage-words';
import { typeOf } from './report-summary';
import { REPORT_ORIGIN_LABELS } from '../../lib/report-words';
import { DataTable, type Column } from '../data-table';
import { TagList } from '../lifecycle/tag-list';
import { LINK_CLASS } from '../link-styles';
import { EmptyValue } from '../masked-value';
import { Timestamp } from '../timestamp';
import { ReportResultBadge, ReportStatusBadge } from './report-badges';

export interface ReportsTableProps {
  readonly reports: readonly Report[];
  /** Link each template version to its template's page (`report-templates:read`). */
  readonly linkTemplates: boolean;
  readonly caption?: string;
  readonly emptyMessage: string;
  /** A note per report id (a "Note" column, shown when given). */
  readonly notes?: Readonly<Record<string, string>> | undefined;
}

/** The result of a row: never "no match" unless the report is `ready` (C69.4). */
function resultOf(report: Report) {
  const type = fromReportResourceType(report.type);
  return type === null
    ? 'pending'
    : reportResultOf(type, report.attributes.status, report.attributes['has-match']);
}

function columns(
  linkTemplates: boolean,
  notes: Readonly<Record<string, string>> | undefined,
): readonly Column<Report>[] {
  const noteColumn: Column<Report>[] =
    notes === undefined
      ? []
      : [
          {
            id: 'note',
            header: 'Note',
            cell: (report) => (Object.hasOwn(notes, report.id) ? notes[report.id] : <EmptyValue />),
          },
        ];
  return [
    {
      id: 'id',
      header: 'Report ID',
      rowHeader: true,
      cell: (report) => (
        <Link href={`/reports/${report.id}`} className={LINK_CLASS}>
          <code className="font-mono text-xs">{report.id}</code>
        </Link>
      ),
    },
    { id: 'type', header: 'Type', cell: (report) => REPORT_TYPE_LABELS[report.type] },
    {
      id: 'status',
      header: 'Status',
      cell: (report) => <ReportStatusBadge status={report.attributes.status} />,
    },
    {
      id: 'result',
      header: 'Result',
      cell: (report) => <ReportResultBadge result={resultOf(report)} />,
    },
    {
      id: 'coverage',
      header: 'Coverage',
      // K20: a name screening's "Complete" always beside what it does not promise.
      cell: (report) => (
        <CoverageWords coverage={report.attributes.coverage} type={typeOf(report)} />
      ),
    },
    {
      id: 'version',
      header: 'Template version',
      cell: (report) => {
        const name = report.attributes['report-template-version-name'];
        const template = report.relationships['report-template'].data.id;
        return linkTemplates ? (
          <Link href={`/report-templates/${template}`} className={LINK_CLASS}>
            {name}
          </Link>
        ) : (
          name
        );
      },
    },
    {
      id: 'origin',
      header: 'Origin',
      cell: (report) => REPORT_ORIGIN_LABELS[report.attributes.origin],
    },
    { id: 'tags', header: 'Tags', cell: (report) => <TagList tags={report.attributes.tags} /> },
    {
      id: 'created',
      header: 'Created (UTC)',
      cell: (report) => <Timestamp value={report.attributes['created-at']} />,
    },
    ...noteColumn,
  ];
}

/** A list of reports (C86): what each found beside how completely it compared, never more. */
export function ReportsTable({
  reports,
  linkTemplates,
  caption = 'Reports',
  emptyMessage,
  notes,
}: ReportsTableProps) {
  return (
    <DataTable
      caption={caption}
      captionHidden
      columns={columns(linkTemplates, notes)}
      rows={reports}
      getRowKey={(report) => report.id}
      emptyMessage={emptyMessage}
    />
  );
}
