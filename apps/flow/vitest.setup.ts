import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// waitFor and findBy* poll until their condition holds. Their default 1 s is a wall-clock limit,
// and with every package testing at once a screen that settles in 0.2 s alone has taken over 1 s,
// so the wait must not measure the machine. A condition that never holds still fails, 10 s later.
configure({ asyncUtilTimeout: 10_000 });

// Build-time code (the Vite plugins) is tested in the node environment, without a DOM.
const hasDom = typeof window !== 'undefined';

// Vitest runs without injected globals, so Testing Library cannot register its own cleanup.
afterEach(() => {
  if (hasDom) {
    cleanup();
    window.sessionStorage.clear();
  }
});

// jsdom implements neither object URLs (photo previews) nor media playback (camera preview).
if (hasDom) {
  let objectUrls = 0;
  URL.createObjectURL = () => {
    objectUrls += 1;
    return `blob:openverify-test/${String(objectUrls)}`;
  };
  URL.revokeObjectURL = () => undefined;
  HTMLMediaElement.prototype.play = () => Promise.resolve();
  HTMLMediaElement.prototype.pause = () => undefined;
}
