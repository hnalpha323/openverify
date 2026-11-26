import {
  flowBehaviourSignalsSchema,
  flowIntegritySignalsSchema,
  flowSignalsSchema,
  type FlowSignals,
} from '@openverify/contracts';
import { COLLECTOR_VERSION } from '@openverify/core';
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { startSignalCollection, type SignalCollectionOptions } from './collector';

/**
 * C94.2-C94.4, C94.6 (P14): the flow's signal hook runs the browser collector of
 * `@openverify/signals/browser` for one session. With `tiers: null` it reads, listens to and sends
 * nothing; under session integrity it sends one body per screen when the screen closes (the next
 * screen, or `stop`); under device recognition alone it sends the components in their own body.
 * Every body is a valid `POST /api/v1/flow/signals` body.
 */
type Spy = MockInstance;

const NAVIGATOR_INTEGRITY = ['webdriver', 'userAgent', 'languages', 'plugins', 'mimeTypes'];
const NAVIGATOR_RECOGNITION = ['hardwareConcurrency', 'maxTouchPoints', 'deviceMemory'];
const SCREEN_RECOGNITION = ['width', 'height', 'colorDepth'];

/** The document events the collector listens to, and the window's own `blur`. */
const COLLECTOR_EVENTS = new Set([
  'keydown',
  'input',
  'pointerdown',
  'pointermove',
  'click',
  'visibilitychange',
  'blur',
]);

function spyGetters(prototype: object, names: readonly string[]): Spy[] {
  return names
    .filter((name) => typeof Object.getOwnPropertyDescriptor(prototype, name)?.get === 'function')
    .map((name) => vi.spyOn(prototype as Record<string, unknown>, name, 'get'));
}

function spies() {
  const listeners = [vi.spyOn(window, 'addEventListener'), vi.spyOn(document, 'addEventListener')];
  const integrity = [
    vi.spyOn(document, 'hasFocus'),
    ...spyGetters(Navigator.prototype, NAVIGATOR_INTEGRITY),
    ...spyGetters(Document.prototype, ['visibilityState']),
  ];
  const recognition = [
    vi.spyOn(document, 'createElement'),
    // jsdom has no 2D context; the collector then sends no digest (C94.4).
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null),
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL'),
    ...spyGetters(Navigator.prototype, NAVIGATOR_RECOGNITION),
    ...spyGetters(Screen.prototype, SCREEN_RECOGNITION),
  ];
  return { listeners, integrity, recognition };
}

const called = (list: Spy[]) => list.filter((spy) => spy.mock.calls.length > 0).length;

/** The collector's own listeners among the recorded `addEventListener` calls. */
function collectorListeners(list: Spy[]): string[] {
  return list
    .flatMap((spy) => spy.mock.calls)
    .map(([type]) => String(type))
    .filter((type) => COLLECTOR_EVENTS.has(type));
}

function recorder() {
  const bodies: FlowSignals[] = [];
  const send = vi.fn<SignalCollectionOptions['send']>((body) => {
    bodies.push(body);
    return Promise.resolve();
  });
  return { bodies, send };
}

