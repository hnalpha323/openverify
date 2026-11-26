import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FlowApiError } from '../api/flow-api-client';
import { en } from '../i18n/locales/en';
import { renderWithI18n } from '../test-utils';
import { ApiError } from './api-error';

describe('ApiError', () => {
  it('explains the failure in the user’s words and offers a retry', async () => {
    const onRetry = vi.fn();
    renderWithI18n(
      <ApiError error={new FlowApiError('network', 'no response')} onRetry={onRetry} />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Something went wrong' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(en.errors.network);

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('never shows the server’s own wording', () => {
    const error = new FlowApiError('http', 'GET /x failed with HTTP 500', {
      status: 500,
      problem: {
        type: 'about:blank',
        title: 'Internal Server Error',
        status: 500,
        detail: 'database timeout on shard 3',
        instance: '/api/v1/flow/session',
        requestId: 'req-1',
      },
    });
    renderWithI18n(<ApiError error={error} onRetry={vi.fn()} />);

    expect(screen.getByRole('alert')).toHaveTextContent(en.errors.server);
    expect(screen.queryByText(/shard/)).not.toBeInTheDocument();
  });
});
