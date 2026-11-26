import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConsoleLayout } from '../../components/console-layout';
import AccountTypesError from './error';
import AccountTypesLayout from './layout';
import AccountTypesLoading from './loading';

vi.mock('../actions/auth', () => ({ logout: vi.fn() }));
vi.mock('../actions/environment', () => ({ switchEnvironment: vi.fn() }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('account types section', () => {
  it('is in the console layout', () => {
    expect(AccountTypesLayout).toBe(ConsoleLayout);
  });

  it('announces its loading state', () => {
    render(<AccountTypesLoading />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading account types…');
  });

  it('explains a failure without internals and offers a retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const retry = vi.fn();

    render(<AccountTypesError error={new Error('socket hang up')} retry={retry} />);

    expect(screen.getByRole('alert')).toHaveTextContent('The account types could not be loaded.');
    expect(screen.queryByText(/socket/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
