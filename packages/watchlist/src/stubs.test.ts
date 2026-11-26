/** Workflow 6A Stage 1a: every Stage 2 folder is exported from the package entry point. */
import { describe, expect, it } from 'vitest';
import * as watchlist from './index.js';
import * as testing from './testing/index.js';
import { WATCHLIST_TESTING_AREA } from './testing/index.js';

describe('@openverify/watchlist entry point', () => {
  it('identifies the package and reserves each Stage 2 folder', () => {
    expect(watchlist.PACKAGE_NAME).toBe('@openverify/watchlist');
    const areas = Object.entries(watchlist)
      .filter(([name]) => name.startsWith('WATCHLIST_') && name.endsWith('_AREA'))
      .map(([, value]) => value as string)
      .sort();
    expect(areas).toEqual(
      [
        'parsers',
        'zip',
        'xml',
        'diff',
        'pep',
        'names',
        'translit',
        'keys',
        'score',
        'match',
        'crypto',
        'reverse-index',
        'list-keys',
      ].sort(),
    );
    expect(WATCHLIST_TESTING_AREA).toBe('testing');
  });

  it('exports the frozen record and the keys-version stub', () => {
    for (const name of [
      'watchlistRecordSchema',
      'contentHash',
      'riskDataHash',
      'isHeldOutGroup',
      'keysVersion',
    ]) {
      expect(watchlist).toHaveProperty(name);
    }
    expect(watchlist.keysVersion('0'.repeat(64))).toMatch(/;groups-0{64}$/);
  });

  it('exports no change-signal reader, nor a writer of their answers (owner decision 10 after 6B)', () => {
    // Every check downloads the publication and compares its SHA-256; no publisher signal is read.
    for (const name of [
      'ofacChangeSignal',
      'euChangeSignal',
      'ukChangeSignal',
      'changeSignalMoved',
    ]) {
      expect(watchlist, name).not.toHaveProperty(name);
    }
    for (const name of [
      'ofacChangesLatestAnswer',
      'ofacExportHeaders',
      'euRssAnswer',
      'govUkContentAnswer',
      'OFAC_STORAGE_HOST',
    ]) {
      expect(testing, name).not.toHaveProperty(name);
    }
  });
});
