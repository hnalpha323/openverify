import { describe, expect, it } from 'vitest';
import { DRIVER_GLOBAL_KINDS } from '@openverify/contracts';
import { fakeBrowser, type FakeBrowserOptions } from './fake-browser.js';
import { DRIVER_GLOBALS, readIntegrity } from './integrity.js';

const read = (options: FakeBrowserOptions = {}, untrusted = 0) =>
  readIntegrity(fakeBrowser(options).window, untrusted);

const CHROME_HINTS = {
  brands: [
    { brand: 'Chromium', version: '140' },
    { brand: 'Not=A?Brand', version: '24' },
  ],
  mobile: false,
  platform: 'Linux',
};

describe('session integrity artefacts (C94.3)', () => {
  it('reads a clean browser as no artefact, with its hints, time zone and languages', () => {
    expect(read({ userAgentData: CHROME_HINTS, languages: ['en-US', 'en'] }, 0)).toEqual({
      webdriver: false,
      'driver-globals': [],
      'ua-headless-marker': false,
      'zero-window-with-focus': false,
      'plugins-inconsistent': false,
      'mime-inconsistent': false,
      'native-function-tampered': false,
      'untrusted-event-count': 0,
      'client-hints': CHROME_HINTS,
      timezone: 'Etc/UTC',
      languages: ['en-US', 'en'],
    });
  });

  it('reads navigator.webdriver only when it is exactly true', () => {
    expect(read({ webdriver: true }).webdriver).toBe(true);
    expect(read({ webdriver: false }).webdriver).toBe(false);
  });

  it('maps the drivers page globals to their closed kinds, never sending a name', () => {
    expect(read({ windowGlobals: ['_selenium'] })['driver-globals']).toEqual(['selenium']);
    expect(read({ documentGlobals: ['__webdriver_evaluate'] })['driver-globals']).toEqual([
      'webdriver-script',
    ]);
    expect(read({ windowGlobals: ['callPhantom', '__nightmare'] })['driver-globals']).toEqual([
      'phantom',
      'nightmare',
    ]);
    expect(read({ windowGlobals: ['domAutomation', 'Cypress'] })['driver-globals']).toEqual([
      'dom-automation',
      'cypress',
    ]);
    // ChromeDriver's injected arrays on the window, and its marker on the document.
    expect(read({ windowGlobals: ['cdc_adoQpoasnfa76pfcZLmcfl_Array'] })['driver-globals']).toEqual(
      ['selenium'],
    );
    expect(read({ documentGlobals: ['$cdc_asdjflasutopfhvcZLmcfl_'] })['driver-globals']).toEqual([
      'webdriver-script',
    ]);
    // Two names of one driver give the kind once.
    expect(
      read({
        windowGlobals: ['_selenium', 'callSelenium'],
        documentGlobals: ['__selenium_evaluate'],
      })['driver-globals'],
    ).toEqual(['selenium']);
    // An ordinary page global is nothing.
    expect(read({ windowGlobals: ['dataLayer', 'abc_def'] })['driver-globals']).toEqual([]);
  });

  it('keeps one table entry per contract kind, in the contract order', () => {
    expect(Object.keys(DRIVER_GLOBALS)).toEqual([...DRIVER_GLOBAL_KINDS]);
  });

  it('finds a headless marker in the user agent or the client hints brands', () => {
    expect(
      read({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/140.0.0.0 Safari/537.36' })[
        'ua-headless-marker'
      ],
    ).toBe(true);
    expect(
      read({ userAgent: 'Mozilla/5.0 (Unknown; Linux x86_64) PhantomJS/2.1.1' })[
        'ua-headless-marker'
      ],
    ).toBe(true);
    expect(
      read({
        userAgentData: { ...CHROME_HINTS, brands: [{ brand: 'HeadlessChrome', version: '140' }] },
      })['ua-headless-marker'],
    ).toBe(true);
    expect(read()['ua-headless-marker']).toBe(false);
  });

  it('finds a zero-sized window that still has focus', () => {
    expect(read({ outerWidth: 0, outerHeight: 0, focused: true })['zero-window-with-focus']).toBe(
      true,
    );
    expect(read({ outerWidth: 0, outerHeight: 0, focused: false })['zero-window-with-focus']).toBe(
      false,
    );
    expect(read({ outerWidth: 0, outerHeight: 600, focused: true })['zero-window-with-focus']).toBe(
      false,
    );
  });

  it('finds plugin and MIME lists that contradict the built-in PDF viewer', () => {
    const empty = read({ pdfViewerEnabled: true, pluginCount: 0, mimeTypeCount: 0 });
    expect(empty['plugins-inconsistent']).toBe(true);
    expect(empty['mime-inconsistent']).toBe(true);
    // Without a PDF viewer, empty lists are what the HTML standard prescribes.
    const noViewer = read({ pdfViewerEnabled: false, pluginCount: 0, mimeTypeCount: 0 });
    expect(noViewer['plugins-inconsistent']).toBe(false);
    expect(noViewer['mime-inconsistent']).toBe(false);
    // A missing list cannot be judged.
    const missing = read({ pdfViewerEnabled: true, pluginCount: null, mimeTypeCount: null });
    expect(missing['plugins-inconsistent']).toBe(false);
    expect(missing['mime-inconsistent']).toBe(false);
  });

  it('reads both lists as consistent, never as undefined, where the browser has no pdfViewerEnabled', () => {
    // Firefox before 99 and Safari before 16.4 have no such member: no viewer to contradict.
    const older = read({ pdfViewerEnabled: null, pluginCount: 0, mimeTypeCount: 0 });
    expect(older['plugins-inconsistent']).toBe(false);
    expect(older['mime-inconsistent']).toBe(false);
  });

  it('finds native functions rewritten in script, and a missing bind', () => {
    expect(read({ scriptedNavigatorGetters: ['webdriver'] })['native-function-tampered']).toBe(
      true,
    );
    expect(read({ bindMissing: true })['native-function-tampered']).toBe(true);
    expect(read()['native-function-tampered']).toBe(false);
  });

  it('passes the screen count of scripted events through, capped at 10,000', () => {
    expect(read({}, 3)['untrusted-event-count']).toBe(3);
    expect(read({}, 12_000)['untrusted-event-count']).toBe(10_000);
  });

  it('bounds the client hints to the contract: 8 brands, 64-character brands, major versions, 32-character platform', () => {
    const many = Array.from({ length: 10 }, (_, index) => ({
      brand: `Brand ${String(index)}`,
      version: String(index),
    }));
    const hints = read({
      userAgentData: {
        brands: [
          { brand: 'B'.repeat(80), version: '140' },
          { brand: 'Full version', version: '140.0.7339.80' },
          { brand: '', version: '1' },
          { brand: 7, version: '1' },
          ...many,
        ],
        mobile: true,
        platform: 'P'.repeat(40),
      },
    })['client-hints'];
    expect(hints?.brands).toHaveLength(8);
    expect(hints?.brands[0]).toEqual({ brand: 'B'.repeat(64), version: '140' });
    expect(hints?.brands.some(({ brand }) => brand === 'Full version' || brand === '')).toBe(false);
    expect(hints?.mobile).toBe(true);
    expect(hints?.platform).toBe('P'.repeat(32));
    expect(read({ userAgentData: undefined })['client-hints']).toBeNull();
    expect(
      read({ userAgentData: { brands: 'none', mobile: 'yes', platform: 4 } })['client-hints'],
    ).toEqual({
      brands: [],
      mobile: false,
      platform: '',
    });
  });

  it('keeps an IANA time zone and nothing else', () => {
    expect(read({ timeZone: 'America/Argentina/Buenos_Aires' }).timezone).toBe(
      'America/Argentina/Buenos_Aires',
    );
    expect(read({ timeZone: 'Etc/GMT+5' }).timezone).toBe('Etc/GMT+5');
    expect(read({ timeZone: '../../etc/passwd' }).timezone).toBeNull();
    expect(read({ timeZone: 'Z'.repeat(65) }).timezone).toBeNull();
    expect(
      read({
        timeZone: () => {
          throw new RangeError('no time zone');
        },
      }).timezone,
    ).toBeNull();
  });

  it('keeps the first five well-formed language tags', () => {
    expect(
      read({
        languages: ['en-US', 'fr', 'not a tag', 42, 'de', 'es-419', 'x'.repeat(40), 'it', 'pt'],
      }).languages,
    ).toEqual(['en-US', 'fr', 'de', 'es-419', 'it']);
    expect(read({ languages: undefined }).languages).toEqual(['en-US', 'en']);
    expect(read({ languages: 'en' }).languages).toEqual([]);
  });

  it('reads a probe that throws as not seen, and still reads the others', () => {
    const fake = fakeBrowser({ webdriver: true });
    Object.defineProperty(fake.window.navigator, 'userAgent', {
      get() {
        throw new Error('blocked');
      },
    });
    const integrity = readIntegrity(fake.window, 0);
    expect(integrity.webdriver).toBe(true);
    expect(integrity['ua-headless-marker']).toBe(false);
  });
});
