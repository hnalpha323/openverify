/**
 * The shapes the browser collector sends (plan C94.2-C94.4). They mirror `flowSignalsSchema` of
 * `@openverify/contracts` member for member; the collector does not import the contract (zod would
 * not fit the 4,096 B budget), so `collector.test.ts` asserts that every body it builds parses
 * with the schema and that its keys equal the schema's keys.
 */

/** C94.3: the automation drivers whose page globals the collector recognises (contracts `DRIVER_GLOBAL_KINDS`). */
export type DriverGlobalKind =
  | 'selenium'
  | 'webdriver-script'
  | 'phantom'
  | 'nightmare'
  | 'dom-automation'
  | 'playwright'
  | 'puppeteer'
  | 'cypress';

export type FirstInputBucket = '<0.25s' | '0.25-1s' | '1-5s' | '>5s' | 'none';
export type TypingCadence = 'uniform' | 'variable' | 'insufficient';
export type PointerType = 'mouse' | 'pen' | 'touch';
export type PointerBeforeClick = 'true' | 'false' | 'n/a';

/** C94.3 (V13): the low-entropy UA Client Hints. */
export interface ClientHints {
  brands: { brand: string; version: string }[];
  mobile: boolean;
  platform: string;
}

/** C94.3: the `integrity` member (session integrity). */
export interface IntegritySignals {
  webdriver: boolean;
  'driver-globals': DriverGlobalKind[];
  'ua-headless-marker': boolean;
  'zero-window-with-focus': boolean;
  'plugins-inconsistent': boolean;
  'mime-inconsistent': boolean;
  'native-function-tampered': boolean;
  'untrusted-event-count': number;
  'client-hints': ClientHints | null;
  timezone: string | null;
  languages: string[];
}

/** C94.3: the `behaviour` member: one screen's aggregates. Never keys, timings per key or coordinates. */
export interface BehaviourSignals {
  'paste-count': number;
  'drop-count': number;
  'autofill-count': number;
  'correction-count': number;
  'focus-loss-count': number;
  'hidden-count': number;
  'input-event-count': number;
  'dwell-seconds': number;
  'hidden-seconds': number;
  'first-input-bucket': FirstInputBucket;
  'typing-cadence': TypingCadence;
  'pointer-types': PointerType[];
  'pointer-before-click': PointerBeforeClick;
}

/** C94.4: the `recognition` member (device recognition, only under its tier). */
export interface RecognitionSignals {
  screen: {
    'width-bucket': number;
    'height-bucket': number;
    'color-depth': number;
    'pixel-ratio-bucket': number;
  } | null;
  'hardware-concurrency': number | null;
  'device-memory': number | null;
  'max-touch-points': number | null;
  'canvas-digest': string | null;
  'canvas-noise': boolean;
  'webgl-vendor': string | null;
  'webgl-renderer': string | null;
}

/** C94.2: one web body of `POST /api/v1/flow/signals`. */
export interface WebSignalsBody {
  platform: 'web';
  'collector-version': number;
  /** The flow-spec step id the body describes. */
  screen: string;
  sequence: number;
  integrity?: IntegritySignals;
  behaviour?: BehaviourSignals;
  recognition?: RecognitionSignals;
}

/** C94.6: the collector tiers `GET /api/v1/flow/session` reports once the session may collect. */
export interface CollectorTiers {
  readonly integrity: boolean;
  readonly recognition: boolean;
}

/**
 * The browser globals the collector reads, always through the window it is given (so a test can
 * hand it a recording fake). In a page it is `window`.
 */
export type BrowserWindow = Window & typeof globalThis;
