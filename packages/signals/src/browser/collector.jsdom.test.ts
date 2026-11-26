// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { flowSignalsSchema } from '@openverify/contracts';
import { startCollector } from './collector.js';

/**
 * C94.3, P14: the same guarantee as `collector.test.ts`, on a DOM implementation rather than a
 * fake: spies on `addEventListener` and on every probed API that jsdom has. Before the session may
 * collect, none is touched; after a declined recognition tick, no recognition API is.
 */
type Spy = MockInstance;

const NAVIGATOR_INTEGRITY = ['webdriver', 'userAgent', 'languages', 'plugins', 'mimeTypes'];
const NAVIGATOR_RECOGNITION = ['hardwareConcurrency', 'maxTouchPoints', 'deviceMemory'];
const SCREEN_RECOGNITION = ['width', 'height', 'colorDepth'];

function spyGetters(prototype: object, names: readonly string[]): Spy[] {
  return names
    .filter((name) => typeof Object.getOwnPropertyDescriptor(prototype, name)?.get === 'function')
    .map((name) => vi.spyOn(prototype as Record<string, unknown>, name, 'get'));
}

function spies() {
  const integrity = [
    vi.spyOn(window, 'addEventListener'),
    vi.spyOn(document, 'addEventListener'),
    vi.spyOn(document, 'hasFocus'),
    ...spyGetters(Navigator.prototype, NAVIGATOR_INTEGRITY),
    ...spyGetters(Document.prototype, ['visibilityState']),
  ];
  const recognition = [
    vi.spyOn(document, 'createElement'),
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext'),
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL'),
    ...spyGetters(Navigator.prototype, NAVIGATOR_RECOGNITION),
    ...spyGetters(Screen.prototype, SCREEN_RECOGNITION),
  ];
  return { integrity, recognition };
}

const called = (list: Spy[]) => list.filter((spy) => spy.mock.calls.length > 0).length;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the collector on a DOM, before and after consent (C94.3, P14)', () => {
  it('touches no probed API and adds no listener before the session reports its tiers', async () => {
    const { integrity, recognition } = spies();
    expect(integrity.length).toBeGreaterThanOrEqual(7);
    const collector = startCollector({ tiers: null, send: () => Promise.resolve() });
    collector.screen('personal-details');
    document.dispatchEvent(new Event('keydown'));
    await collector.flush();
    collector.stop();
    expect(called(integrity)).toBe(0);
    expect(called(recognition)).toBe(0);
  });

  it('after a declined recognition tick, reads integrity only', async () => {
    const { integrity, recognition } = spies();
    const bodies: unknown[] = [];
    const collector = startCollector({
      tiers: { integrity: true, recognition: false },
      send: (body) => {
        bodies.push(body);
      },
    });
    collector.screen('personal-details');
    document.dispatchEvent(new Event('keydown'));
    collector.screen('government-id');
    await collector.flush();
    collector.stop();
    expect(called(integrity)).toBeGreaterThan(0);
    expect(called(recognition)).toBe(0);
    expect(bodies).toHaveLength(2);
  });

  it('sends bodies that parse on a DOM without pdfViewerEnabled, as jsdom and older browsers are', async () => {
    expect('pdfViewerEnabled' in navigator).toBe(false);
    const bodies: unknown[] = [];
    const collector = startCollector({
      tiers: { integrity: true, recognition: false },
      send: (body) => {
        bodies.push(body);
      },
    });
    collector.screen('personal-details');
    await collector.flush();
    collector.stop();
    expect(bodies).toHaveLength(1);
    expect(flowSignalsSchema.safeParse(bodies[0]).error).toBeUndefined();
  });
});
