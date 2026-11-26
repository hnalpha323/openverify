import type { ReportActionResource } from '@openverify/contracts';
import { REPORT_RUN_NOTES } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { REPORT_RUN_NOTE_WORDS } from '../../lib/report-words';
import { REPORT_IDS, reportAction, reportRun } from '../../testing/report-fixtures';
import { ReportHistory } from './report-history';

const section = () => screen.getByRole('region', { name: 'History' });
/** The history's entries, each found or the test fails. */
const entries = (): HTMLElement[] =>
  within(
    within(section()).getByRole('list', { name: 'Runs and actions, newest first' }),
  ).getAllByRole('listitem', { name: /./ });

describe('a report’s history (C74.2, C86)', () => {
  it('lists runs and actions newest first, each run with its counts, notes in words and errors', () => {
    render(
      <ReportHistory
        state="visible"
        entries={[
          reportAction(),
          reportRun(
            {
              'run-type': 'list_update',
              status: 'errored',
              'match-count': 2,
              'new-match-count': 1,
              notes: [...REPORT_RUN_NOTES],
              errors: [{ code: 'list_stale', source: 'ofac-sdn' }],
            },
            { id: REPORT_IDS.laterRun },
          ),
          reportRun(),
        ]}
      />,
    );

    const [review, update, initial] = entries() as [HTMLElement, HTMLElement, HTMLElement];
    expect(review).toHaveAccessibleName('Reviewed');
    expect(update).toHaveAccessibleName('List update run: Errored (not screened)');
    expect(initial).toHaveAccessibleName('Initial run: Ready');
    const notes = within(update).getByRole('list', { name: 'Notes' });
    expect(
      within(notes)
        .getAllByRole('listitem')
        .map((note) => note.textContent),
    ).toEqual(REPORT_RUN_NOTES.map((note) => REPORT_RUN_NOTE_WORDS[note]));
    expect(update).toHaveTextContent('2 matches, 1 new');
    expect(update).toHaveTextContent(
      'List out of date: ofac-sdn was not checked successfully within its stale limit',
    );
    expect(initial).toHaveTextContent('Oct 27, 2026, 9:00 AM');
  });

  it('shows an action’s actor, review and the matches it changed, with its comment for pii:view', () => {
    render(<ReportHistory state="visible" entries={[reportAction()]} />);

    const [review] = entries() as [HTMLElement];
    expect(review).toHaveTextContent(REPORT_IDS.user);
    expect(review).toHaveTextContent('True positive');
    expect(review).toHaveTextContent('Material');
    expect(review).toHaveTextContent(REPORT_IDS.match);
    expect(review).toHaveTextContent('Synthetic review note: the sandbox entry is the subject.');
  });

  it('names a workflow run as an actor, never as a user (C121.1)', () => {
    const run = 'wfr_01M5CJXHG07XPHF3HRM6NREDH8';
    render(
      <ReportHistory
        state="visible"
        entries={[reportAction({ 'action-type': 'redact', actor: run })]}
      />,
    );

    expect(screen.getByText(run).parentElement).toHaveTextContent(`Workflow run ${run}`);
    expect(screen.queryByText(/^User/)).toBeNull();
  });

  it('hides an action’s reason and comment without pii:view, and names the system as an actor', () => {
    render(
      <ReportHistory
        state="hidden"
        entries={[
          reportAction({ 'action-type': 'pause', actor: 'system', comment: null, 'match-ids': [] }),
          reportAction({ comment: null }),
        ]}
      />,
    );

    const [pause, review] = entries() as [HTMLElement, HTMLElement];
    expect(pause).toHaveAccessibleName('Monitoring paused');
    expect(pause).toHaveTextContent('System');
    expect(within(review).getAllByText('Hidden').length).toBeGreaterThan(0);
  });

  it('names who redacted a report: the API key or user, or the system for a cascade or retention (owner decision 12)', () => {
    const redact: Partial<ReportActionResource['attributes']> = {
      'action-type': 'redact',
      'match-ids': [],
      'review-status': null,
      'risk-level': null,
      reason: null,
      comment: null,
    };
    render(
      <ReportHistory
        state="redacted"
        entries={[
          reportAction({ ...redact, actor: 'key_01M5CJXHG03PHEQZPRWAH2RXM6' }),
          reportAction({ ...redact, actor: REPORT_IDS.user }),
          reportAction({ ...redact, actor: 'system' }),
        ]}
      />,
    );

    const [byKey, byUser, bySystem] = entries() as [HTMLElement, HTMLElement, HTMLElement];
    const by = (entry: HTMLElement) =>
      within(entry).getByText('By', { selector: 'dt' }).nextElementSibling;
    expect(byKey).toHaveAccessibleName('Redacted');
    expect(by(byKey)).toHaveTextContent('API key key_01M5CJXHG03PHEQZPRWAH2RXM6');
    expect(by(byUser)).toHaveTextContent(`User ${REPORT_IDS.user}`);
    expect(by(bySystem)).toHaveTextContent(
      'System: the redaction of its inquiry or account, or the report retention setting',
    );
  });

  it('says when nothing has happened yet', () => {
    render(<ReportHistory state="visible" entries={[]} />);
    expect(section()).toHaveTextContent('No run or action yet.');
  });
});
