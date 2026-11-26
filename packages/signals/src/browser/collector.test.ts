import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  flowBehaviourSignalsSchema,
  flowIntegritySignalsSchema,
  flowRecognitionSignalsSchema,
  flowSignalsSchema,
  SESSION_INTEGRITY_NOTICE_TEXT_KEY,
  DEVICE_RECOGNITION_CONSENT_TEXT_KEY,
  DEVICE_RECOGNITION_NOTICE_TEXT_KEY,
  type FlowSignals,
} from '@openverify/contracts';
import { startCollector, type CollectorOptions } from './collector.js';
import {
  fakeBrowser,
  fakeEvent,
  recording,
  type FakeBrowserOptions,
  type ReadLog,
} from './fake-browser.js';
import { BROWSER_API_READS, TIER_TEXT_KEYS, type CollectorTier } from './reads.js';
import type { CollectorTiers, WebSignalsBody } from './types.js';

const BOTH: CollectorTiers = { integrity: true, recognition: true };
const INTEGRITY: CollectorTiers = { integrity: true, recognition: false };
const RECOGNITION: CollectorTiers = { integrity: false, recognition: true };

/** A collector over a recorded fake browser; `bodies` holds what it sent, as JSON on the wire. */
function session(
  tiers: CollectorTiers | null,
  options: FakeBrowserOptions = {},
  extra: Partial<CollectorOptions> = {},
) {
  const fake = fakeBrowser({
    webgl: {
      vendor: 'WebKit',
      renderer: 'WebKit WebGL',
      unmaskedVendor: 'Example',
      unmaskedRenderer: 'Example GPU',
    },
    deviceMemory: 4,
    ...options,
  });
  const reads: ReadLog = [];
  const bodies: WebSignalsBody[] = [];
  const send = vi.fn((body: WebSignalsBody) => {
    bodies.push(JSON.parse(JSON.stringify(body)) as WebSignalsBody);
    return Promise.resolve();
  });
  const collector = startCollector({
    tiers,
    send,
    window: recording(fake.window, 'window', reads),
    ...extra,
  });
  return { fake, reads, bodies, send, collector };
}

/** A few seconds of ordinary use of one screen. */
function use(fake: ReturnType<typeof fakeBrowser>) {
  fake.advance(800);
  fake.dispatch('document', fakeEvent('pointermove', { pointerType: 'mouse' }));
  fake.dispatch('document', fakeEvent('pointerdown', { pointerType: 'mouse' }));
  fake.dispatch('document', fakeEvent('click', { detail: 1 }));
  for (let key = 0; key < 4; key += 1) {
    fake.advance(150 + key * 40);
    fake.dispatch('document', fakeEvent('keydown'));
    fake.dispatch('document', fakeEvent('input', { inputType: 'insertText' }));
  }
  fake.dispatch('document', fakeEvent('input', { inputType: 'insertFromPaste' }));
  fake.dispatch('window', fakeEvent('blur'));
  fake.advance(2_000);
}

const path = (read: string) => read.replace(/^window\./, '');
const registryEntry = (read: string) =>
  BROWSER_API_READS.find(({ api }) =>
    typeof api === 'string' ? api === path(read) : api.test(path(read)),
  );
/** The reads a session under `tier` alone made outside that tier, or with no entry at all. */
const outside = (reads: ReadLog, tier: CollectorTier) =>
  reads.filter((read) => !(registryEntry(read)?.tiers.includes(tier) ?? false));
/** The tiers whose own APIs (permitted under that tier alone) a session read. */
const tiersRead = (reads: ReadLog) =>
  new Set(
    reads.flatMap((read) => {
      const tiers = registryEntry(read)?.tiers ?? [];
      return tiers.length === 1 ? tiers : [];
    }),
  );

