import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { REPORT_IDS, goldenReport, report } from '../../testing/report-fixtures';
import { ReportIgnoreList } from './report-ignore-list';

const golden = goldenReport('watchlist').attributes as {
  'matched-lists': unknown[];
  matches: Record<string, unknown>[];
};
const ignored = {
  'match-id': REPORT_IDS.match,
  'ignored-at': '2026-10-27T10:00:00.000Z',
  'run-id': REPORT_IDS.run,
  'run-history-completed-at': '2026-10-27T09:00:01.250Z',
  match: golden['matched-lists'][0],
  user: REPORT_IDS.user,
  'ignore-reason': 'Synthetic: a different person',
};
const dismissed = report('watchlist', {
  attributes: {
    'has-match': false,
    matches: golden.matches.map((match) => ({ ...match, status: 'dismissed' })),
    'ignore-list': [ignored],
  },
});
const section = () => screen.getByRole('region', { name: 'Ignore list' });

describe('a report’s ignore list (C75.2, C86)', () => {
  it('lists each dismissed match with when, by whom, why and the run that found it', () => {
    render(<ReportIgnoreList report={dismissed} state="visible" />);

    const table = within(section()).getByRole('table', { name: 'Dismissed matches' });
    const row = within(
      within(table).getByRole('rowheader', { name: REPORT_IDS.match }).closest('tr') as HTMLElement,
    );
    expect(row.getByText('Oct 27, 2026, 10:00 AM')).toBeVisible();
    expect(row.getByText(REPORT_IDS.user)).toBeVisible();
    expect(row.getByText('Synthetic: a different person')).toBeVisible();
    expect(row.getByText(REPORT_IDS.run)).toBeVisible();
    expect(section()).toHaveTextContent(
      'A dismissed match stays suppressed while the entry’s matched identity is unchanged; when the entry changes, it lapses into a new open match.',
    );
  });

  it('says when nothing was dismissed', () => {
    render(<ReportIgnoreList report={report('watchlist')} state="visible" />);
    expect(section()).toHaveTextContent('Nothing was dismissed.');
  });

  it('hides the list from an operator without pii:view, and shows a redacted one as redacted', () => {
    const { unmount } = render(
      <ReportIgnoreList report={report('watchlist', { masked: true })} state="hidden" />,
    );
    expect(within(section()).getByText('Hidden')).toBeVisible();
    unmount();

    render(<ReportIgnoreList report={report('watchlist', { masked: true })} state="redacted" />);
    expect(within(section()).getByText('Redacted')).toBeVisible();
  });
});
