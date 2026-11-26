/**
 * The registry of every browser API the collector reads (plan C94.3, C94.6; rule "no browser API
 * is read without a registry entry and a consent or notice key"). Each entry names the API as a
 * path from `window`, the collection tiers that permit the read, and what it is for; each tier's
 * text keys tell the person (`notice.session-integrity`, or `consent.device-recognition` and
 * `notice.device-recognition` for device recognition). `collector.test.ts` records every read a
 * whole session makes, and fails on one without an entry here or one made outside its tier.
 *
 * Kept out of the browser entry, so it costs the flow's bundle nothing.
 */
import { DRIVER_GLOBALS } from './integrity.js';

/** The two collector tiers (core `COLLECTOR_TIERS`). */
export type CollectorTier = 'session-integrity' | 'device-recognition';

export interface BrowserApiRead {
  /** The API as a path from `window` (`navigator.webdriver`; `name?` is an `in` check, `*` a key
   * listing, `()` a call), or a pattern of such paths. */
  readonly api: string | RegExp;
  /** The tiers under which the collector may read it. */
  readonly tiers: readonly CollectorTier[];
  /** What the read is for. */
  readonly purpose: string;
}

/** The text keys of each tier (contracts `SESSION_INTEGRITY_NOTICE_TEXT_KEY`, ...). */
export const TIER_TEXT_KEYS: Readonly<Record<CollectorTier, readonly string[]>> = Object.freeze({
  'session-integrity': ['notice.session-integrity'],
  'device-recognition': ['consent.device-recognition', 'notice.device-recognition'],
});

const INTEGRITY: readonly CollectorTier[] = ['session-integrity'];
const RECOGNITION: readonly CollectorTier[] = ['device-recognition'];

const integrity = (purpose: string, ...apis: (string | RegExp)[]): BrowserApiRead[] =>
  apis.map((api) => ({ api, tiers: INTEGRITY, purpose }));
const recognition = (purpose: string, ...apis: (string | RegExp)[]): BrowserApiRead[] =>
  apis.map((api) => ({ api, tiers: RECOGNITION, purpose }));

const driverGlobalChecks = Object.values(DRIVER_GLOBALS).flatMap((names) => [
  ...names.window.map((name) => `${name}?`),
  ...names.document.map((name) => `document.${name}?`),
]);

export const BROWSER_API_READS: readonly BrowserApiRead[] = Object.freeze([
  {
    api: /^(?:document|navigator)$/,
    tiers: [...INTEGRITY, ...RECOGNITION],
    purpose: 'the objects the reads below go through; reading one reads no value',
  },
  ...integrity(
    'listening for the behaviour events of C94.3 (counts and classes only)',
    /^(?:document\.)?(?:add|remove)EventListener(?:\(\))?$/,
  ),
  ...integrity(
    'screen timings: dwell, hidden time, first-input delay and typing cadence',
    // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
    /^performance(?:\.now(?:\(\))?)?$/,
    'document.visibilityState',
  ),
  ...integrity('the webdriver flag', 'navigator.webdriver'),
  ...integrity(
    'driver globals (closed kinds only; names never travel)',
    ...driverGlobalChecks,
    '*',
    'document.*',
  ),
  ...integrity(
    'headless markers and the low-entropy client hints',
    'navigator.userAgent',
    /^navigator\.userAgentData(?:\.(?:brands|mobile|platform))?$/,
  ),
  ...integrity(
    'a zero-sized window that has focus',
    'outerWidth',
    'outerHeight',
    /^document\.hasFocus(?:\(\))?$/,
  ),
  ...integrity(
    'plugin and MIME lists against the PDF viewer flag',
    'navigator.pdfViewerEnabled',
    /^navigator\.(?:plugins|mimeTypes)(?:\.length)?$/,
  ),
  ...integrity(
    'native functions rewritten in script',
    'Function',
    'Function.prototype',
    'navigator.__proto__',
  ),
  ...integrity(
    'the IANA time zone',
    // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
    /^Intl(?:\.DateTimeFormat(?:\(\)(?:\.resolvedOptions(?:\(\)(?:\.timeZone)?)?)?)?)?$/,
  ),
  ...integrity('at most five language tags', 'navigator.languages'),
  ...recognition(
    'the bucketed screen',
    /^screen(?:\.(?:width|height|colorDepth))?$/,
    'devicePixelRatio',
  ),
  ...recognition(
    'hardware hints',
    'navigator.hardwareConcurrency',
    'navigator.deviceMemory',
    'navigator.maxTouchPoints',
  ),
  ...recognition(
    'the fixed canvas drawing, its two readbacks, and the WebGL vendor and renderer',
    // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
    /^document\.createElement(?:\(\)(?:\.(?:getContext|toDataURL)\b.*)?)?$/,
  ),
  ...recognition(
    'the SHA-256 of the canvas readback, computed in the browser',
    // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
    /^crypto(?:\.subtle(?:\.digest(?:\(\))?)?)?$/,
  ),
]);
