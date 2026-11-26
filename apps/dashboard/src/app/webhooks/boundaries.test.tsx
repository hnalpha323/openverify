import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConsoleLayout } from '../../components/console-layout';
import WebhookLoading from './[id]/loading';
import WebhooksError from './error';
import WebhooksLayout from './layout';
import WebhooksLoading from './loading';

vi.mock('../actions/auth', () => ({ logout: vi.fn() }));
vi.mock('../actions/environment', () => ({ switchEnvironment: vi.fn() }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('webhooks section', () => {
  it('is in the console layout', () => {
    expect(WebhooksLayout).toBe(ConsoleLayout);
  });

  it('says what is loading', () => {
    render(<WebhooksLoading />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading webhooks…');
  });

  it('says what is loading on a webhook page', () => {
    render(<WebhookLoading />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading the webhook…');
  });

  it('explains a failure without internals and offers a retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const retry = vi.fn();

    render(<WebhooksError error={new Error('connect ECONNREFUSED')} retry={retry} />);

    expect(screen.getByRole('alert')).toHaveTextContent('The webhooks could not be loaded.');
    expect(screen.queryByText(/ECONNREFUSED/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
