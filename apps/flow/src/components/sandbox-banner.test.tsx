import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '../i18n/locales/en';
import { renderWithI18n } from '../test-utils';
import { SandboxBanner } from './sandbox-banner';

describe('SandboxBanner (C19)', () => {
  it('names the sandbox and asks for test data only', () => {
    renderWithI18n(<SandboxBanner />);

    const banner = screen.getByRole('note', { name: en.sandbox.label });
    expect(banner).toBeVisible();
    expect(banner).toHaveTextContent(en.sandbox.message);
  });

  it('does not interrupt screen readers like an alert would', () => {
    renderWithI18n(<SandboxBanner />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('is translated', () => {
    renderWithI18n(<SandboxBanner />, 'es');

    expect(screen.getByRole('note', { name: 'Entorno de pruebas' })).toBeVisible();
  });
});
