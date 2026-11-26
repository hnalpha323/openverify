/**
 * The sources a report's latest run selected (C69.4, C76.2, C76.3, C86): each one screened with
 * its provenance (publication time, last successful check, origin, sync and attribution), and
 * each one not screened with why (stale, unavailable, keyed by another matcher version). An
 * imported file is never cited as the publisher's (P08).
 */
import { REPORT_SOURCE_ERROR_CODES } from '@openverify/core';
import type { Report } from '../../lib/report-documents';
import { reportErrorText } from '../../lib/report-words';
import { DataTable, type Column } from '../data-table';
import { PageSection } from '../lifecycle/page-section';
import { EmptyValue } from '../masked-value';
import { Code, TimeOrNone } from './report-parts';

type Provenance = Extract<Report['attributes']['sources'][number], { 'source-id': string }>;

type ListProvenance = Extract<Report['attributes']['sources'][number], { 'list-id': string }>;

interface SourceRow {
  readonly sourceId: string;
  readonly state: string;
  readonly provenance: Provenance | null;
  /** C106.2: a list's own provenance, which has no sync. */
  readonly list?: ListProvenance;
}

const ORIGIN_WORDS: Readonly<Record<Provenance['origin'], string>> = {
  publisher: 'The publisher’s download',
  import: 'Imported from a file (not the publisher’s download)',
};

const COLUMNS: readonly Column<SourceRow>[] = [
  { id: 'source', header: 'Source', rowHeader: true, cell: (row) => <Code>{row.sourceId}</Code> },
  { id: 'state', header: 'State', cell: (row) => row.state },
  {
    id: 'published',
    header: 'Published (UTC)',
    cell: (row) => <TimeOrNone value={row.provenance?.['published-at']} />,
  },
  {
    id: 'checked',
    header: 'Last checked (UTC)',
    cell: (row) => (
      <TimeOrNone
        value={row.list === undefined ? row.provenance?.['checked-at'] : row.list['screened-at']}
      />
    ),
  },
  {
    id: 'origin',
    header: 'Origin',
    cell: (row) =>
      row.list !== undefined ? (
        'Your own list (no sync)'
      ) : row.provenance === null ? (
        <EmptyValue />
      ) : (
        ORIGIN_WORDS[row.provenance.origin]
      ),
  },
  {
    id: 'sync',
    header: 'Sync',
    cell: (row) =>
      row.provenance === null ? <EmptyValue /> : <Code>{row.provenance['sync-id']}</Code>,
  },
  {
    id: 'attribution',
    header: 'Attribution',
    cell: (row) => row.provenance?.attribution ?? <EmptyValue />,
  },
];

/** The screened sources, then each source an error names that was not screened. */
export function sourceRows(report: Report): SourceRow[] {
  const { sources, errors } = report.attributes;
  const screened = sources.map((provenance): SourceRow =>
    'list-id' in provenance
      ? // C106.2: a list's provenance has no sync: its version, keys and size when screened.
        {
          sourceId: provenance['list-id'],
          state: `Screened at version ${String(provenance.version)}, normaliser ${provenance['normaliser-version']}, ${provenance['item-count'].toLocaleString('en-US')} ${provenance['item-count'] === 1 ? 'item' : 'items'}`,
          provenance: null,
          list: provenance,
        }
      : { sourceId: provenance['source-id'], state: 'Screened, fresh when checked', provenance },
  );
  const seen = new Set(screened.map((row) => row.sourceId));
  const unscreened = errors.flatMap((error) => {
    if (error.source === undefined || seen.has(error.source)) {
      return [];
    }
    seen.add(error.source);
    const words = reportErrorText(error);
    return [
      {
        sourceId: error.source,
        state: `${words?.title ?? error.code} (not screened)`,
        provenance: null,
      },
    ];
  });
  return [...screened, ...unscreened];
}

/** Whether a report has sources to show: its type screens lists, or a source error names one. */
export function hasSources(report: Report, screensLists: boolean): boolean {
  return (
    screensLists ||
    report.attributes.sources.length > 0 ||
    report.attributes.errors.some(
      (error) => error.source !== undefined && REPORT_SOURCE_ERROR_CODES.includes(error.code),
    )
  );
}

/** The "Sources" section of a report. */
export function ReportSources({ report }: { readonly report: Report }) {
  return (
    <PageSection
      id="report-sources"
      title="Sources"
      description="Freshness counts from each list's last successful check; a source that was not screened makes the report errored."
    >
      <DataTable
        caption="Sources"
        captionHidden
        columns={COLUMNS}
        rows={sourceRows(report)}
        getRowKey={(row) => row.sourceId}
        emptyMessage="No list was selected, so nothing was screened."
      />
    </PageSection>
  );
}