describe('nothing runs before the session may collect (C94.3, C94.6, P14)', () => {
  it('reads no browser API and attaches no listener while the tiers are unknown', async () => {
    const { fake, reads, send, collector } = session(null);
    collector.screen('consent');
    collector.screen('government-id');
    await collector.flush();
    collector.stop();
    expect(collector.collecting).toBe(false);
    expect(reads).toEqual([]);
    expect(fake.added).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it('reads nothing either when both tiers are off', async () => {
    const { fake, reads, send, collector } = session({ integrity: false, recognition: false });
    collector.screen('government-id');
    await collector.flush();
    expect(collector.collecting).toBe(false);
    expect(reads).toEqual([]);
    expect(fake.added).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it('after a declined recognition tick, reads no recognition API at all', async () => {
    const { fake, reads, bodies, collector } = session(INTEGRITY);
    collector.screen('personal-details');
    use(fake);
    collector.screen('government-id');
    await collector.flush();
    collector.stop();
    expect(bodies.some((body) => body.recognition !== undefined)).toBe(false);
    expect(reads.length).toBeGreaterThan(0);
    expect(outside(reads, 'session-integrity')).toEqual([]);
    expect(
      reads.filter((read) =>
        /screen|hardwareConcurrency|deviceMemory|maxTouchPoints|devicePixelRatio|createElement|crypto/.test(
          read,
        ),
      ),
    ).toEqual([]);
  });

  it('under recognition alone, attaches no listener and reads no integrity API', async () => {
    const { fake, reads, bodies, collector } = session(RECOGNITION);
    collector.screen('personal-details');
    use(fake);
    collector.screen('government-id');
    await collector.flush();
    expect(fake.added).toEqual([]);
    expect(outside(reads, 'device-recognition')).toEqual([]);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ screen: 'personal-details', sequence: 0 });
    expect(Object.keys(bodies[0] ?? {}).sort()).toEqual(
      ['collector-version', 'platform', 'recognition', 'screen', 'sequence'].sort(),
    );
  });
});

describe('the bodies the collector sends (C94.2-C94.4)', () => {
  it('sends the recognition body at the first screen, then one body per screen as it closes', async () => {
    const { fake, bodies, collector } = session(BOTH);
    expect(collector.collecting).toBe(true);
    collector.screen('personal-details');
    use(fake);
    collector.screen('government-id');
    fake.advance(3_000);
    fake.dispatch('document', fakeEvent('keydown', { isTrusted: false }));
    await collector.flush();

    // The recognition body takes its sequence when the first screen opens, and is sent once its
    // digest is computed; the server orders nothing by arrival, so neither does this test.
    const ordered = [...bodies].sort((a, b) => a.sequence - b.sequence);
    expect(ordered.map(({ screen, sequence }) => [screen, sequence])).toEqual([
      ['personal-details', 0],
      ['personal-details', 1],
      ['government-id', 2],
    ]);
    const [recognitionBody, first, second] = ordered;
    expect(recognitionBody?.recognition).toBeDefined();
    expect(recognitionBody?.integrity).toBeUndefined();
    expect(first?.recognition).toBeUndefined();
    expect(first?.behaviour).toMatchObject({
      'paste-count': 1,
      'focus-loss-count': 1,
      'pointer-types': ['mouse'],
      'pointer-before-click': 'true',
      'first-input-bucket': '0.25-1s',
    });
    expect(first?.integrity?.['untrusted-event-count']).toBe(0);
    expect(second?.integrity?.['untrusted-event-count']).toBe(1);
    expect(second?.behaviour?.['dwell-seconds']).toBe(3);
    for (const body of bodies) {
      expect(body.platform).toBe('web');
      expect(body['collector-version']).toBe(1);
    }
  });

  it('builds bodies that parse with flowSignalsSchema, with exactly the schema keys', async () => {
    const { fake, bodies, collector } = session(BOTH, {
      userAgentData: {
        brands: [{ brand: 'Chromium', version: '140' }],
        mobile: false,
        platform: 'Linux',
      },
    });
    collector.screen('personal-details');
    use(fake);
    await collector.flush();
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(flowSignalsSchema.safeParse(body).error).toBeUndefined();
    }
    const integrity = bodies.find((body) => body.integrity)?.integrity ?? {};
    const behaviour = bodies.find((body) => body.behaviour)?.behaviour ?? {};
    const recognition = bodies.find((body) => body.recognition)?.recognition ?? {};
    expect(Object.keys(integrity).sort()).toEqual(
      Object.keys(flowIntegritySignalsSchema.shape).sort(),
    );
    expect(Object.keys(behaviour).sort()).toEqual(
      Object.keys(flowBehaviourSignalsSchema.shape).sort(),
    );
    expect(Object.keys(recognition).sort()).toEqual(
      Object.keys(flowRecognitionSignalsSchema.shape).sort(),
    );
    expectTypeOf<WebSignalsBody>().toExtend<FlowSignals>();
  });

  it('starts at the given sequence and ignores a repeated screen', async () => {
    const { fake, bodies, collector } = session(INTEGRITY, {}, { firstSequence: 40 });
    collector.screen('selfie');
    fake.advance(1_000);
    collector.screen('selfie');
    fake.advance(1_000);
    collector.screen('review');
    await collector.flush();
    expect(bodies.map(({ screen, sequence }) => [screen, sequence])).toEqual([
      ['selfie', 40],
      ['review', 41],
    ]);
    expect(bodies[0]?.behaviour?.['dwell-seconds']).toBe(2);
  });

  it('keeps the recognition components until a send of them succeeds', async () => {
    const fake = fakeBrowser();
    const bodies: WebSignalsBody[] = [];
    let failures = 1;
    const send = vi.fn((body: WebSignalsBody) => {
      if (body.recognition !== undefined && failures > 0) {
        failures -= 1;
        return Promise.reject(new Error('offline'));
      }
      bodies.push(body);
      return Promise.resolve();
    });
    const collector = startCollector({ tiers: BOTH, send, window: fake.window });
    collector.screen('personal-details');
    await collector.flush();
    collector.screen('government-id');
    await collector.flush();
    collector.screen('selfie');
    await collector.flush();
    // The recognition body failed after the first screen's body was built; the next body built
    // carried the components, and none after it did.
    expect(bodies.map((body) => [body.sequence, body.recognition !== undefined])).toEqual([
      [1, false],
      [2, true],
      [3, false],
    ]);
    expect(bodies[1]?.behaviour).toBeDefined();
  });

  it('under recognition alone, sends failed components again at the next screen, and only then', async () => {
    const fake = fakeBrowser();
    const sent: [string, number][] = [];
    let failures = 1;
    const send = vi.fn((body: WebSignalsBody) => {
      if (failures > 0) {
        failures -= 1;
        return Promise.reject(new Error('offline'));
      }
      sent.push([body.screen, body.sequence]);
      return Promise.resolve();
    });
    const collector = startCollector({ tiers: RECOGNITION, send, window: fake.window });
    collector.screen('personal-details');
    await collector.flush();
    collector.screen('government-id');
    await collector.flush();
    collector.screen('selfie');
    await collector.flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(sent).toEqual([['government-id', 1]]);
  });

  it('swallows a send that throws, and keeps collecting', async () => {
    const fake = fakeBrowser();
    const send = vi.fn(() => {
      throw new Error('send failed');
    });
    const collector = startCollector({ tiers: INTEGRITY, send, window: fake.window });
    collector.screen('personal-details');
    expect(() => {
      collector.screen('government-id');
    }).not.toThrow();
    await expect(collector.flush()).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('flushes nothing with no open screen, and settles once every body sent has', async () => {
    let release: () => void = () => undefined;
    const fake = fakeBrowser();
    const sent: string[] = [];
    const send = vi.fn(
      (body: WebSignalsBody) =>
        new Promise<void>((resolve) => {
          release = () => {
            sent.push(body.screen);
            resolve();
          };
        }),
    );
    const collector = startCollector({ tiers: INTEGRITY, send, window: fake.window });
    await collector.flush();
    expect(send).not.toHaveBeenCalled();
    collector.screen('personal-details');
    const flushed = collector.flush();
    let settled = false;
    void flushed.then(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await flushed;
    expect(sent).toEqual(['personal-details']);
    // A flush closes the screen: events until the next screen belong to none.
    fake.dispatch('document', fakeEvent('keydown'));
    await collector.flush();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sends the open screen and removes every listener on stop, once', async () => {
    const { fake, bodies, collector } = session(INTEGRITY);
    collector.screen('personal-details');
    expect(fake.listenerCount()).toBeGreaterThan(0);
    use(fake);
    collector.stop();
    collector.stop();
    collector.screen('government-id');
    await collector.flush();
    expect(fake.listenerCount()).toBe(0);
    expect(bodies.map((body) => body.screen)).toEqual(['personal-details']);
  });

  it('listens in the capture phase, passively, so it never delays or blocks the page', () => {
    const { fake, collector } = session(INTEGRITY);
    collector.screen('personal-details');
    const types = fake.added.map(({ target, type }) => `${target}:${type}`).sort();
    // The window's own blur only: in the capture phase every field's blur would pass the window.
    expect(
      fake.added.map(
        ({ target, options }) =>
          JSON.stringify(options) ===
          (target === 'window' ? '{"passive":true}' : '{"capture":true,"passive":true}'),
      ),
    ).not.toContain(false);
    expect(types).toEqual(
      [
        'document:click',
        'document:input',
        'document:keydown',
        'document:pointerdown',
        'document:pointermove',
        'document:visibilitychange',
        'window:blur',
      ].sort(),
    );
    collector.stop();
  });
});

describe('what the collector reads from an event (C94.3: never keys, values or coordinates)', () => {
  it('reads only the event facts the aggregates need', async () => {
    const { fake, collector } = session(INTEGRITY);
    const eventReads: ReadLog = [];
    const send = (type: string, facts: Record<string, unknown>) => {
      const target = recording(
        { matches: () => true, value: 'secret', name: 'given-name' },
        'target',
        eventReads,
      );
      fake.dispatch(
        'document',
        recording(
          fakeEvent(type, {
            key: 'a',
            code: 'KeyA',
            keyCode: 65,
            which: 65,
            data: 'a',
            clientX: 10,
            clientY: 20,
            screenX: 30,
            pageX: 40,
            clipboardData: { getData: () => 'secret' },
            dataTransfer: { getData: () => 'secret' },
            target,
            ...facts,
          }),
          'event',
          eventReads,
        ),
      );
    };
    collector.screen('personal-details');
    send('keydown', { repeat: false });
    send('input', { inputType: 'insertText' });
    send('pointerdown', { pointerType: 'touch' });
    send('pointermove', { pointerType: 'touch' });
    send('click', { detail: 1 });
    await collector.flush();
    const allowed = new Set([
      'event.type',
      'event.isTrusted',
      'event.inputType',
      'event.pointerType',
      'event.repeat',
      'event.detail',
      'event.target',
      'target.matches',
      'target.matches()',
      'event.target.matches',
      'event.target.matches()',
    ]);
    expect(eventReads.filter((read) => !allowed.has(read))).toEqual([]);
    expect(eventReads).toContain('event.isTrusted');
  });
});

describe('the API-read registry (C94.3, C94.6)', () => {
  it('has an entry, a tier and a text key for every browser API a whole session reads', async () => {
    const { fake, reads, collector } = session(BOTH, {
      userAgentData: {
        brands: [{ brand: 'Chromium', version: '140' }],
        mobile: false,
        platform: 'Linux',
      },
    });
    collector.screen('personal-details');
    use(fake);
    fake.setHidden(true);
    fake.advance(500);
    fake.setHidden(false);
    collector.screen('government-id');
    await collector.flush();
    collector.stop();
    expect(reads.filter((read) => registryEntry(read) === undefined)).toEqual([]);
    expect(tiersRead(reads)).toEqual(new Set(['session-integrity', 'device-recognition']));
  });

  it('names the notice and consent keys of each tier', () => {
    expect(TIER_TEXT_KEYS).toEqual({
      'session-integrity': [SESSION_INTEGRITY_NOTICE_TEXT_KEY],
      'device-recognition': [
        DEVICE_RECOGNITION_CONSENT_TEXT_KEY,
        DEVICE_RECOGNITION_NOTICE_TEXT_KEY,
      ],
    });
    const tiers = new Set<CollectorTier>(BROWSER_API_READS.flatMap((entry) => entry.tiers));
    expect(tiers).toEqual(new Set(['session-integrity', 'device-recognition']));
    for (const entry of BROWSER_API_READS) {
      expect(entry.purpose.length).toBeGreaterThan(0);
    }
  });
});
