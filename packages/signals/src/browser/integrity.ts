/**
 * Session integrity (plan C94.3): the automation artefacts, after BotD's rules, re-implemented
 * with closed kinds and no property name ever sent; the low-entropy UA Client Hints, the IANA time
 * zone and at most five language tags, for the server's cross-layer checks. Every probe is guarded:
 * a probe that throws reads as "not seen", and never breaks the page.
 */
import { MAX_COUNT } from './constants.js';
import { probe } from './probe.js';
import type { BrowserWindow, DriverGlobalKind, IntegritySignals } from './types.js';

/**
 * C94.3: the page globals each automation driver leaves, on `window` and on `document`, after
 * BotD 2.0.0's rules (docs/research/phase7-client-signals.md §2.1, §2.2). The collector maps a name
 * it finds to its kind; the names never travel. Playwright and Puppeteer have no default rule: their
 * bindings are version-specific and renamed at will, and the research advises against relying on
 * them (§2.1); their kinds stay in the contract for a later collector version.
 */
export const DRIVER_GLOBALS: Readonly<
  Record<
    DriverGlobalKind,
    { readonly window: readonly string[]; readonly document: readonly string[] }
  >
> = Object.freeze({
  selenium: {
    window: ['_selenium', 'callSelenium', '_Selenium_IDE_Recorder'],
    document: ['__selenium_evaluate', '__selenium_unwrapped'],
  },
  'webdriver-script': {
    window: ['__webdriverFunc', '__webdriver_script_fn'],
    document: [
      '__webdriver_evaluate',
      '__webdriver_unwrapped',
      '__webdriver_script_fn',
      '__webdriver_script_func',
      '__driver_evaluate',
      '__driver_unwrapped',
      '__fxdriver_evaluate',
      '__fxdriver_unwrapped',
    ],
  },
  phantom: { window: ['callPhantom', '_phantom', 'phantom'], document: [] },
  nightmare: { window: ['__nightmare'], document: [] },
  'dom-automation': { window: ['domAutomation', 'domAutomationController'], document: [] },
  playwright: { window: [], document: [] },
  puppeteer: { window: [], document: [] },
  cypress: { window: ['Cypress'], document: [] },
});

/**
 * ChromeDriver's injected names: arrays such as `cdc_<random>_Array` on the window, and a
 * `$cdc_<random>_` marker on the document (BotD's patterns).
 */
export const DRIVER_GLOBAL_PATTERNS: readonly {
  readonly kind: DriverGlobalKind;
  readonly target: 'window' | 'document';
  readonly pattern: RegExp;
}[] = Object.freeze([
  {
    kind: 'selenium',
    target: 'window',
    pattern: /^[a-z]{3}_[A-Za-z\d]+_(?:Array|Promise|Symbol)$/,
  },
  { kind: 'webdriver-script', target: 'document', pattern: /^\$[a-z]dc_/ },
]);

/** BotD's headless user agents (§2.1). */
const HEADLESS_AGENT = /HeadlessChrome|PhantomJS|SlimerJS|Electron/;
/** contracts: a BCP 47 tag, an IANA zone name, a low-entropy brand version. */
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const LANGUAGE_TAG = /^[a-z]{2,3}(?:-[a-z\d]{2,8})*$/i;
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const TIME_ZONE = /^[a-z_]+(?:\/[\w+-]+){0,2}$/i;
const BRAND_VERSION = /^\d{1,8}$/;
const NATIVE = /\{\s*\[native code\]\s*\}\s*$/;

interface UserAgentData {
  readonly brands?: unknown;
  readonly mobile?: unknown;
  readonly platform?: unknown;
}

