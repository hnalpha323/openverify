import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { preferences } from '../../testing/routes/settings';
import { ToastProvider } from '../toasts';
import { NotificationPreferencesForm } from './notification-preferences-form';

describe('NotificationPreferencesForm (C169.7)', () => {
  it('submits the boxes as ticked and says when it saved', async () => {
    const action = vi.fn(() => Promise.resolve({ ok: true as const, data: preferences() }));
    render(
      <ToastProvider>
        <NotificationPreferencesForm preferences={preferences()} action={action} />
      </ToastProvider>,
    );

    await userEvent.click(
      screen.getByRole('checkbox', {
        name: 'A webhook’s failure alert fires (needs webhooks:read): by email',
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save notification settings' }));

    await waitFor(() => {
      expect(action).toHaveBeenCalledTimes(1);
    });
    const form = (action.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect(form.get('webhook-failure.email')).toBe('on');
    expect(form.get('webhook-failure.console')).toBe('on');
    expect(form.get('assigned.email')).toBeNull();
    expect(await screen.findByText('Notification settings saved.')).toBeVisible();
  });

  it('shows the refusal', async () => {
    const action = vi.fn(() =>
      Promise.resolve({ ok: false as const, problem: { title: 'Could not save' } }),
    );
    render(
      <ToastProvider>
        <NotificationPreferencesForm preferences={preferences()} action={action} />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Save notification settings' }));

    expect(await screen.findByText('Could not save')).toBeVisible();
  });
});
