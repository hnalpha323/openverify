import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { createI18n } from './i18n/create-i18n';
import { intlLocale } from './i18n/intl-locale';
import { INQUIRY_ID, SESSION_TOKEN, flowSession } from './testing/flow-fixtures';
import { applySessionTheme } from './theme/apply';

// C160.9 (V15) and C161.2 (Workflow 9A): the hosted URL's public parameters reach the theme and
// the language choice. `applySessionTheme` is api-themes' (a no-op until 9B), so it is observed here.
// The layout's brand (Workflow 9B) reads the rest of the module, so only the call is replaced.
vi.mock('./theme/apply', async (original) => ({
  ...(await original<typeof import('./theme/apply')>()),
  applySessionTheme: vi.fn(),
}));

afterEach(() => {
  window.history.replaceState(null, '', '/');
  vi.mocked(applySessionTheme).mockClear();
});

function renderApp() {
  const i18n = createI18n('en');
  const fetchStub = vi.fn<typeof fetch>(() =>
    Promise.resolve(
      new Response(JSON.stringify(flowSession()), {
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  render(
    <App
      i18n={i18n}
      bootstrap={{
        status: 'ready',
        credentials: { inquiryId: INQUIRY_ID, sessionToken: SESSION_TOKEN },
      }}
      apiBaseUrl="https://api.example.com"
      fetch={fetchStub}
    />,
  );
  return { i18n };
}

describe('the hosted URL parameters', () => {
  it('passes the style-variant parameter to the session theme', async () => {
    window.history.replaceState(null, '', '/?style-variant=dark');
    renderApp();

    await waitFor(() => {
      expect(applySessionTheme).toHaveBeenCalledWith(
        expect.objectContaining({ inquiry: { id: INQUIRY_ID, status: 'pending' } }),
        'dark',
        // Workflow 9B: the renderer's loader of the session's theme assets.
        expect.objectContaining({ loadAsset: expect.any(Function) as unknown }),
      );
    });
  });

  it('passes no variant when the URL names none', async () => {
    renderApp();

    await waitFor(() => {
      expect(applySessionTheme).toHaveBeenCalledWith(expect.anything(), null, expect.anything());
    });
  });

  it('opens in the language parameter, formatting with its full tag', async () => {
    window.history.replaceState(null, '', '/?language=es-MX');
    const { i18n } = renderApp();

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Consentimiento para usar tus datos biométricos',
      }),
    ).toBeVisible();
    expect(i18n.language).toBe('es');
    expect(intlLocale(i18n)).toBe('es-MX');
  });
});
