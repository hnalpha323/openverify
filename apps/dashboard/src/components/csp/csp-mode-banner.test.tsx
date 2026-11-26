import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CSP_MODE_ENV } from '../../lib/csp/policy';
import { CspModeBanner } from './csp-mode-banner';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('CspModeBanner (C170.5)', () => {
  it('says in words and an icon that the script policy is not enforced in report-only mode', () => {
    render(<CspModeBanner mode="report-only" />);

    const banner = screen.getByRole('status', { name: 'Script policy' });
    expect(banner).toHaveTextContent(
      'Script policy not enforced. The console reports Content Security Policy violations but does not block them (OPENVERIFY_DASHBOARD_CSP_MODE=report-only).',
    );
    expect(banner.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('shows nothing when the policy is enforced', () => {
    const { container } = render(<CspModeBanner mode="enforce" />);

    expect(container).toBeEmptyDOMElement();
  });

  it('reads the mode from the console configuration when none is given', () => {
    vi.stubEnv(CSP_MODE_ENV, 'report-only');
    render(<CspModeBanner />);
    expect(screen.getByRole('status', { name: 'Script policy' })).toBeVisible();
  });

  it('enforces, and so shows nothing, when the configuration is unset', () => {
    vi.stubEnv(CSP_MODE_ENV, '');
    const { container } = render(<CspModeBanner />);
    expect(container).toBeEmptyDOMElement();
  });
});
