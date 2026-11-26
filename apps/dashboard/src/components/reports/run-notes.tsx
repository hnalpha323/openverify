/**
 * The notes of a report's latest finished run (C173.1, K15; `latest-run-notes`), in words: absent
 * until a run has finished, and an empty list when the run noted nothing.
 */
import type { ReportRunNote } from '@openverify/core';
import { CASES_REPORTS_COPY } from '../../lib/copy/cases-reports';
import { REPORT_RUN_NOTE_WORDS } from '../../lib/report-words';
import { LabelledList } from './report-parts';

const COPY = CASES_REPORTS_COPY.reports;

export function LatestRunNotes({
  notes,
}: {
  readonly notes: readonly ReportRunNote[] | undefined;
}) {
  if (notes === undefined) {
    return <p className="text-sm text-ink-muted">{COPY.noRunYet}</p>;
  }
  if (notes.length === 0) {
    return <p className="text-sm text-ink-muted">{COPY.noRunNotes}</p>;
  }
  return (
    <LabelledList title={COPY.runNotes}>
      {notes.map((note) => (
        <li key={note}>{REPORT_RUN_NOTE_WORDS[note]}</li>
      ))}
    </LabelledList>
  );
}
