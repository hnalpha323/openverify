import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FlowApiError } from '../api/flow-api-client';
import { en } from '../i18n/locales/en';
import { renderWithFlow } from '../test-utils';
import { FinalizingStep } from './finalizing-step';

describe('FinalizingStep', () => {
  it('tells the user the verification is being finished', () => {
    renderWithFlow(<FinalizingStep onPoll={() => new Promise(() => undefined)} />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Finishing your verification' }),
    ).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(en.finalizing.message);
  });

  it('keeps reloading the session until the screen is replaced', async () => {
    const onPoll = vi.fn(() => Promise.resolve());
    const { unmount } = renderWithFlow(<FinalizingStep onPoll={onPoll} />);

    await waitFor(() => {
      expect(onPoll.mock.calls.length).toBeGreaterThanOrEqual(3);
    });
    unmount();
  });

  it('says when finishing takes longer than usual, and checks again on request', async () => {
    const onPoll = vi.fn(() => Promise.resolve());
    renderWithFlow(<FinalizingStep onPoll={onPoll} />, { environment: { maxPolls: 2 } });

    expect(await screen.findByRole('alert')).toHaveTextContent(en.processing.slow);
    expect(onPoll).toHaveBeenCalledTimes(2);

    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));

    await waitFor(() => {
      expect(onPoll).toHaveBeenCalledTimes(4);
    });
  });

  it('explains when the session cannot be reloaded', async () => {
    const onPoll = vi.fn(() =>
      Promise.reject(new FlowApiError('http', 'GET failed with HTTP 401', { status: 401 })),
    );
    renderWithFlow(<FinalizingStep onPoll={onPoll} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.unauthorized);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });
});
