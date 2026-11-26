import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OneTimeSecretDialog } from './one-time-secret-dialog';

const TOKEN = 'ov_sbx_SyntheticTokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const CODES = ['0000-1111-2222', '3333-4444-5555'];

describe('OneTimeSecretDialog', () => {
  it('shows the secret once, read-only, with a warning and a copy button', () => {
    render(
      <OneTimeSecretDialog
        open
        title="API key created"
        label="Token"
        secret={TOKEN}
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'API key created' });
    expect(dialog).toHaveAccessibleDescription(
      'This is the only time it is shown. Copy it now and keep it somewhere safe.',
    );
    const field = screen.getByRole('textbox', { name: 'Token' });
    expect(field).toHaveValue(TOKEN);
    expect(field).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Copy' })).toBeVisible();
  });

  it('shows a list of codes, copied together', async () => {
    const user = userEvent.setup();
    render(
      <OneTimeSecretDialog
        open
        title="Recovery codes"
        label="Recovery codes"
        secret={CODES}
        onClose={vi.fn()}
      />,
    );

    const list = screen.getByRole('list', { name: 'Recovery codes' });
    expect(list).toHaveTextContent('0000-1111-2222');
    expect(list).toHaveTextContent('3333-4444-5555');
    await user.click(screen.getByRole('button', { name: 'Copy all' }));
    await expect(navigator.clipboard.readText()).resolves.toBe(CODES.join('\n'));
  });

  it('closes with Done or Escape, so the owner can drop the secret', async () => {
    const onClose = vi.fn();
    render(
      <OneTimeSecretDialog open title="Secret" label="Secret" secret={TOKEN} onClose={onClose} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await userEvent.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('renders extra content, such as a QR code', () => {
    render(
      <OneTimeSecretDialog open title="Secret" label="Secret" secret={TOKEN} onClose={vi.fn()}>
        <p>Scan this code.</p>
      </OneTimeSecretDialog>,
    );

    expect(screen.getByText('Scan this code.')).toBeVisible();
  });
});
