import { describe, expect, it } from 'vitest';
import { CROSS_LAYER_RULES, crossLayerEvidence, timeZoneFitsCountry } from './consistency.js';
import type { CrossLayerInput } from './consistency.js';
import { AT, integrity } from './testing.js';

const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const SAFARI_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';

const BRANDS = [
  { brand: 'Chromium', version: '130' },
  { brand: 'Google Chrome', version: '130' },
  { brand: 'Not?A_Brand', version: '99' },
];
const hints = (platform: string, mobile = false) => ({ brands: BRANDS, mobile, platform });

const input = (overrides: Partial<CrossLayerInput> = {}): CrossLayerInput => ({
  userAgent: CHROME_WINDOWS,
  integrity: integrity({
    'client-hints': hints('Windows'),
    timezone: 'Europe/Paris',
    languages: ['fr-FR', 'fr', 'en'],
  }),
  requestHeaders: { acceptLanguages: ['fr-FR', 'fr', 'en'], clientHints: hints('Windows') },
  ipCountry: 'FR',
  at: AT,
  ...overrides,
});

describe('the cross-layer rules (C94.8, V13)', () => {
  it('names the three rules by their evidence reasons', () => {
    expect(CROSS_LAYER_RULES).toEqual([
      'ua_client_hints_mismatch',
      'language_mismatch',
      'timezone_country_mismatch',
    ]);
  });

  it('golden: a consistent Chrome on Windows in France: all three compared, none contradicts', () => {
    expect(crossLayerEvidence(input())).toEqual({
      evaluated: ['ua_client_hints_mismatch', 'language_mismatch', 'timezone_country_mismatch'],
      mismatches: [],
    });
  });

  it("golden: Chromium's client hints under a Safari or Firefox user agent contradict", () => {
    expect(crossLayerEvidence(input({ userAgent: SAFARI_MAC })).mismatches).toContain(
      'ua_client_hints_mismatch',
    );
    expect(crossLayerEvidence(input({ userAgent: FIREFOX_LINUX })).mismatches).toContain(
      'ua_client_hints_mismatch',
    );
  });

  it('golden: a platform family or a Chromium version that differs between the layers contradicts', () => {
    const macHints = input({
      integrity: integrity({ 'client-hints': hints('macOS'), languages: ['fr'] }),
      requestHeaders: { acceptLanguages: ['fr'], clientHints: hints('macOS') },
    });
    expect(crossLayerEvidence(macHints).mismatches).toEqual(['ua_client_hints_mismatch']);
    const older = CHROME_WINDOWS.replace('Chrome/130.0.0.0', 'Chrome/118.0.0.0');
    expect(crossLayerEvidence(input({ userAgent: older })).mismatches).toEqual([
      'ua_client_hints_mismatch',
    ]);
  });

  it('golden: the page and the headers disagreeing on the hints contradicts', () => {
    const headers = { acceptLanguages: ['fr-FR'], clientHints: hints('Linux') };
    expect(crossLayerEvidence(input({ requestHeaders: headers })).mismatches).toContain(
      'ua_client_hints_mismatch',
    );
    const mobile = { acceptLanguages: ['fr-FR'], clientHints: hints('Windows', true) };
    expect(crossLayerEvidence(input({ requestHeaders: mobile })).mismatches).toContain(
      'ua_client_hints_mismatch',
    );
  });

  it('keeps an honest desktop-site request on Android consistent (same platform family)', () => {
    const desktopSite =
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
    const android = hints('Android');
    expect(
      crossLayerEvidence(
        input({
          userAgent: desktopSite,
          integrity: integrity({ 'client-hints': android }),
          requestHeaders: { acceptLanguages: [], clientHints: android },
        }),
      ).mismatches,
    ).toEqual([]);
    expect(
      crossLayerEvidence(
        input({
          userAgent: CHROME_ANDROID,
          integrity: integrity({ 'client-hints': hints('Android', true) }),
          requestHeaders: { acceptLanguages: [], clientHints: hints('Android', true) },
        }),
      ).mismatches,
    ).toEqual([]);
  });

  it('does not compare the hints without them: their absence is not evidence', () => {
    const result = crossLayerEvidence(
      input({
        userAgent: SAFARI_MAC,
        integrity: integrity({ languages: ['fr'] }),
        requestHeaders: { acceptLanguages: ['fr'], clientHints: null },
      }),
    );
    expect(result.evaluated).not.toContain('ua_client_hints_mismatch');
    expect(result.mismatches).toEqual([]);
  });

  it('golden: Accept-Language sharing no language with the page contradicts', () => {
    expect(
      crossLayerEvidence(
        input({
          requestHeaders: { acceptLanguages: ['de-DE', 'de'], clientHints: hints('Windows') },
        }),
      ).mismatches,
    ).toEqual(['language_mismatch']);
    expect(
      crossLayerEvidence(
        input({ requestHeaders: { acceptLanguages: ['en-GB'], clientHints: hints('Windows') } }),
      ).mismatches,
    ).toEqual([]);
  });

  it('golden: a time zone none of whose offsets the IP country has contradicts', () => {
    const tokyo = input({
      integrity: integrity({
        'client-hints': hints('Windows'),
        timezone: 'Asia/Tokyo',
        languages: ['fr'],
      }),
    });
    expect(crossLayerEvidence(tokyo).mismatches).toEqual(['timezone_country_mismatch']);
  });

  it('never compares a time zone without a reliable IP country', () => {
    const result = crossLayerEvidence(input({ ipCountry: null }));
    expect(result.evaluated).not.toContain('timezone_country_mismatch');
  });

  it('compares nothing it lacks a layer for', () => {
    expect(
      crossLayerEvidence({
        userAgent: null,
        integrity: null,
        requestHeaders: null,
        ipCountry: null,
        at: AT,
      }),
    ).toEqual({ evaluated: [], mismatches: [] });
    // An SDK user agent is not a browser's: one set of hints has nothing to be compared with.
    expect(
      crossLayerEvidence(
        input({
          userAgent: 'OpenVerify-Android/0.1.0',
          requestHeaders: { acceptLanguages: [], clientHints: null },
        }),
      ).evaluated,
    ).not.toContain('ua_client_hints_mismatch');
  });
});

describe('timeZoneFitsCountry (from the runtime ICU data, nothing typed out)', () => {
  it('fits a zone of the country, or one with the same offset then', () => {
    expect(timeZoneFitsCountry('Europe/Paris', 'FR', AT)).toBe(true);
    expect(timeZoneFitsCountry('Europe/Berlin', 'FR', AT)).toBe(true);
    expect(timeZoneFitsCountry('America/Chicago', 'US', AT)).toBe(true);
  });

  it('does not fit a zone with none of the country offsets', () => {
    expect(timeZoneFitsCountry('Asia/Tokyo', 'FR', AT)).toBe(false);
    expect(timeZoneFitsCountry('Europe/Paris', 'JP', AT)).toBe(false);
  });

  it('answers null for UTC (privacy browsers report it), an unknown zone or a fictional country', () => {
    expect(timeZoneFitsCountry('UTC', 'JP', AT)).toBeNull();
    expect(timeZoneFitsCountry('Etc/GMT+5', 'JP', AT)).toBeNull();
    expect(timeZoneFitsCountry('Mars/Olympus_Mons', 'FR', AT)).toBeNull();
    expect(timeZoneFitsCountry('Europe/Paris', 'ZZ', AT)).toBeNull();
  });
});
