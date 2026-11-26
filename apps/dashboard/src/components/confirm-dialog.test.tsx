import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './confirm-dialog';

describe('ConfirmDialog', () => {
  it('asks a question with a cancel and a confirm button', () => {
    render(
      <ConfirmDialog
        open
        title="Redact this inquiry?"
        description="Its personal data and files are deleted. This cannot be undone."
        confirmLabel="Redact"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Redact this inquiry?' });
    expect(dialog).toHaveAccessibleDescription(
      'Its personal data and files are deleted. This cannot be undone.',
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Redact' })).toHaveAttribute(
      'data-variant',
      'danger',
    );
  });

  it('focuses Cancel first, so Enter never confirms a destructive action by accident', () => {
    render(
      <ConfirmDialog
        open
        title="Expire?"
        confirmLabel="Expire"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('calls onConfirm and onCancel', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Approve?"
        confirmLabel="Approve"
        tone="primary"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Approve' })).toHaveAttribute(
      'data-variant',
      'primary',
    );
  });

  it('submits a form to a server action, with its fields', async () => {
    const formAction = vi.fn<(formData: FormData) => void>();
    render(
      <ConfirmDialog
        open
        title="Remove the factor?"
        confirmLabel="Remove"
        onCancel={vi.fn()}
        formAction={formAction}
        fields={{ 'factor-id': 'mfa_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z' }}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(formAction).toHaveBeenCalledOnce();
    expect(formAction.mock.calls[0]?.[0].get('factor-id')).toBe('mfa_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z');
  });

  it('shows progress and blocks both buttons and Escape while pending', async () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        pending
        title="Expire?"
        confirmLabel="Expire"
        pendingLabel="Expiring…"
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Expiring…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('renders extra content, such as a problem, inside the dialog', () => {
    render(
      <ConfirmDialog
        open
        title="Expire?"
        confirmLabel="Expire"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      >
        <p>The API refused.</p>
      </ConfirmDialog>,
    );

    expect(screen.getByRole('dialog')).toHaveTextContent('The API refused.');
  });
});
