import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConsoleLayout } from '../../components/console-layout';
import AccountLoading from './[id]/loading';
import AccountsError from './error';
import AccountsLayout from './layout';
import AccountsLoading from './loading';

vi.mock('../actions/auth', () => ({ logout: vi.fn() }));
vi.mock('../actions/environment', () => ({ switchEnvironment: vi.fn() }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('accounts section', () => {
  it('is in the console layout', () => {
    expect(AccountsLayout).toBe(ConsoleLayout);
  });

  it('announces its loading states', () => {
    render(<AccountsLoading />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading accounts…');
  });

  it('announces that one account is loading', () => {
    render(<AccountLoading />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading the account…');
  });

  it('explains a failure without internals and offers a retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const retry = vi.fn();

    render(<AccountsError error={new Error('connect ECONNREFUSED')} retry={retry} />);

    expect(screen.getByRole('alert')).toHaveTextContent('The accounts could not be loaded.');
    expect(screen.queryByText(/ECONNREFUSED/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
