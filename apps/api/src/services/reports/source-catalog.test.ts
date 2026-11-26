/**
 * C71.2, C76.1: the report engine's reading of the source manifest. Synthetic manifests only.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  catalogOf,
  loadWatchlistSourceCatalog,
  parseWatchlistManifest,
  useWatchlistSourceCatalog,
  watchlistSourceCatalog,
} from './source-catalog.js';

const ENTRY = {
  id: 'ofac-sdn',
  publisher: 'US Treasury OFAC',
  kind: 'sanctions',
  urls: ['https://lists.example/sdn.zip'],
  refresh_interval_hours: 6,
  stale_after_hours: 48,
  enabled_by_default: true,
  sandbox_only: false,
  attribution: 'Synthetic attribution line',
};

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

describe('parseWatchlistManifest', () => {
  it('reads each source by the C76.1 field names, from a list or { sources }', () => {
    const expected = [
      {
        id: 'ofac-sdn',
        kind: 'sanctions',
        publisher: 'US Treasury OFAC',
        refreshIntervalHours: 6,
        staleAfterHours: 48,
        sandboxOnly: false,
        attribution: 'Synthetic attribution line',
        listUrl: 'https://lists.example/sdn.zip',
        flagCode: 'US',
      },
    ];
    expect(parseWatchlistManifest([ENTRY])).toEqual(expected);
    expect(parseWatchlistManifest({ sources: [ENTRY] })).toEqual(expected);
  });

  it('takes an explicit flag code, guesses the publisher code from the id, and ZZ otherwise', () => {
    const codes = parseWatchlistManifest([
      { ...ENTRY, id: 'eu-fsf' },
      { ...ENTRY, id: 'uk-sanctions-list' },
      { ...ENTRY, id: 'un-sc' },
      { ...ENTRY, id: 'openverify-sandbox', sandbox_only: true, refresh_interval_hours: null },
      { ...ENTRY, id: 'wikidata-pep', kind: 'pep', flag_code: 'XW' },
    ]).map((source) => [source.id, source.flagCode]);

    expect(codes).toEqual([
      ['eu-fsf', 'EU'],
      ['uk-sanctions-list', 'GB'],
      ['un-sc', 'UN'],
      ['openverify-sandbox', 'ZZ'],
      ['wikidata-pep', 'XW'],
    ]);
  });

  it('leaves out an entry it cannot read, and an http URL as the list URL', () => {
    const sources = parseWatchlistManifest([
      { ...ENTRY, kind: 'unknown' },
      { id: 'no-kind' },
      { ...ENTRY, id: 'plain', urls: ['http://lists.example/plain.xml'], stale_after_hours: null },
    ]);

    expect(sources.map((source) => [source.id, source.listUrl, source.staleAfterHours])).toEqual([
      ['plain', null, null],
    ]);
  });
});

describe('the catalog in force', () => {
  it('is empty for a missing manifest, so every source is unknown', () => {
    expect(loadWatchlistSourceCatalog('/nonexistent/watchlists/sources.json').all()).toEqual([]);
  });

  it('reads a manifest file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'openverify-catalog-'));
    const path = join(directory, 'sources.json');
    writeFileSync(path, JSON.stringify({ sources: [ENTRY] }));

    expect(loadWatchlistSourceCatalog(path).get('ofac-sdn')?.kind).toBe('sanctions');
  });

  it('can be replaced and restored', () => {
    const before = watchlistSourceCatalog();
    restore = useWatchlistSourceCatalog(catalogOf(parseWatchlistManifest([ENTRY])));

    expect(watchlistSourceCatalog().get('ofac-sdn')?.publisher).toBe('US Treasury OFAC');
    restore();
    restore = undefined;
    expect(watchlistSourceCatalog()).toBe(before);
  });
});
