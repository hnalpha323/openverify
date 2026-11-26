// Must stay the first import: it configures zod before any module parses a schema.
import './security/csp-safe-zod';
import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { resolveApiBaseUrl } from './api/runtime-api-url';
import { App } from './app';
import { mountEmbedBridge } from './embed/bridge';
import { createI18n } from './i18n/create-i18n';
import { syncDocumentLanguage } from './i18n/document-language';
import { detectLanguage } from './i18n/languages';
import { bootstrapSession, browserSessionStorage } from './session/session-bootstrap';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root element');
}

// First, before anything else runs: take the credentials out of the URL fragment.
const bootstrap = bootstrapSession({
  location: window.location,
  history: window.history,
  storage: browserSessionStorage(window),
});

// C159.4 (Workflow 9A): the embed bridge's handshake with the page that frames the flow, built by
// flow-server-embed; it starts before the session is read, so no message from the page is missed.
mountEmbedBridge(window);

// An explicit ?lang= (e.g. from the embedding page) wins over the browser's preferences.
const i18n = createI18n(
  detectLanguage([new URLSearchParams(window.location.search).get('lang'), ...navigator.languages]),
);
syncDocumentLanguage(i18n, document.documentElement);

// C257.1 (Phase 11, Workflow 11C): the build-time API URL as before, or, for a bundle built
// without one (the image), the flow server's /config.json, read before the first render.
void resolveApiBaseUrl(import.meta.env.VITE_OPENVERIFY_API_URL, (input, init) =>
  globalThis.fetch(input, init),
).then((apiBaseUrl) => {
  createRoot(container).render(
    <StrictMode>
      <App i18n={i18n} bootstrap={bootstrap} apiBaseUrl={apiBaseUrl} />
    </StrictMode>,
  );
});
