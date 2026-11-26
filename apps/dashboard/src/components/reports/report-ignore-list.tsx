/**
 * A report's ignore list (C75.2, C86): each dismissed match, when, by whom (a user or an API key),
 * why, and the run that found it. The list is personal data as a whole: masked without
 * `pii:view` ("Hidden"), `null` once redacted ("Redacted").
 */
import type { Report } from '../../lib/report-documents';
import { DataTable, type Column } from '../data-table';
import { HiddenValue } from '../hidden-value';
import { PageSection } from '../lifecycle/page-section';
import { RedactedValue } from '../lifecycle/redacted-value';
import { EmptyValue } from '../masked-value';
import { Code, TimeOrNone, type PiiState } from './report-parts';

interface IgnoredMatch {
  readonly 'match-id': string;
  readonly 'ignored-at': string;
  readonly 'run-id': string | null;
  readonly user: string;
  readonly 'ignore-reason': string;
}

const COLUMNS: readonly Column<IgnoredMatch>[] = [
  { id: 'match', header: 'Match', rowHeader: true, cell: (row) => <Code>{row['match-id']}</Code> },
  { id: 'at', header: 'Dismissed (UTC)', cell: (row) => <TimeOrNone value={row['ignored-at']} /> },
  { id: 'by', header: 'Dismissed by', cell: (row) => <Code>{row.user}</Code> },
  { id: 'reason', header: 'Reason', cell: (row) => row['ignore-reason'] },
  {
    id: 'run',
    header: 'Found by run',
    cell: (row) => (row['run-id'] === null ? <EmptyValue /> : <Code>{row['run-id']}</Code>),
  },
];

/** The "Ignore list" section of a report with review. */
export function ReportIgnoreList({
  report,
  state,
}: {
  readonly report: Report;
  readonly state: PiiState;
}) {
  const list =
    (report.attributes as { readonly 'ignore-list'?: readonly IgnoredMatch[] | null })[
      'ignore-list'
    ] ?? null;
  return (
    <PageSection
      id="report-ignore-list"
      title="Ignore list"
      description="A dismissed match stays suppressed while the entry’s matched identity is unchanged; when the entry changes, it lapses into a new open match."
    >
      {list === null ? (
        <p>{state === 'redacted' ? <RedactedValue /> : <HiddenValue />}</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-ink-muted">Nothing was dismissed.</p>
      ) : (
        <DataTable
          caption="Dismissed matches"
          captionHidden
          columns={COLUMNS}
          rows={list}
          getRowKey={(row) => `${row['match-id']}:${row['ignored-at']}`}
          emptyMessage="Nothing was dismissed."
        />
      )}
    </PageSection>
  );
}
