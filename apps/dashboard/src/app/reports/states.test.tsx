import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ReportLoading from './[id]/loading';
import ReportsError from './error';
import ReportsLayout from './layout';
import ReportsLoading from './loading';
import NewReportLoading from './new/loading';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the report pages’ loading and error states', () => {
  it('announces that the list, a report or the create page is loading', () => {
    const { unmount } = render(<ReportsLoading />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading reports…');
    unmount();

    render(
      <>
        <ReportLoading />
        <NewReportLoading />
      </>,
    );
    expect(screen.getAllByRole('status').map((status) => status.textContent)).toEqual([
      'Loading the report…',
      'Loading the report templates…',
    ]);
  });

  it('explains a failure without internals and offers a retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const retry = vi.fn();
    const error = Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:3000'), {
      digest: 'synthetic-digest-1',
    });

    render(<ReportsError error={error} retry={retry} />);

    expect(screen.getByRole('alert')).toHaveTextContent('The reports could not be loaded.');
    expect(screen.queryByText(/ECONNREFUSED/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('puts the report pages in the console layout', () => {
    expect(ReportsLayout.name).toBe('ConsoleLayout');
  });
});
