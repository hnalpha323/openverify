import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIGNAL_COLLECTION,
  DRIVER_GLOBAL_KINDS,
  FLOW_SIGNALS_MAX_BODIES_PER_SESSION,
  FLOW_SIGNALS_MAX_BODY_BYTES,
  flowSessionSignalsSchema,
  flowSignalsSchema,
  resolveSignalConfig,
  signalCollectionSettingSchema,
  signalConfigSchema,
} from './flow-signals.js';

const integrity = {
  webdriver: false,
  'driver-globals': [],
  'ua-headless-marker': false,
  'zero-window-with-focus': false,
  'plugins-inconsistent': false,
  'mime-inconsistent': false,
  'native-function-tampered': false,
  'untrusted-event-count': 0,
  'client-hints': {
    brands: [{ brand: 'Chromium', version: '140' }],
    mobile: false,
    platform: 'Linux',
  },
  timezone: 'Etc/UTC',
  languages: ['en', 'es-419'],
};

const behaviour = {
  'paste-count': 0,
  'drop-count': 0,
  'autofill-count': 1,
  'correction-count': 3,
  'focus-loss-count': 0,
  'hidden-count': 0,
  'input-event-count': 24,
  'dwell-seconds': 41.5,
  'hidden-seconds': 0,
  'first-input-bucket': '1-5s',
  'typing-cadence': 'variable',
  'pointer-types': ['mouse'],
  'pointer-before-click': 'true',
};

const body = (overrides: Record<string, unknown> = {}) => ({
  platform: 'web',
  'collector-version': 1,
  screen: 'personal-details',
  sequence: 0,
  integrity,
  behaviour,
  ...overrides,
});

const ok = (value: unknown) => flowSignalsSchema.safeParse(value).success;

describe('POST /api/v1/flow/signals body (C94.2)', () => {
  it('takes integrity and behaviour aggregates of one screen', () => {
    expect(ok(body())).toBe(true);
    expect(FLOW_SIGNALS_MAX_BODIES_PER_SESSION).toBe(200);
    expect(FLOW_SIGNALS_MAX_BODY_BYTES).toBe(8192);
  });

  it('refuses unknown members, so raw keystrokes, coordinates or timings cannot pass', () => {
    expect(ok(body({ keystrokes: ['a', 'b'] }))).toBe(false);
    expect(ok(body({ behaviour: { ...behaviour, 'pointer-path': [[1, 2]] } }))).toBe(false);
    expect(
      ok(body({ integrity: { ...integrity, 'driver-globals': ['__webdriver_evaluate'] } })),
    ).toBe(false);
  });

  it('refuses a string over its bound and a count over its cap', () => {
    expect(ok(body({ integrity: { ...integrity, timezone: `Etc/${'x'.repeat(64)}` } }))).toBe(
      false,
    );
    expect(ok(body({ behaviour: { ...behaviour, 'paste-count': 10_001 } }))).toBe(false);
    expect(ok(body({ behaviour: { ...behaviour, 'dwell-seconds': 3601 } }))).toBe(false);
    expect(
      ok(body({ integrity: { ...integrity, languages: ['en', 'fr', 'de', 'it', 'es', 'pt'] } })),
    ).toBe(false);
  });

  it('names the driver kinds, never the page globals', () => {
    expect(DRIVER_GLOBAL_KINDS).toContain('selenium');
    expect(
      ok(body({ integrity: { ...integrity, webdriver: true, 'driver-globals': ['selenium'] } })),
    ).toBe(true);
  });

  it('takes recognition, the Android members and the sandbox outcome where each belongs', () => {
    const recognition = {
      screen: {
        'width-bucket': 1920,
        'height-bucket': 1080,
        'color-depth': 24,
        'pixel-ratio-bucket': 1,
      },
      'hardware-concurrency': 8,
      'device-memory': 8,
      'max-touch-points': 0,
      'canvas-digest': 'd'.repeat(64),
      'canvas-noise': false,
      'webgl-vendor': 'Example Vendor',
      'webgl-renderer': 'Example Renderer',
    };
    expect(ok(body({ recognition }))).toBe(true);
    const android = {
      platform: 'android',
      'collector-version': 1,
      screen: 'consent',
      sequence: 0,
      'android-integrity': { 'debugger-connected': false, 'app-debuggable': false },
      'android-recognition': { 'android-id': '0123456789abcdef' },
      'device-class': 'tablet',
    };
    expect(ok(android)).toBe(true);
    expect(ok({ ...android, recognition })).toBe(false);
    expect(ok(body({ 'android-recognition': { 'android-id': '0123456789abcdef' } }))).toBe(false);
    expect(ok(body({ 'device-class': 'smartphone' }))).toBe(false);
    expect(ok(body({ 'sandbox-outcome': 'bot' }))).toBe(true);
    expect(ok(body({ 'sandbox-outcome': 'maybe' }))).toBe(false);
  });

  it('tells the collector its next sequence, optional so earlier answers parse (K7A-7)', () => {
    const tiers = { integrity: true, recognition: false };

    expect(flowSessionSignalsSchema.parse({ ...tiers, 'next-sequence': 4 })).toEqual({
      ...tiers,
      'next-sequence': 4,
    });
    expect(flowSessionSignalsSchema.safeParse({ ...tiers, 'next-sequence': -1 }).success).toBe(
      false,
    );
  });

  it('reports the session tiers on GET /flow/session once consent is recorded (C94.6)', () => {
    expect(flowSessionSignalsSchema.parse({ integrity: true, recognition: false })).toEqual({
      integrity: true,
      recognition: false,
    });
  });
});