function clientHints(data: UserAgentData | null | undefined): IntegritySignals['client-hints'] {
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const brands = Array.isArray(data.brands)
    ? (data.brands as { brand?: unknown; version?: unknown }[])
    : [];
  return {
    brands: brands
      .filter(
        (item) =>
          typeof item.brand === 'string' &&
          item.brand !== '' &&
          typeof item.version === 'string' &&
          BRAND_VERSION.test(item.version),
      )
      .slice(0, 8)
      .map((item) => ({
        brand: (item.brand as string).slice(0, 64),
        version: item.version as string,
      })),
    mobile: data.mobile === true,
    platform: typeof data.platform === 'string' ? data.platform.slice(0, 32) : '',
  };
}

/** Reads the integrity artefacts now; `untrustedEvents` is the screen's count of scripted events. */
export function readIntegrity(win: BrowserWindow, untrustedEvents: number): IntegritySignals {
  const nav = win.navigator;
  const doc = win.document;
  const hints = probe(
    () => clientHints((nav as Navigator & { userAgentData?: UserAgentData }).userAgentData),
    null,
  );
  // Only an explicit true: browsers without the member (Firefox < 99, Safari < 16.4) have no viewer
  // to contradict, and the body's members are booleans, never undefined.
  const pdfViewer = probe(() => (nav.pdfViewerEnabled as unknown) === true, false);

  const driverGlobals = probe(() => {
    const windowNames = Object.getOwnPropertyNames(win);
    const documentNames = Object.getOwnPropertyNames(doc);
    return (Object.keys(DRIVER_GLOBALS) as DriverGlobalKind[]).filter(
      (kind) =>
        DRIVER_GLOBALS[kind].window.some((name) => name in win) ||
        DRIVER_GLOBALS[kind].document.some((name) => name in doc) ||
        DRIVER_GLOBAL_PATTERNS.some(
          (rule) =>
            rule.kind === kind &&
            (rule.target === 'window' ? windowNames : documentNames).some((name) =>
              rule.pattern.test(name),
            ),
        ),
    );
  }, []);

  return {
    webdriver: probe(() => (nav.webdriver as unknown) === true, false),
    'driver-globals': driverGlobals,
    'ua-headless-marker': probe(
      () =>
        HEADLESS_AGENT.test(nav.userAgent) ||
        (hints?.brands.some(({ brand }) => brand.includes('Headless')) ?? false),
      false,
    ),
    'zero-window-with-focus': probe(
      () => win.outerWidth === 0 && win.outerHeight === 0 && doc.hasFocus(),
      false,
    ),
    'plugins-inconsistent': probe(
      () => pdfViewer && (nav.plugins as ArrayLike<unknown>).length === 0,
      false,
    ),
    'mime-inconsistent': probe(
      () => pdfViewer && (nav.mimeTypes as ArrayLike<unknown>).length === 0,
      false,
    ),
    'native-function-tampered': probe(() => {
      // The realm's own Function.prototype, read as values: its toString is called with .call.
      const prototype = win.Function.prototype as unknown as {
        readonly toString: (this: unknown) => string;
        readonly bind: unknown;
      };
      const toString = prototype.toString;
      const native = (fn: unknown) => typeof fn !== 'function' || NATIVE.test(toString.call(fn));
      return (
        typeof prototype.bind !== 'function' ||
        !native(toString) ||
        !native(
          (
            Object.getOwnPropertyDescriptor(Object.getPrototypeOf(nav) as object, 'webdriver') as
              { readonly get?: unknown } | undefined
          )?.get,
        )
      );
    }, false),
    'untrusted-event-count': Math.min(MAX_COUNT, untrustedEvents),
    'client-hints': hints,
    timezone: probe(() => {
      const zone = win.Intl.DateTimeFormat().resolvedOptions().timeZone;
      return zone.length <= 64 && TIME_ZONE.test(zone) ? zone : null;
    }, null),
    languages: probe(
      () =>
        Array.isArray(nav.languages)
          ? nav.languages
              .filter(
                (tag: unknown): tag is string =>
                  typeof tag === 'string' && tag.length <= 35 && LANGUAGE_TAG.test(tag),
              )
              .slice(0, 5)
          : [],
      [],
    ),
  };
}