const keysOf = (value: object) => Object.keys(value).sort();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('startSignalCollection: before the session may collect (P14)', () => {
  it('reads, listens to and sends nothing with tiers null', async () => {
    const { listeners, integrity, recognition } = spies();
    const { send } = recorder();
    const collection = startSignalCollection({ tiers: null, send, platform: 'web' });
    collection.screen('government_id');
    document.dispatchEvent(new Event('keydown'));
    collection.screen('selfie');
    collection.stop();
    await Promise.resolve();

    expect(collection.collecting).toBe(false);
    expect(collectorListeners(listeners)).toEqual([]);
    expect(called(integrity)).toBe(0);
    expect(called(recognition)).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('reads and sends nothing when both tiers are off', async () => {
    const { listeners, integrity, recognition } = spies();
    const { send } = recorder();
    const collection = startSignalCollection({
      tiers: { integrity: false, recognition: false },
      send,
      platform: 'web',
    });
    collection.screen('government_id');
    collection.stop();
    await Promise.resolve();

    expect(collection.collecting).toBe(false);
    expect(collectorListeners(listeners)).toEqual([]);
    expect(called(integrity) + called(recognition)).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('startSignalCollection: session integrity (C94.3)', () => {
  it('sends one valid body per screen when it closes, with the integrity artefacts and the aggregates', async () => {
    const { send, bodies } = recorder();
    const collection = startSignalCollection({
      tiers: { integrity: true, recognition: false },
      send,
      platform: 'web',
    });
    expect(collection.collecting).toBe(true);

    collection.screen('government_id');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    collection.screen('selfie');
    await vi.waitFor(() => {
      expect(bodies).toHaveLength(1);
    });

    const [body] = bodies;
    expect(flowSignalsSchema.parse(body)).toEqual(body);
    expect(body).toMatchObject({
      platform: 'web',
      'collector-version': COLLECTOR_VERSION,
      screen: 'government_id',
      sequence: 0,
    });
    // The collector's keys are the schema's keys (C94.2).
    expect(keysOf(body?.integrity ?? {})).toEqual(keysOf(flowIntegritySignalsSchema.shape));
    expect(keysOf(body?.behaviour ?? {})).toEqual(keysOf(flowBehaviourSignalsSchema.shape));
    expect(body?.recognition).toBeUndefined();
    // jsdom's own `dispatchEvent` is a scripted event: counted, never trusted.
    expect(body?.integrity?.['untrusted-event-count']).toBe(1);

    collection.stop();
  });

  it('sends the open screen when stopped, removes its listeners, and ignores later screens', async () => {
    const removed = [
      vi.spyOn(window, 'removeEventListener'),
      vi.spyOn(document, 'removeEventListener'),
    ];
    const { send, bodies } = recorder();
    const collection = startSignalCollection({
      tiers: { integrity: true, recognition: false },
      send,
      platform: 'web',
    });
    collection.screen('government_id');
    collection.stop();
    collection.stop();
    collection.screen('selfie');
    await vi.waitFor(() => {
      expect(bodies).toHaveLength(1);
    });

    expect(bodies.map((body) => [body.screen, body.sequence])).toEqual([['government_id', 0]]);
    expect(collectorListeners(removed).sort()).toEqual([...COLLECTOR_EVENTS].sort());
  });

  it('never reads a recognition API after a declined recognition tick', async () => {
    const { integrity, recognition } = spies();
    const { send, bodies } = recorder();
    const collection = startSignalCollection({
      tiers: { integrity: true, recognition: false },
      send,
      platform: 'web',
    });
    collection.screen('government_id');
    collection.screen('selfie');
    collection.stop();
    await vi.waitFor(() => {
      expect(bodies).toHaveLength(2);
    });

    expect(called(integrity)).toBeGreaterThan(0);
    expect(called(recognition)).toBe(0);
    expect(bodies.every((body) => body.recognition === undefined)).toBe(true);
  });

  it('swallows a failed send: the person never sees it, and later screens still send', async () => {
    const bodies: FlowSignals[] = [];
    const send = vi
      .fn<SignalCollectionOptions['send']>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation((body) => {
        bodies.push(body);
        return Promise.resolve();
      });
    const collection = startSignalCollection({
      tiers: { integrity: true, recognition: false },
      send,
      platform: 'web',
    });
    collection.screen('government_id');
    collection.screen('selfie');
    collection.screen('completion');
    collection.stop();
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledTimes(3);
    });

    expect(bodies.map((body) => body.screen)).toEqual(['selfie', 'completion']);
  });
});

describe('startSignalCollection: device recognition (C94.4)', () => {
  it('under recognition alone, sends the components once, in their own valid body', async () => {
    const { listeners } = spies();
    const { send, bodies } = recorder();
    const collection = startSignalCollection({
      tiers: { integrity: false, recognition: true },
      send,
      platform: 'web',
    });
    collection.screen('government_id');
    collection.screen('selfie');
    await vi.waitFor(() => {
      expect(bodies).toHaveLength(1);
    });
    collection.stop();

    const [body] = bodies;
    expect(flowSignalsSchema.parse(body)).toEqual(body);
    expect(body?.screen).toBe('government_id');
    expect(body?.integrity).toBeUndefined();
    expect(body?.behaviour).toBeUndefined();
    // No 2D context: no digest, never a guessed one.
    expect(body?.recognition?.['canvas-digest']).toBeNull();
    expect(collectorListeners(listeners)).toEqual([]);
  });
});