describe('signal-config (C90.6)', () => {
  it('collects the default set unless named, with on-signal off and no rules', () => {
    expect(resolveSignalConfig({})).toEqual({
      collect: 'default',
      'on-signal': 'none',
      'review-rules': [],
    });
  });

  it('takes unique names, on-signal and rules with exactly one comparison and on-null', () => {
    const config = {
      collect: ['inquiry/tor_detected', 'inquiry/bot_score'],
      'on-signal': 'needs_review',
      'review-rules': [
        { signal: 'inquiry/tor_detected', eq: true, 'on-null': 'needs_review' },
        { signal: 'inquiry/bot_score', gte: 70 },
      ],
    };
    expect(signalConfigSchema.parse(config)).toEqual(config);
    expect(
      signalConfigSchema.safeParse({ collect: ['inquiry/bot_score', 'inquiry/bot_score'] }).success,
    ).toBe(false);
    expect(
      signalConfigSchema.safeParse({
        'review-rules': [{ signal: 'inquiry/bot_score', gte: 70, lte: 90 }],
      }).success,
    ).toBe(false);
    expect(signalConfigSchema.safeParse({ 'on-signal': 'decline' }).success).toBe(false);
    expect(
      signalConfigSchema.safeParse({
        'review-rules': Array.from({ length: 21 }, () => ({ signal: 'inquiry/bot_score', gte: 1 })),
      }).success,
    ).toBe(false);
  });
});

describe('signal-collection (C90.8)', () => {
  it('defaults to session integrity on and device recognition off', () => {
    expect(DEFAULT_SIGNAL_COLLECTION).toEqual({
      'session-integrity': 'on',
      'device-recognition': 'off',
      'device-recognition-basis': null,
    });
  });

  it('needs a basis in exempt mode', () => {
    expect(
      signalCollectionSettingSchema.safeParse({
        'session-integrity': 'on',
        'device-recognition': 'exempt',
        'device-recognition-basis': null,
      }).success,
    ).toBe(false);
    expect(
      signalCollectionSettingSchema.safeParse({
        'session-integrity': 'on',
        'device-recognition': 'exempt',
        'device-recognition-basis': 'Fraud prevention under the documented assessment.',
      }).success,
    ).toBe(true);
  });
});
