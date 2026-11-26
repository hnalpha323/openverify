import { describe, expect, it } from 'vitest';
import * as entry from '@openverify/checks';
import * as business from './business/index.js';
import * as contact from './contact/index.js';
import * as crypto from './crypto/index.js';
import * as database from './database/index.js';
import * as document from './document/index.js';
import * as matching from './matching/index.js';
import * as nfc from './nfc/index.js';
import * as reports from './reports/index.js';
import * as csv from './csv/index.js';
import * as lists from './lists/index.js';
import * as signals from './signals/index.js';
import { PACKAGE_NAME } from './index.js';

describe('@openverify/checks entry point', () => {
  it('identifies the package', () => {
    expect(PACKAGE_NAME).toBe('@openverify/checks');
  });

  it('resolves the package name to its TypeScript source without a build', () => {
    expect(entry.PACKAGE_NAME).toBe(PACKAGE_NAME);
  });

  // C54.4: the Workflow 5A and 5B Stage 2 owners add their exports to their own folder's index
  // only (V09: document, business and nfc in 5B).
  it.each([
    ['contact', contact],
    ['crypto', crypto],
    ['matching', matching],
    ['database', database],
    ['document', document],
    ['business', business],
    ['nfc', nfc],
    // Workflow 6A Stage 1a: the report risk logic (C81.3, C82), filled by risk-logic.
    ['reports', reports],
    // Workflow 7A Stage 1a: the signal logic (C93.4, C94.5, C94.8, C95, C90.4), filled by signal-logic.
    ['signals', signals],
    ['lists', lists],
    ['csv', csv],
  ] as const)('re-exports everything the %s folder exports', (_area, area) => {
    const exported = entry as Readonly<Record<string, unknown>>;
    const names = Object.keys(area);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(exported[name], name).toBe((area as Readonly<Record<string, unknown>>)[name]);
    }
  });

  it('exports the ICAO 9303 Part 3 §6.A Latin table unchanged, for the watchlist fold (C78.1, F21)', () => {
    const exported = entry as Readonly<Record<string, unknown>>;
    expect(exported.ICAO_LATIN_TRANSLITERATIONS).toEqual({
      Æ: 'AE',
      Œ: 'OE',
      Þ: 'TH',
      Ð: 'D',
      Đ: 'D',
      Ł: 'L',
      Ħ: 'H',
    });
    expect(exported.ICAO_LATIN_EXPANDED_FORMS).toEqual({
      Ä: 'AE',
      Ö: 'OE',
      Ü: 'UE',
      Å: 'AA',
      Ø: 'OE',
    });
    expect(Object.isFrozen(exported.ICAO_LATIN_TRANSLITERATIONS)).toBe(true);
    expect(Object.isFrozen(exported.ICAO_LATIN_EXPANDED_FORMS)).toBe(true);
  });
});
