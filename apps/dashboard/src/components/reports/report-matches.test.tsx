import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import type { Report } from '../../lib/report-documents';
import { REPORT_IDS, goldenReport, pendingReport, report } from '../../testing/report-fixtures';
import { ToastProvider } from '../toasts';
import { ReportMatches } from './report-matches';
import type { PiiState } from './report-parts';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;
const noop = vi.fn<Action>();

function renderMatches(
  subject: Report,
  { state = 'visible', canReview = true }: { state?: PiiState; canReview?: boolean } = {},
) {
  render(
    <ToastProvider>
      <ReportMatches
        report={subject}
        state={state}
        canReview={canReview}
        dismiss={noop}
        review={noop}
      />
    </ToastProvider>,
  );
}

const golden = goldenReport('watchlist');
const [match] = (golden.attributes as { matches: Record<string, unknown>[] }).matches;
const matchWith = (changes: Record<string, unknown>) => ({ ...match, ...changes });
const section = () => screen.getByRole('region', { name: 'Matches' });
const article = (name: string) => within(section()).getByRole('article', { name });
const term = (scope: HTMLElement, name: string) =>
  within(scope).getByText(name, { selector: 'dt' }).nextElementSibling as HTMLElement;

describe('a report’s matches (C75, C78.5, C86)', () => {
  it('shows each match with its evidence: the names side by side, level, methods, types, qualifiers, score and preset', () => {
    renderMatches(report('watchlist'));

    const card = article('QUILLFEATHER, Avery Sandbox');
    expect(term(card, 'Status')).toHaveTextContent('Open');
    expect(term(card, 'Review')).toHaveTextContent('Not reviewed');
    expect(term(card, 'Subject name')).toHaveTextContent('Avery Quillfeather');
    expect(term(card, 'List name')).toHaveTextContent('QUILLFEATHER, Avery Sandbox');
    expect(term(card, 'Name level')).toHaveTextContent('Partial');
    expect(term(card, 'Methods')).toHaveTextContent('jaro-winkler');
    expect(term(card, 'Match types')).toHaveTextContent('Name similar');
    expect(term(card, 'Match types')).toHaveTextContent('Date of birth equal');
    expect(term(card, 'Qualifiers')).toHaveTextContent('Date of birth equal (+0.05)');
    expect(term(card, 'Score')).toHaveTextContent('0.93 (tolerant preset, minimum 0.80)');
    expect(term(card, 'Source')).toHaveTextContent('openverify-sandbox');
    expect(term(card, 'Entity')).toHaveTextContent('openverify-sandbox:SBX-1001');
  });

  it('marks an open match the last run did not find, which stays open until a person acts (C75.8)', () => {
    renderMatches(
      report('watchlist', {
        attributes: { matches: [matchWith({ 'present-in-last-run': false })] },
      }),
    );

    expect(article('QUILLFEATHER, Avery Sandbox')).toHaveTextContent(
      'Not found by the last run: it stays open until a person dismisses it.',
    );
  });

  it('says where a match lapsed from, and when its entry left the list', () => {
    renderMatches(
      report('watchlist', {
        attributes: {
          'has-match': false,
          matches: [
            matchWith({
              status: 'delisted',
              'lapsed-from': REPORT_IDS.otherReport.replace('rep_', 'rpm_'),
              'delisted-at': '2026-10-28T09:00:00.000Z',
            }),
          ],
        },
      }),
    );

    const card = article('QUILLFEATHER, Avery Sandbox');
    expect(term(card, 'Status')).toHaveTextContent('Delisted');
    expect(term(card, 'Delisted (UTC)')).toHaveTextContent('Oct 28, 2026, 9:00 AM');
    expect(term(card, 'Lapsed from')).toHaveTextContent('rpm_01M5Y5Z4002GV576EACWSHT2BM');
  });

  it('offers a reviewer review and dismissal of each open match and of every open match, named by the match', () => {
    renderMatches(report('watchlist'));

    expect(
      screen.getByRole('button', { name: `Review match ${REPORT_IDS.match}` }),
    ).toHaveTextContent('Review');
    expect(
      screen.getByRole('button', { name: `Dismiss match ${REPORT_IDS.match}` }),
    ).toHaveTextContent('Dismiss');
    expect(screen.getByRole('button', { name: 'Dismiss all open matches' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Review all open matches' })).toBeVisible();
  });

  it('offers no dismissal of a dismissed match, only a review that can reopen it', () => {
    renderMatches(
      report('watchlist', {
        attributes: { 'has-match': false, matches: [matchWith({ status: 'dismissed' })] },
      }),
    );

    expect(screen.queryByRole('button', { name: /^Dismiss/ })).toBeNull();
    expect(screen.getByRole('button', { name: `Review match ${REPORT_IDS.match}` })).toBeVisible();
  });

  it('offers nothing to act on without the review ability, or on a pending or redacted report', () => {
    renderMatches(report('watchlist'), { canReview: false });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('offers nothing on a pending report: it has no match to review yet', () => {
    renderMatches(pendingReport('watchlist'));
    expect(screen.queryByRole('button')).toBeNull();
    expect(section()).toHaveTextContent('None recorded.');
  });

  it('hides the matches from an operator without pii:view, saying why, and offers no review (C70.3)', () => {
    renderMatches(report('watchlist', { masked: true }), { state: 'hidden', canReview: false });

    expect(within(section()).getByText('Hidden')).toBeVisible();
    expect(section()).toHaveTextContent('Matches are personal data');
    expect(screen.queryByText('QUILLFEATHER, Avery Sandbox')).toBeNull();
  });

  it('shows a redacted report’s matches as redacted', () => {
    renderMatches(report('watchlist', { masked: true }), { state: 'redacted', canReview: false });

    expect(within(section()).getByText('Redacted')).toBeVisible();
  });

  it('dismisses one article of a media report by its key (C75.2)', () => {
    renderMatches(report('adverse-media'));

    const cards = within(section()).getAllByRole('article');
    expect(cards).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /^Dismiss match rpm_/ })).toHaveLength(2);
  });
});
