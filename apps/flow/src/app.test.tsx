import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { createI18n } from './i18n/create-i18n';
import { en } from './i18n/locales/en';
import { FlowRoutes, type FlowStart } from './routes';
import { FakeFlowApi } from './testing/fake-flow-api';
import { INQUIRY_ID, SESSION_TOKEN, flowSession } from './testing/flow-fixtures';

const CONSENT_TITLE = 'Consent to use your biometric data';

function ready(api = new FakeFlowApi()): FlowStart {
  return { status: 'ready', inquiryId: INQUIRY_ID, client: api.client };
}

function renderAt(path: string, start: FlowStart = ready()) {
  const i18n = createI18n('en');
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>
        <FlowRoutes start={start} />
      </MemoryRouter>
    </I18nextProvider>,
  );
  return { i18n };
}

describe('FlowRoutes', () => {
  it('runs the flow from the start page', async () => {
    renderAt('/');

    expect(await screen.findByRole('heading', { level: 1, name: CONSENT_TITLE })).toBeVisible();
  });

  it.each(['missing', 'invalid', 'reloaded'] as const)('explains a %s link', async (reason) => {
    renderAt('/', { status: 'error', reason });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'We could not open your verification' }),
    ).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(en.link[reason]);
  });

  it('shows a not-found page with a way back for unknown paths', async () => {
    renderAt('/does-not-exist');

    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Start over' })).toHaveAttribute('href', '/');
  });

  it('shows the product name in the page banner', async () => {
    renderAt('/');

    expect(await screen.findByRole('banner')).toHaveTextContent('OpenVerify');
  });

  it('lets the user switch the language', async () => {
    const { i18n } = renderAt('/');

    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: 'Language' }),
      'Español',
    );

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Consentimiento para usar tus datos biométricos',
      }),
    ).toBeVisible();
    expect(i18n.language).toBe('es');
    expect(screen.getByRole('combobox', { name: 'Idioma' })).toHaveValue('es');
  });
});

describe('App', () => {
  it('calls the API with the session token from the link', async () => {
    window.history.replaceState(null, '', '/');
    const fetchStub = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify(flowSession()), {
          headers: { 'content-type': 'application/json' },
        }),
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
      />,
    );

    expect(await screen.findByRole('heading', { level: 1, name: CONSENT_TITLE })).toBeVisible();
    const [url, init] = fetchStub.mock.calls[0] ?? [];
    expect(url).toBe('https://api.example.com/api/v1/flow/session');
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
  });

  it.each([
    ['inquiry_expired', en.expired.title],
    ['inquiry_redacted', en.ended.redacted.title],
    ['inquiry_finished', en.ended.canceled.title],
    // A reason added by a newer server: the session still ended, so the ended screen.
    ['inquiry_archived', en.ended.canceled.title],
  ])(
    'ends a session canceled with reason %s on its own screen, with no retry (C25.8)',
    async (reason, title) => {
      window.history.replaceState(null, '', '/');
      const fetchStub = vi.fn<typeof fetch>(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              type: 'about:blank',
              title: 'Unauthorized',
              status: 401,
              detail: 'The session was canceled.',
              instance: '/api/v1/flow/session',
              requestId: 'req-1',
              code: 'session_canceled',
              reason,
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
        />,
      );

      expect(await screen.findByRole('heading', { level: 1, name: title })).toBeVisible();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    },
  );

  it('explains a link it could not read', async () => {
    window.history.replaceState(null, '', '/');

    render(
      <App
        i18n={createI18n('en')}
        bootstrap={{ status: 'error', reason: 'invalid' }}
        apiBaseUrl=""
      />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(en.link.invalid);
  });

  it('redeems a one-time link once, then calls the API with the session token it got (C19)', async () => {
    window.history.replaceState(null, '', '/');
    const oneTimeToken = `ovo_${'C'.repeat(43)}`;
    const urlOf = (input: RequestInfo | URL) =>
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const fetchStub = vi.fn<typeof fetch>((input) =>
      Promise.resolve(
        urlOf(input).endsWith('/one-time-links/redeem')
          ? new Response(
              JSON.stringify({
                'session-token': SESSION_TOKEN,
                'expires-at': '2026-10-21T12:00:00.000Z',
              }),
              { headers: { 'content-type': 'application/json' } },
            )
          : new Response(JSON.stringify(flowSession()), {
              headers: { 'content-type': 'application/json' },
            }),
      ),
    );

    render(
      <StrictMode>
        <App
          i18n={createI18n('en')}
          bootstrap={{ status: 'one-time-link', link: { inquiryId: INQUIRY_ID, oneTimeToken } }}
          apiBaseUrl="https://api.example.com"
          fetch={fetchStub}
        />
      </StrictMode>,
    );

    expect(await screen.findByRole('heading', { level: 1, name: CONSENT_TITLE })).toBeVisible();
    const urls = fetchStub.mock.calls.map(([url]) => urlOf(url));
    expect(urls.filter((url) => url.endsWith('/redeem'))).toEqual([
      'https://api.example.com/api/v1/flow/one-time-links/redeem',
    ]);
    const [, redeemInit] = fetchStub.mock.calls[0] ?? [];
    expect(new Headers(redeemInit?.headers).get('authorization')).toBeNull();
    const sessionCall = fetchStub.mock.calls.find(([url]) => urlOf(url).endsWith('/session'));
    expect(new Headers(sessionCall?.[1]?.headers).get('authorization')).toBe(
      `Bearer ${SESSION_TOKEN}`,
    );
    // Memory only: nothing about the link or its session is stored in the tab.
    const stored = Array.from({ length: window.sessionStorage.length }, (_, index) => {
      const key = window.sessionStorage.key(index) ?? '';
      return `${key}=${window.sessionStorage.getItem(key) ?? ''}`;
    }).join('\n');
    expect(stored).not.toContain(SESSION_TOKEN);
    expect(stored).not.toContain(oneTimeToken);
  });
});
