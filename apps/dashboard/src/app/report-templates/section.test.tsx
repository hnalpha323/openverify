import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConsoleLayout } from '../../components/console-layout';
import TemplateLoading from './[id]/loading';
import VersionLoading from './[id]/versions/[versionId]/loading';
import ReportTemplatesError from './error';
import ReportTemplatesLayout from './layout';
import ReportTemplatesLoading from './loading';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the report templates section (C86)', () => {
  it('is in the console layout', () => {
    expect(ReportTemplatesLayout).toBe(ConsoleLayout);
  });

  it('announces each loading state', () => {
    render(
      <>
        <ReportTemplatesLoading />
        <TemplateLoading />
        <VersionLoading />
      </>,
    );

    expect(screen.getAllByRole('status').map((status) => status.textContent)).toEqual([
      'Loading report templates…',
      'Loading the report template…',
      'Loading the template version…',
    ]);
  });

  it('explains a failure without internals and offers a retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const retry = vi.fn();

    render(<ReportTemplatesError error={new Error('ECONNRESET')} retry={retry} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('The report templates could not be loaded.');
    expect(within(alert).queryByText(/ECONNRESET/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
