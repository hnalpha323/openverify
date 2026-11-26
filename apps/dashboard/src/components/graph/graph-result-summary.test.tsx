import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GRAPH_IDS as IDS, graphQuery } from '../../testing/graph-fixtures';
import { GraphResultSummary } from './graph-result-summary';

describe('a graph result’s summary (C108)', () => {
  it('says the status in words with its meaning, the counts, and the parameters by name', () => {
    render(<GraphResultSummary query={graphQuery()} nodeLimit={100} piiView />);
    const status = screen.getByText('Completed');
    expect(status).toHaveAttribute('data-status', 'completed');
    expect(screen.getByText('The search finished within its limits.')).toBeVisible();
    expect(screen.getByText('3 accounts and 2 shared values')).toBeVisible();
    const parameters = screen.getByRole('group', { name: 'Parameters' });
    expect(within(parameters).getByText('account_id')).toBeVisible();
    expect(within(parameters).getByText(IDS.accountA)).toBeVisible();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('keeps each parameter’s name and hides its value for a principal without pii:view', () => {
    render(
      <GraphResultSummary
        query={graphQuery({ params: { email: null } })}
        nodeLimit={100}
        piiView={false}
      />,
    );
    const parameters = screen.getByRole('group', { name: 'Parameters' });
    expect(within(parameters).getByText('email')).toBeVisible();
    expect(within(parameters).getByText('Hidden')).toBeVisible();
  });

  it('says in words that the index is still being built, which kinds it lacks, and what the caps cut', () => {
    render(
      <GraphResultSummary
        query={graphQuery({
          kindsNotIndexed: ['email_address'],
          nodeLimitReached: true,
          skippedHubValues: 2,
        })}
        nodeLimit={100}
        piiView
      />,
    );
    const note = screen.getByRole('note', { name: 'What this result may not show' });
    expect(within(note).getByText(/the index is still being built/i)).toBeVisible();
    expect(within(note).getByText(/email address \(confirmed\) is not indexed/)).toBeVisible();
    expect(within(note).getByText(/node limit \(100 nodes\)/)).toBeVisible();
    expect(within(note).getByText(/2 shared values were skipped/)).toBeVisible();
  });

  it('says a submitted query has no result yet, and a timed-out one shows what it gathered', () => {
    const { rerender } = render(
      <GraphResultSummary query={graphQuery({ status: 'submitted' })} nodeLimit={null} piiView />,
    );
    expect(screen.getByText(/does not refresh by itself/)).toBeVisible();
    expect(screen.getByText('No result yet.')).toBeVisible();
    rerender(
      <GraphResultSummary query={graphQuery({ status: 'timed_out' })} nodeLimit={null} piiView />,
    );
    expect(screen.getByText(/shows what it gathered/)).toBeVisible();
  });

  it('says a redacted result’s nodes, links and parameters are gone', () => {
    render(<GraphResultSummary query={graphQuery({ redacted: true })} nodeLimit={null} piiView />);
    expect(screen.getByText(/was redacted/)).toBeVisible();
    expect(screen.queryByRole('group', { name: 'Parameters' })).toBeNull();
  });
});
