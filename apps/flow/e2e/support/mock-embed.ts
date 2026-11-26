/**
 * C159 (Workflow 9A, flow-server-embed): the mocked suite's embedding page. It serves
 * `e2e/fixtures/embed-page/` (the full-stack fixture page) from a loopback page server of its own
 * (a customer origin), with `@openverify/js`'s IIFE built into a fresh directory under the system's
 * temporary directory (never `dist/`), and adds the session's `embed.allowed-origins` to the mocked
 * flow API through its registration hook.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { build } from 'vite';
import { registerMockFlowExtension, type MockFlowApi } from './mock-flow-api';
import { startPageServer, type RunningPageServer } from './mock-flow-server';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const PAGE_DIR = join(REPO_ROOT, 'e2e/fixtures/embed-page');

let client: Promise<string> | undefined;

/** `@openverify/js`'s IIFE, built once per worker through the package's own Vite config. */
export function embedClientCode(): Promise<string> {
  client ??= (async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'openverify-e2e-js-'));
    try {
      await build({
        configFile: join(REPO_ROOT, 'packages/sdk-js/vite.config.ts'),
        logLevel: 'silent',
        build: { outDir, emptyOutDir: true, sourcemap: false },
      });
      return readFileSync(join(outDir, 'openverify.iife.js'), 'utf8');
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  })();
  return client;
}

/**
 * Starts a loopback server for the embedding page (index, its script and the client). `script`
 * replaces the fixture's `embed-page.js` (the accessibility matrix's page, which also passes the
 * `styleVariant` option, Workflow 9D).
 */
export async function startEmbedPage(
  options: { readonly script?: string } = {},
): Promise<RunningPageServer> {
  const code = await embedClientCode();
  const index = readFileSync(join(PAGE_DIR, 'index.html'), 'utf8');
  const script = options.script ?? readFileSync(join(PAGE_DIR, 'embed-page.js'), 'utf8');
  const javascript = 'text/javascript; charset=utf-8';
  return startPageServer((path) => {
    switch (path) {
      case '/':
      case '/index.html':
        return { type: 'text/html; charset=utf-8', body: index };
      case '/embed-page.js':
        return { type: javascript, body: script };
      case '/openverify.iife.js':
        return { type: javascript, body: code };
      default:
        return null;
    }
  });
}

/** The page's URL embedding `inquiryId` from `flowOrigin` with `sessionToken`. */
export function embedPageUrl(
  origin: string,
  flowOrigin: string,
  inquiryId: string,
  sessionToken: string,
): string {
  const options = new URLSearchParams({
    'flow-url': flowOrigin,
    'inquiry-id': inquiryId,
    'session-token': sessionToken,
  });
  return `${origin}/#${options.toString()}`;
}

/**
 * Installs `api` for a flow embedded from `flowOrigin`: the mock answers CORS for the page it was
 * installed on (`page.url()`'s origin), which is the customer's page here, while the embedded
 * flow's requests come from the flow origin. The view below routes on the real page and names the
 * flow origin as its URL, so the mock answers the frame as it answers the hosted flow.
 */
export async function installForEmbedding(
  api: MockFlowApi,
  page: Page,
  flowOrigin: string,
): Promise<void> {
  const view: Pick<Page, 'route' | 'url'> = {
    route: page.route.bind(page),
    url: () => `${flowOrigin}/`,
  };
  await api.install(view as Page);
}

/** Adds `embed.allowed-origins` to every mocked session; answers a function that removes it. */
export function serveEmbedOrigins(origins: readonly string[]): () => void {
  return registerMockFlowExtension('embed', {
    session: (session) => ({ ...session, embed: { 'allowed-origins': origins } }),
  });
}

export interface EmbedEvent {
  readonly name: string;
  readonly payload: unknown;
}

/** What the embedding page's callbacks received, in order. */
export function embedEvents(page: Page): Promise<EmbedEvent[]> {
  return page.evaluate(
    () => (window as unknown as { openverifyEvents: EmbedEvent[] }).openverifyEvents,
  );
}

/** Every message the embedding page received, with its origin. */
export function embedMessages(page: Page): Promise<{ origin: string; data: unknown }[]> {
  return page.evaluate(
    () =>
      (window as unknown as { openverifyMessages: { origin: string; data: unknown }[] })
        .openverifyMessages,
  );
}
