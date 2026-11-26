import type { i18n as I18n } from 'i18next';
import { useCallback, useEffect, useMemo } from 'react';
import { I18nextProvider } from 'react-i18next';
import { BrowserRouter } from 'react-router';
import { createFlowApiClient } from './api/flow-api-client';
import { redeemOneTimeLink } from './api/one-time-link-client';
import { FlowRoutes, type FlowStart } from './routes';
import { rememberRequestedLocales } from './i18n/intl-locale';
import { negotiateLanguage } from './i18n/languages';
import { readFlowParameters } from './session/flow-parameters';
import { RequestedLanguagesContext } from './session/requested-languages';
import type { BootstrapResult } from './session/session-bootstrap';
import type { FlowSessionResponse } from '@openverify/contracts';
import {
  applyPageVariant,
  applySessionTheme,
  type ApplyThemeOptions,
  type StyleVariant,
} from './theme/apply';
import { SessionThemeContext } from './theme/session-theme';

export interface AppProps {
  readonly i18n: I18n;
  /** Credentials read from the link (see `bootstrapSession`). */
  readonly bootstrap: BootstrapResult;
  /** API base URL from `parseApiBaseUrl`; `''` for the flow's own origin. */
  readonly apiBaseUrl: string;
  /** Injected in tests; defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
  /**
   * C160.9 (Workflow 9A): the page's `style-variant` (the hosted URL's or the embed option's), which
   * `flow-renderer` parses in `src/session/`; absent, the page URL's (`readFlowParameters`).
   */
  readonly styleVariant?: StyleVariant | null;
}

/** The hosted flow: providers plus browser-history routing. */
export function App({ i18n, bootstrap, apiBaseUrl, fetch, styleVariant }: AppProps) {
  // C160.9, C161.2 (Workflow 9A): the page URL's public parameters, read once (the bootstrap carried
  // a fragment's into the query).
  const parameters = useMemo(() => readFlowParameters(window.location), []);
  const variant = styleVariant === undefined ? (parameters?.styleVariant ?? null) : styleVariant;
  // C161.2: the URL's `language`, then the browser's languages, in priority order.
  const requested = useMemo(
    () => [...(parameters?.languages ?? []), ...navigator.languages],
    [parameters],
  );
  useEffect(() => {
    rememberRequestedLocales(i18n, requested);
    if ((parameters?.languages.length ?? 0) > 0) {
      void i18n.changeLanguage(negotiateLanguage(requested).language);
    }
  }, [i18n, parameters, requested]);
  // C160.9 (Workflow 9D): the page's variant on the built-in palettes before any session, so a
  // screen drawn without one keeps it; a session's theme repaints over it.
  useEffect(() => {
    applyPageVariant(variant);
  }, [variant]);
  // C160.9 (Workflow 9A Stage 1b (H)): what renders a session applies its theme through this, bound
  // to the page's style variant (`applySessionTheme`, built by api-themes in 9B).
  const applyTheme = useCallback(
    (session: FlowSessionResponse, options?: ApplyThemeOptions) => {
      if (options === undefined) {
        applySessionTheme(session, variant);
      } else {
        applySessionTheme(session, variant, options);
      }
    },
    [variant],
  );
  const start = useMemo<FlowStart>(() => {
    if (bootstrap.status === 'error') {
      return { status: 'error', reason: bootstrap.reason };
    }
    const transport = { baseUrl: apiBaseUrl, ...(fetch === undefined ? {} : { fetch }) };
    const connect = (sessionToken: string) => createFlowApiClient({ ...transport, sessionToken });
    if (bootstrap.status === 'handoff') {
      // C96.3 (Workflow 7A): the phone's handoff link; its token stays in memory.
      return {
        status: 'handoff',
        inquiryId: bootstrap.handoff.inquiryId,
        handoffToken: bootstrap.handoff.handoffToken,
        transport,
        connect,
      };
    }
    if (bootstrap.status === 'one-time-link') {
      const { link } = bootstrap;
      return {
        status: 'one-time-link',
        inquiryId: link.inquiryId,
        redeem: () => redeemOneTimeLink(transport, link),
        connect,
      };
    }
    const { inquiryId, sessionToken } = bootstrap.credentials;
    return { status: 'ready', inquiryId, client: connect(sessionToken) };
  }, [bootstrap, apiBaseUrl, fetch]);

  return (
    <I18nextProvider i18n={i18n}>
      <SessionThemeContext.Provider value={applyTheme}>
        <RequestedLanguagesContext value={requested}>
          <BrowserRouter>
            <FlowRoutes start={start} />
          </BrowserRouter>
        </RequestedLanguagesContext>
      </SessionThemeContext.Provider>
    </I18nextProvider>
  );
}
