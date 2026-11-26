import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConsoleLayout } from '../../components/console-layout';
import EventsError from '../events/error';
import EventsLayout from '../events/layout';
import EventsLoading from '../events/loading';
import ApiLogsError from './error';
import ApiLogsLayout from './layout';
import ApiLogsLoading from './loading';

vi.mock('../actions/auth', () => ({ logout: vi.fn() }));
vi.mock('../actions/environment', () => ({ switchEnvironment: vi.fn() }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each([
  {
    section: 'API logs',
    Layout: ApiLogsLayout,
    Loading: ApiLogsLoading,
    PageFailed: ApiLogsError,
    loading: 'Loading API logs…',
    failed: 'The API logs could not be loaded.',
  },
  {
    section: 'events',
    Layout: EventsLayout,
    Loading: EventsLoading,
    PageFailed: EventsError,
    loading: 'Loading events…',
    failed: 'The events could not be loaded.',
  },
])('$section section', ({ Layout, Loading, PageFailed, loading, failed }) => {
  it('is in the console layout', () => {
    expect(Layout).toBe(ConsoleLayout);
  });

  it('says what is loading', () => {
    render(<Loading />);
    expect(screen.getByRole('status')).toHaveTextContent(loading);
  });

  it('explains a failure without internals and offers a retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const retry = vi.fn();

    render(<PageFailed error={new Error('ETIMEDOUT 10.0.0.9')} retry={retry} />);

    expect(screen.getByRole('alert')).toHaveTextContent(failed);
    expect(screen.queryByText(/ETIMEDOUT/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
