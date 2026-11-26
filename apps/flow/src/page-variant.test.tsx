/**
 * C160.9, C171.2 (Workflow 9D, `a11y-audit`): the page's `style-variant` holds on every screen,
 * including those drawn with no session to read a theme from. The audit's matrix found the
 * session-ended screens light under `style-variant=dark`: the built-in variant was applied only
 * with a session.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { createI18n } from './i18n/create-i18n';
import { INQUIRY_ID, SESSION_TOKEN } from './testing/flow-fixtures';
import { BUILTIN_VARIANT_ATTRIBUTE } from './theme/apply';

afterEach(() => {
  window.history.replaceState(null, '', '/');
  document.documentElement.removeAttribute(BUILTIN_VARIANT_ATTRIBUTE);
});

/** The flow with a session the API answers as expired (401 `session_expired`, C10). */
function renderEnded(styleVariant?: 'light' | 'dark' | null) {
  const fetchStub = vi.fn<typeof fetch>(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          type: 'about:blank',
          title: 'Unauthorized',
          status: 401,
          detail: 'The session expired.',
          instance: '/api/v1/flow/session',
          requestId: '00000000-0000-4000-8000-000000000000',
          code: 'session_expired',
        }),
        { status: 401, headers: { 'content-type': 'application/problem+json' } },
      ),
    ),
  );
  render(
    <App
      i18n={createI18n('en')}
      bootstrap={{
        status: 'ready',
        credentials: { inquiryId: INQUIRY_ID, sessionToken: SESSION_TOKEN },
      }}
      apiBaseUrl="https://api.example.com"
      fetch={fetchStub}
      {...(styleVariant === undefined ? {} : { styleVariant })}
    />,
  );
}

describe('the built-in variant without a session', () => {
  it('draws the session-ended screen in the dark palette the page asked for', async () => {
    window.history.replaceState(null, '', '/?style-variant=dark');
    renderEnded();

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Your verification session has expired',
      }),
    ).toBeVisible();
    expect(document.documentElement).toHaveAttribute(BUILTIN_VARIANT_ATTRIBUTE, 'dark');
  });

  it('keeps the light palette when the page asks for none, or for light', async () => {
    renderEnded('light');

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Your verification session has expired',
      }),
    ).toBeVisible();
    expect(document.documentElement).not.toHaveAttribute(BUILTIN_VARIANT_ATTRIBUTE);
  });
});
