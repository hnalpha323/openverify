/**
 * C156.2, C156.3 (Workflow 9A, `flow-server-embed`): starts the preview in `document` (`#root`), with
 * the console origin the flow server wrote into it, the window as its message host and the browser's
 * own `blob:` URLs and `FontFace` for posted assets.
 */
import { createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { browserAssetDeps } from './assets';
import { consoleOriginOf } from './console-origin';
import { PreviewApp } from './preview-app';

export function startPreview(document: Document): void {
  const container = document.getElementById('root');
  const window = document.defaultView;
  if (container === null || window === null) {
    return;
  }
  createRoot(container).render(
    createElement(
      StrictMode,
      null,
      createElement(PreviewApp, {
        consoleOrigin: consoleOriginOf(document),
        host: window,
        assetDeps: browserAssetDeps(document),
        root: document.documentElement,
      }),
    ),
  );
}
