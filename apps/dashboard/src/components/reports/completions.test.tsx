/**
 * C173.1 on the report console: every "Complete" of a name screening, in the reports index and in a
 * report's history, stands beside what complete coverage does not promise (K20, Phase 6 owner
 * decision 6); the latest run's notes are said in words, and "No run has finished yet" before one.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { COMPLETE_COVERAGE_WORDS } from '../../lib/report-words';
import { report, reportRun } from '../../testing/report-fixtures';
import { CoverageWords } from './coverage-words';
import { ReportHistory } from './report-history';
import { ReportSummary } from './report-summary';
import { ReportsTable } from './reports-table';
import { LatestRunNotes } from './run-notes';

const COMPLETE = { complete: true, limits: [] };

describe('CoverageWords', () => {
  it('says what complete coverage of a name screening does not promise', () => {
    render(<CoverageWords coverage={COMPLETE} type="watchlist" />);

    expect(screen.getByText('Complete')).toBeVisible();
    expect(screen.getByText(COMPLETE_COVERAGE_WORDS)).toBeVisible();
  });

  it('keeps "Complete" alone for a type that compares no names by spelling, and lists limits', () => {
    const { rerender } = render(
      <CoverageWords coverage={COMPLETE} type="crypto-address-watchlist" />,
    );
    expect(screen.queryByText(COMPLETE_COVERAGE_WORDS)).toBeNull();

    rerender(
      <CoverageWords
        coverage={{ complete: false, limits: ['lexicon_languages'] }}
        type="watchlist"
      />,
    );
    expect(screen.getByText(/Limited/)).toBeVisible();
    expect(screen.queryByText(COMPLETE_COVERAGE_WORDS)).toBeNull();
  });

  it('says nothing about coverage for a type without it', () => {
    const { container } = render(<CoverageWords coverage={null} type="watchlist" />);

    expect(container).toHaveTextContent('None');
  });
});

describe('the reports index and history (K20)', () => {
  it('puts the sentence beside every Complete in the index', () => {
    render(
      <ReportsTable
        reports={[report('watchlist', { attributes: { coverage: COMPLETE } })]}
        caption="Reports"
        linkTemplates={false}
        emptyMessage="None"
      />,
    );

    const [, row] = screen.getAllByRole('row');
    if (row === undefined) throw new Error('a report row');
    expect(within(row).getByText(COMPLETE_COVERAGE_WORDS)).toBeVisible();
  });

  it('puts the sentence beside a run’s Complete in the history', () => {
    render(
      <ReportHistory entries={[reportRun({ coverage: COMPLETE, notes: [] })]} state="visible" />,
    );

    expect(screen.getByText(COMPLETE_COVERAGE_WORDS)).toBeVisible();
  });
});

describe('LatestRunNotes (C173.1)', () => {
  it('says each note of the latest run in words', () => {
    render(<LatestRunNotes notes={['inquiry_already_decided']} />);

    expect(screen.getByRole('list', { name: 'Notes of the latest run' })).toHaveTextContent(
      'The inquiry was decided before this report finished, so the report did not change it.',
    );
  });

  it('says when the latest run noted nothing, and when no run has finished yet', () => {
    const { rerender } = render(<LatestRunNotes notes={[]} />);
    expect(screen.getByText('The latest run left no note.')).toBeVisible();

    rerender(<LatestRunNotes notes={undefined} />);
    expect(screen.getByText('No run has finished yet.')).toBeVisible();
  });
});

describe('the report’s result (C173.1)', () => {
  it('shows the latest run’s notes beside the result', () => {
    render(
      <ReportSummary
        report={report('watchlist', { attributes: { 'latest-run-notes': ['report_match'] } })}
      />,
    );

    expect(screen.getByRole('list', { name: 'Notes of the latest run' })).toHaveTextContent(
      'A match sent the inquiry to review.',
    );
  });
});
