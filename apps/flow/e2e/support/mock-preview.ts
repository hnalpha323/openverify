/**
 * C156.2 (Workflow 9A, flow-server-embed): the mocked suite's console page for the preview. It is
 * served at the console origin from a loopback page server of its own, and frames
 * `{flow origin}/preview` as the console will (`sandbox="allow-scripts allow-same-origin"`, no
 * referrer), keeping every message the preview posts from the flow origin and its frame in
 * `window.previewMessages`. A second loopback server is a stranger's origin. The golden preview
 * document is `contracts/fixtures/api/template-preview.json`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { startPageServer, type RunningPageServer } from './mock-flow-server';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

export interface PreviewDocument {
  data: { attributes: Record<string, unknown> & { steps: Record<string, unknown>[] } };
}

/** The golden preview document, changed by `change`. */
export function previewDocument(
  change: (attributes: PreviewDocument['data']['attributes']) => void = () => undefined,
): PreviewDocument {
  const document = JSON.parse(
    readFileSync(`${REPO_ROOT}contracts/fixtures/api/template-preview.json`, 'utf8'),
  ) as PreviewDocument;
  change(document.data.attributes);
  return document;
}

/** A page whose script posts `hostile` to the preview frame (`parent.frames[0]`) once loaded. */
const hostilePage = (hostile: unknown): string =>
  `<!doctype html><html lang="en"><head><title>Other</title></head><body><script>
    window.parent.frames[0].postMessage(${JSON.stringify(hostile)}, '*');
    window.posted = true;
  </script></body></html>`;

export interface ConsolePages {
  /** The console's origin, to start the flow server with. */
  readonly console: RunningPageServer;
  /** A stranger's origin. */
  readonly stranger: RunningPageServer;
  /** Sets the flow origin the console frames (known once the flow server started). */
  setFlowOrigin(origin: string): void;
  /** Sets what the hostile pages post (`null`: the console frames no hostile page). */
  setHostile(message: Record<string, unknown> | null): void;
  close(): Promise<void>;
}

/** Starts the console's and the stranger's page servers. */
export async function startConsolePages(): Promise<ConsolePages> {
  let flowOrigin = '';
  let hostile: Record<string, unknown> | null = null;
  let strangerOrigin = '';
  const html = 'text/html; charset=utf-8';
  const consolePage =
    () => `<!doctype html><html lang="en"><head><title>Console</title></head><body>
    <main><h1>Template preview</h1>
    <iframe title="Flow preview" src="${flowOrigin}/preview" sandbox="allow-scripts allow-same-origin" referrerpolicy="no-referrer" width="800" height="600"></iframe>
    ${hostile === null ? '' : `<iframe title="Sibling" src="/sibling"></iframe><iframe title="Stranger" src="${strangerOrigin}/stranger"></iframe>`}
    </main>
    <script src="/console.js"></script></body></html>`;
  const consoleScript = () => `window.previewMessages = [];
    var frame = document.querySelector('iframe[title="Flow preview"]');
    window.addEventListener('message', function (event) {
      if (event.origin === ${JSON.stringify(flowOrigin)} && event.source === frame.contentWindow) {
        window.previewMessages.push(event.data);
      }
    });`;
  const consoleServer = await startPageServer((path) => {
    if (path === '/') {
      return { type: html, body: consolePage() };
    }
    if (path === '/console.js') {
      return { type: 'text/javascript; charset=utf-8', body: consoleScript() };
    }
    return path === '/sibling' ? { type: html, body: hostilePage(hostile) } : null;
  });
  const stranger = await startPageServer((path) =>
    path === '/stranger' ? { type: html, body: hostilePage(hostile) } : null,
  );
  strangerOrigin = stranger.origin;
  return {
    console: consoleServer,
    stranger,
    setFlowOrigin: (origin) => {
      flowOrigin = origin;
    },
    setHostile: (message) => {
      hostile = message;
    },
    close: async () => {
      await consoleServer.close();
      await stranger.close();
    },
  };
}

/** Every message the preview posted to the console, in order. */
export function previewMessages(page: Page): Promise<Record<string, unknown>[]> {
  return page.evaluate(
    () => (window as unknown as { previewMessages: Record<string, unknown>[] }).previewMessages,
  );
}

/** Posts `message` from the console to the preview, with the flow origin as its target. */
export async function postToPreview(
  page: Page,
  flowOrigin: string,
  message: Record<string, unknown>,
): Promise<void> {
  await page.evaluate(
    ({ message, flowOrigin }) => {
      const frame = document.querySelector<HTMLIFrameElement>('iframe[title="Flow preview"]');
      frame?.contentWindow?.postMessage(
        { source: 'openverify-console', version: 1, ...message },
        flowOrigin,
      );
    },
    { message, flowOrigin },
  );
}

/** Posts `preview-assets` with each buffer transferred, as the console does. */
export async function postAssets(
  page: Page,
  flowOrigin: string,
  assets: readonly {
    readonly id: string;
    readonly kind: 'logo' | 'font';
    readonly bytes: number[];
  }[],
): Promise<void> {
  await page.evaluate(
    ({ assets, flowOrigin }) => {
      const frame = document.querySelector<HTMLIFrameElement>('iframe[title="Flow preview"]');
      const posted = assets.map((asset) => ({
        'asset-id': asset.id,
        kind: asset.kind,
        bytes: new Uint8Array(asset.bytes).buffer,
      }));
      frame?.contentWindow?.postMessage(
        { source: 'openverify-console', version: 1, type: 'preview-assets', assets: posted },
        flowOrigin,
        posted.map((asset) => asset.bytes),
      );
    },
    { assets, flowOrigin },
  );
}
