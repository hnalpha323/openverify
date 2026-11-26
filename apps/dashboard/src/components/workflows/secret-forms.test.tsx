import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ToastProvider } from '../toasts';
import { CreateSecretForm, EditSecretButton, SecretValueButton } from './secret-forms';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;
/** A canary, never a real credential. */
const CANARY = 'canary-not-a-real-secret-0002';
const ENV = 'env_01J9ZK3M5Q7R8S9T0V1W2X3Y51';

describe('the secret forms (C125, C141.7)', () => {
  it('rotates a value through a password control, sending the key, the mode and the value once', async () => {
    const action = vi.fn<Action>(() => Promise.resolve({ ok: true, data: undefined }));
    render(
      <ToastProvider>
        <SecretValueButton secretKey="slack_token" hasValue action={action} />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Rotate the value of slack_token' }));
    const dialog = screen.getByRole('dialog', { name: 'Rotate slack_token' });
    const value = within(dialog).getByLabelText(/Value/);
    expect(value).toHaveAttribute('type', 'password');
    expect(value).toHaveAttribute('autocomplete', 'off');
    await userEvent.type(value, CANARY);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rotate' }));

    expect(await screen.findByRole('status')).toHaveTextContent('The value was rotated.');
    const sent = action.mock.calls[0]?.[1];
    expect(sent?.get('key')).toBe('slack_token');
    expect(sent?.get('mode')).toBe('rotate');
    expect(sent?.get('secret-value')).toBe(CANARY);
  });

  it('shows a refused host next to the hosts, by its pointer', async () => {
    const action = vi.fn<Action>(() =>
      Promise.resolve({
        ok: false,
        problem: {
          title: 'Check the values you entered',
          errors: [
            {
              pointer: '/data/attributes/allowed-hosts/0',
              detail: 'must be a normalised host name',
            },
          ],
        },
      }),
    );
    render(
      <ToastProvider>
        <CreateSecretForm environmentId={ENV} action={action} />
      </ToastProvider>,
    );

    const form = screen.getByRole('form', { name: 'Create a secret' });
    await userEvent.type(within(form).getByRole('textbox', { name: /Key/ }), 'slack_token');
    await userEvent.type(within(form).getByRole('textbox', { name: /Allowed hosts/ }), 'Bad Host');
    await userEvent.click(within(form).getByRole('button', { name: 'Create secret' }));

    expect(await within(form).findByText('must be a normalised host name')).toBeVisible();
    expect(action.mock.calls[0]?.[1].get('environment-id')).toBe(ENV);
  });

  it('edits the description, hosts and placements in a dialog, prefilled, and never asks for a value', async () => {
    const action = vi.fn<Action>(() => Promise.resolve({ ok: true, data: undefined }));
    render(
      <ToastProvider>
        <EditSecretButton
          secretKey="slack_token"
          description="Synthetic token"
          hosts={['hooks.example.com']}
          headers={['authorization']}
          bodyPointers={[]}
          action={action}
        />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Edit slack_token' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit slack_token' });
    expect(within(dialog).getByRole('textbox', { name: /Allowed hosts/ })).toHaveValue(
      'hooks.example.com',
    );
    expect(within(dialog).getByRole('textbox', { name: /Headers that may carry it/ })).toHaveValue(
      'authorization',
    );
    expect(within(dialog).queryByLabelText(/Value/)).toBeNull();
    expect(dialog).toHaveTextContent(/production user session/);
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: /Body pointers that may carry it/ }),
      '/auth/token',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('status')).toHaveTextContent('The secret was updated.');
    const sent = action.mock.calls[0]?.[1];
    expect(sent?.get('key')).toBe('slack_token');
    expect(sent?.get('body-pointers')).toBe('/auth/token');
  });

  it('shows a refused host by its pointer in the edit dialog', async () => {
    const action = vi.fn<Action>(() =>
      Promise.resolve({
        ok: false,
        problem: {
          title: 'Check the values you entered',
          errors: [{ pointer: '/data/attributes/allowed-hosts/0', detail: 'must be a host name' }],
        },
      }),
    );
    render(
      <ToastProvider>
        <EditSecretButton
          secretKey="slack_token"
          description={null}
          hosts={['hooks.example.com']}
          headers={['authorization']}
          bodyPointers={[]}
          action={action}
        />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Edit slack_token' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit slack_token' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await within(dialog).findByText(/Host 1: must be a host name/)).toBeVisible();
  });
});
