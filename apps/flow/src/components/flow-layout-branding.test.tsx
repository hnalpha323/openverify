/**
 * C160.6 (Workflow 9B, integration-9b): the layout's header shows the theme's brand, the logo the
 * session's theme names (read through the loader it was applied with) or the flow's own name.
 */
import type { FlowSessionResponse, FlowTheme } from '@openverify/contracts';
import { screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithFlow } from '../test-utils';
import { applySessionTheme } from '../theme/apply';
import { FlowLayout } from './flow-layout';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).buffer;
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

function applyLogo(logo: FlowTheme['logo']) {
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
    {
      root: document.createElement('html'),
      loadAsset: vi.fn(() => Promise.resolve({ bytes: PNG, mediaType: 'image/png' })),
    },
  );
}

afterEach(() => {
  applyLogo(null);
});

const layout = () =>
  renderWithFlow(
    <MemoryRouter>
      <Routes>
        <Route element={<FlowLayout />}>
          <Route index element={<p>step</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

describe('FlowLayout’s brand (C160.6)', () => {
  it('shows the theme’s logo in the header', async () => {
    applyLogo({ 'asset-id': 'tsa_01M5CK16P0D13FXHZSS4TCFBVH', 'alt-key': null, decorative: true });
    const { container } = layout();

    await vi.waitFor(() => {
      expect(container.querySelector('header img')?.getAttribute('src')).toMatch(/^blob:/);
    });
  });

  it('shows the flow’s own name without a logo', () => {
    layout();

    expect(screen.getByRole('banner')).toHaveTextContent(/\S/);
    expect(screen.getByRole('banner').querySelector('img')).toBeNull();
  });
});
