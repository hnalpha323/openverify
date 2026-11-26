import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConsoleLayout } from '../../components/console-layout';
import ApiKeysError from './error';
import ApiKeysLayout from './layout';
import ApiKeysLoading from './loading';

vi.mock('../actions/auth', () => ({ logout: vi.fn() }));
vi.mock('../actions/environment', () => ({ switchEnvironment: vi.fn() }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('API keys section', () => {
  it('is in the console layout', () => {
    expect(ApiKeysLayout).toBe(ConsoleLayout);
  });

  it('says what is loading', () => {
    render(<ApiKeysLoading />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading API keys…');
  });

  it('explains a failure without internals and offers a retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const retry = vi.fn();

    render(<ApiKeysError error={new Error('socket hang up')} retry={retry} />);

    expect(screen.getByRole('alert')).toHaveTextContent('The API keys could not be loaded.');
    expect(screen.queryByText(/socket hang up/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
