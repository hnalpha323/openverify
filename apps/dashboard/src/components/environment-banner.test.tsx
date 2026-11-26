import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EnvironmentBanner } from './environment-banner';

describe('EnvironmentBanner', () => {
  it('names the sandbox in amber', () => {
    render(<EnvironmentBanner kind="sandbox" />);

    const banner = screen.getByRole('status', { name: 'Environment' });
    expect(banner).toHaveTextContent('Sandbox');
    expect(banner).toHaveTextContent('Test data only');
    expect(banner).toHaveAttribute('data-environment', 'sandbox');
    expect(banner.className).toContain('amber');
  });

  it('names production on a neutral bar', () => {
    render(<EnvironmentBanner kind="production" />);

    const banner = screen.getByRole('status', { name: 'Environment' });
    expect(banner).toHaveTextContent('Production');
    expect(banner).toHaveTextContent('Live data');
    expect(banner).toHaveAttribute('data-environment', 'production');
    expect(banner.className).not.toContain('amber');
  });
});
