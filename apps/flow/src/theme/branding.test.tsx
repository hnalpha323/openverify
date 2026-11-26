/**
 * C160.6, C160.9 (`api-themes`, Workflow 9B): the theme's logo in the header, from a `blob:` URL made
 * only after its bytes sniff as PNG, JPEG or WebP; a decorative logo has no alt text and shows the
 * organisation's display name as text; with no logo, or bytes that are not an image, the header
 * keeps its own name.
 */
import { render, screen } from '@testing-library/react';
import type { FlowSessionResponse, FlowTheme } from '@openverify/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applySessionTheme } from './apply';
import { ThemeBranding } from './branding';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).buffer;
const LOGO_ID = 'tsa_01M5CK16P0D13FXHZSS4TCFBVH';

const palette = Object.fromEntries(
  [
    'primary',
    'primary-hover',
    'on-primary',
    'danger',
    'danger-hover',
    'surface',
    'canvas',
    'ink',
    'ink-muted',
    'line',
    'control',
    'focus',
  ].map((token) => [token, '#000000']),
) as FlowTheme['light'];

function withLogo(logo: FlowTheme['logo']) {
  const root = document.createElement('html');
  applySessionTheme(
    {
      inquiry: { id: 'inq_01M5CK16P0D13FXHZSS4TCFBVH', status: 'pending' },
      theme: {
        'theme-set-id': null,
        revision: null,
        mode: 'light',
        light: palette,
        dark: null,
        radius: 6,
        font: { kind: 'system', platforms: ['web', 'android'] },
        logo,
        placement: 'header',
      },
    } as unknown as FlowSessionResponse,
    null,
    { root },
  );
}

afterEach(() => {
  withLogo(null);
});

describe('ThemeBranding (C160.6)', () => {
  it('shows the flow’s own name with no logo', () => {
    render(<ThemeBranding fallback="Identity verification" />);
    expect(screen.getByText('Identity verification')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('shows a logo from a blob: URL with its alt text', async () => {
    withLogo({ 'asset-id': LOGO_ID, 'alt-key': 'brand.logo.alt', decorative: false });
    const loadAsset = vi.fn(() => Promise.resolve({ bytes: PNG, mediaType: 'image/png' }));

    render(
      <ThemeBranding
        fallback="Identity verification"
        loadAsset={loadAsset}
        translate={(key) => (key === 'brand.logo.alt' ? 'Example Bank' : key)}
      />,
    );

    const image = await screen.findByRole('img', { name: 'Example Bank' });
    expect(image.getAttribute('src')).toMatch(/^blob:/);
    expect(loadAsset).toHaveBeenCalledWith(LOGO_ID, expect.any(AbortSignal));
    expect(screen.queryByText('Identity verification')).toBeNull();
  });

  it('gives a decorative logo no alt text, and the organisation’s name as text', async () => {
    withLogo({ 'asset-id': LOGO_ID, 'alt-key': null, decorative: true });
    const { container } = render(
      <ThemeBranding
        fallback="Identity verification"
        organizationDisplayName="Example Bank"
        loadAsset={() => Promise.resolve({ bytes: PNG, mediaType: 'image/png' })}
      />,
    );

    await vi.waitFor(() => {
      expect(container.querySelector('img')).not.toBeNull();
    });
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('');
    expect(screen.getByText('Example Bank')).toBeInTheDocument();
  });

  it('keeps the flow’s own name when the bytes are not an image', async () => {
    withLogo({ 'asset-id': LOGO_ID, 'alt-key': 'brand.logo.alt', decorative: false });
    const loadAsset = vi.fn(() =>
      Promise.resolve({ bytes: new TextEncoder().encode('<svg/>').buffer, mediaType: 'image/png' }),
    );
    render(<ThemeBranding fallback="Identity verification" loadAsset={loadAsset} />);

    await vi.waitFor(() => {
      expect(loadAsset).toHaveBeenCalled();
    });
    expect(screen.getByText('Identity verification')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('reads the logo through the loader the session’s theme was applied with (Workflow 9B)', async () => {
    const loadAsset = vi.fn(() => Promise.resolve({ bytes: PNG, mediaType: 'image/png' }));
    const root = document.createElement('html');
    applySessionTheme(
      {
        inquiry: { id: 'inq_01M5CK16P0D13FXHZSS4TCFBVH', status: 'pending' },
        theme: {
          'theme-set-id': null,
          revision: null,
          mode: 'light',
          light: palette,
          dark: null,
          radius: 6,
          font: { kind: 'system', platforms: ['web', 'android'] },
          logo: { 'asset-id': LOGO_ID, 'alt-key': 'brand.logo.alt', decorative: false },
          placement: 'header',
        },
      } as unknown as FlowSessionResponse,
      null,
      { root, loadAsset },
    );

    render(<ThemeBranding fallback="Identity verification" />);

    expect(await screen.findByRole('img')).toHaveAttribute('src', expect.stringMatching(/^blob:/));
    expect(loadAsset).toHaveBeenCalledWith(LOGO_ID, expect.any(AbortSignal));
  });
});
