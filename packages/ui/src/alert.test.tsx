import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Alert } from './alert';

describe('Alert', () => {
  it.each([
    ['error', 'alert'],
    ['warning', 'alert'],
    ['info', 'status'],
    ['success', 'status'],
  ] as const)('uses the %s tone with the %s live-region role', (tone, role) => {
    render(<Alert tone={tone}>Message</Alert>);

    const alert = screen.getByRole(role);
    expect(alert).toHaveTextContent('Message');
    expect(alert).toHaveAttribute('data-tone', tone);
  });

  it('defaults to an informational status', () => {
    render(<Alert>Saved</Alert>);

    expect(screen.getByRole('status')).toHaveAttribute('data-tone', 'info');
  });

  it('renders an optional title before the message', () => {
    render(
      <Alert tone="error" title="Camera blocked">
        Allow camera access in your browser settings.
      </Alert>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Camera blockedAllow camera access in your browser settings.',
    );
    expect(screen.getByText('Camera blocked').tagName).toBe('P');
  });
});
