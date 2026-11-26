/**
 * C76.1: the committed source manifest. The table of sources, their intervals, deadlines and
 * defaults is the plan's; the byte caps clear the sizes the research measured on 2026-10-22
 * (`docs/research/phase6-data-sources.md`); OFSI's closed list is never a source; no URL carries
 * a token or a credential, so nothing secret is committed.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { REPORT_CONFIG_DEFAULTS } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  defaultWatchlistManifestPath,
  loadWatchlistManifest,
  watchlistManifestSchema,
  type WatchlistManifestSource,
} from './manifest.js';

const manifest = loadWatchlistManifest();
const byId = new Map(manifest.sources.map((source) => [source.id, source]));
const source = (id: string): WatchlistManifestSource => {
  const found = byId.get(id);
  if (found === undefined) {
    throw new Error(`no source ${id}`);
  }
  return found;
};

const MIB = 1024 * 1024;

describe('the committed manifest (C76.1)', () => {
  it('lists the plan’s sources, each with its kind, default and intervals', () => {
    const table = manifest.sources.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      enabled: entry.enabled_by_default,
      sandboxOnly: entry.sandbox_only,
      refresh: entry.refresh_interval_hours,
      stale: entry.stale_after_hours,
      timeout: entry.timeout_seconds,
      requires: entry.requires,
    }));

    expect(table).toEqual([
      {
        id: 'ofac-sdn',
        kind: 'sanctions',
        enabled: true,
        sandboxOnly: false,
        refresh: 6,
        stale: 48,
        timeout: 300,
        requires: null,
      },
      {
        id: 'ofac-consolidated',
        kind: 'sanctions',
        enabled: true,
        sandboxOnly: false,
        refresh: 6,
        stale: 48,
        timeout: 300,
        requires: null,
      },
      {
        id: 'eu-fsf',
        kind: 'sanctions',
        enabled: true,
        sandboxOnly: false,
        refresh: 6,
        stale: 48,
        timeout: 300,
        requires: 'eu_fsf_token',
      },
      {
        id: 'uk-sanctions-list',
        kind: 'sanctions',
        enabled: true,
        sandboxOnly: false,
        refresh: 6,
        stale: 48,
        timeout: 300,
        requires: null,
      },
      {
        id: 'un-sc',
        kind: 'sanctions',
        enabled: false,
        sandboxOnly: false,
        refresh: 24,
        stale: 72,
        timeout: 300,
        requires: null,
      },
      {
        id: 'wikidata-pep',
        kind: 'pep',
        enabled: true,
        sandboxOnly: false,
        refresh: 168,
        stale: 192,
        timeout: 75,
        requires: 'wikidata_user_agent',
      },
      {
        id: 'openverify-sandbox',
        kind: 'sanctions',
        enabled: true,
        sandboxOnly: true,
        refresh: null,
        stale: null,
        timeout: null,
        requires: null,
      },
      {
        id: 'openverify-sandbox-pep',
        kind: 'pep',
        enabled: true,
        sandboxOnly: true,
        refresh: null,
        stale: null,
        timeout: null,
        requires: null,
      },
    ]);
  });

  it('reads each publisher’s own format, never a CSV (C77.2)', () => {
    expect(
      Object.fromEntries(
        manifest.sources.map((entry) => [entry.id, [entry.parser, entry.archive_member]]),
      ),
    ).toEqual({
      'ofac-sdn': ['ofac-enhanced-xml', 'SDN_ENHANCED.XML'],
      'ofac-consolidated': ['ofac-enhanced-xml', null],
      'eu-fsf': ['eu-fsf-xml', null],
      'uk-sanctions-list': ['uk-sanctions-list-xml', null],
      'un-sc': ['un-consolidated-xml', null],
      'wikidata-pep': ['wikidata-sparql', null],
      'openverify-sandbox': ['normalised-json', null],
      'openverify-sandbox-pep': ['normalised-json', null],
    });
    for (const entry of manifest.sources) {
      for (const url of entry.urls) {
        expect(url.toLowerCase()).not.toMatch(/\.csv$/);
      }
    }
  });

  it('has no OFSI URL: the closed list is never a source', () => {
    const urls = manifest.sources.flatMap((entry) => [...entry.urls, entry.redirect_host ?? '']);
    expect(urls.some((url) => /ofsi/i.test(url))).toBe(false);
  });

  it('refuses an OFSI URL or redirect host', () => {
    const uk = source('uk-sanctions-list');
    const withUrl = {
      ...manifest,
      sources: [
        { ...uk, urls: ['https://ofsistorage.blob.core.windows.net/publishlive/ConList.xml'] },
      ],
    };
    const withHost = {
      ...manifest,
      sources: [{ ...uk, redirect_host: 'ofsistorage.blob.core.windows.net' }],
    };

    expect(watchlistManifestSchema.safeParse(withUrl).success).toBe(false);
    expect(watchlistManifestSchema.safeParse(withHost).success).toBe(false);
  });

  it('refuses a source id given twice', () => {
    const uk = source('uk-sanctions-list');

    expect(watchlistManifestSchema.safeParse({ ...manifest, sources: [uk, uk] }).success).toBe(
      false,
    );
  });

  it('downloads over HTTPS from URLs that hold no query, token or credential', () => {
    for (const entry of manifest.sources) {
      for (const value of entry.urls) {
        const url = new URL(value);
        expect(url.protocol).toBe('https:');
        expect(url.search).toBe('');
        expect(url.username).toBe('');
        expect(url.password).toBe('');
      }
    }
  });

  it('allows a redirect only where the publisher serves from object storage, to one exact host', () => {
    expect(
      Object.fromEntries(manifest.sources.map((entry) => [entry.id, entry.redirect_host])),
    ).toEqual({
      'ofac-sdn': 'wc2h-sls-prod-public-published.s3.us-gov-west-1.amazonaws.com',
      'ofac-consolidated': 'wc2h-sls-prod-public-published.s3.us-gov-west-1.amazonaws.com',
      'eu-fsf': null,
      'uk-sanctions-list': null,
      'un-sc': 'unsolprodfiles.blob.core.windows.net',
      'wikidata-pep': null,
      'openverify-sandbox': null,
      'openverify-sandbox-pep': null,
    });
  });

  it('gives the sandbox lists no URL: they are imported, synthetic, never refreshed', () => {
    for (const entry of manifest.sources.filter((candidate) => candidate.sandbox_only)) {
      expect(entry.urls).toEqual([]);
      expect(entry.parser).toBe('normalised-json');
    }
    for (const entry of manifest.sources.filter((candidate) => !candidate.sandbox_only)) {
      expect(entry.urls.length).toBeGreaterThan(0);
    }
  });

  it('caps each download above the size the research measured', () => {
    const measured: Record<string, { compressed: number; inflated: number }> = {
      'ofac-sdn': { compressed: 6_793_008, inflated: 109_924_494 },
      'ofac-consolidated': { compressed: 3_870_352, inflated: 3_870_352 },
      'eu-fsf': { compressed: 25_767_041, inflated: 25_767_041 },
      'uk-sanctions-list': { compressed: 22_051_514, inflated: 22_051_514 },
      'un-sc': { compressed: 2_185_396, inflated: 2_185_396 },
    };
    for (const [id, size] of Object.entries(measured)) {
      const caps = source(id).max_bytes;
      expect(caps.compressed).toBeGreaterThanOrEqual(2 * size.compressed);
      expect(caps.inflated).toBeGreaterThanOrEqual(2 * size.inflated);
      expect(caps.inflated).toBeGreaterThanOrEqual(caps.compressed);
    }
    expect(source('wikidata-pep').max_bytes.compressed).toBe(64 * MIB);
  });

  it('accepts only the content types each publisher serves, judged on the final hop', () => {
    expect(source('ofac-sdn').content_types).toEqual([
      'application/zip',
      'application/octet-stream',
    ]);
    for (const id of ['ofac-consolidated', 'eu-fsf', 'uk-sanctions-list', 'un-sc']) {
      expect(source(id).content_types).toEqual(['application/xml', 'text/xml']);
    }
    expect(source('wikidata-pep').content_types).toEqual([
      'application/sparql-results+json',
      'application/json',
    ]);
  });

  it('names no change signal: every check downloads the file and compares its SHA-256 (owner decision 10 after 6B)', () => {
    const committed = JSON.parse(readFileSync(defaultWatchlistManifestPath(), 'utf8')) as {
      sources: Record<string, unknown>[];
    };
    for (const entry of committed.sources) {
      expect(Object.keys(entry), String(entry.id)).not.toContain('change_signal');
    }
    const ofac = { ...source('ofac-sdn') };
    const signalled = {
      ...manifest,
      sources: [
        {
          ...ofac,
          change_signal: {
            kind: 'ofac-changes-latest',
            url: 'https://sanctionslistservice.ofac.treas.gov/changes/latest',
          },
        },
      ],
    };
    expect(watchlistManifestSchema.safeParse(signalled).success).toBe(false);
  });

  it('keeps every refresh within its stale limit and the type’s default list age (H02, F02)', () => {
    const ageOf = (type: 'watchlist' | 'politically-exposed-person') =>
      Number(REPORT_CONFIG_DEFAULTS[type]['max-list-age-hours']?.value);
    const defaultAge = { sanctions: ageOf('watchlist'), pep: ageOf('politically-exposed-person') };
    for (const entry of manifest.sources.filter((candidate) => !candidate.sandbox_only)) {
      const refresh = entry.refresh_interval_hours ?? Infinity;
      expect(refresh).toBeLessThan(entry.stale_after_hours ?? 0);
      if (entry.enabled_by_default) {
        expect(refresh).toBeLessThanOrEqual(defaultAge[entry.kind]);
      }
    }
  });

  it("says that the UN list ships disabled and only an environment admin's audited opt-in enables it, as the reports README does (C254.1, Q10 granted)", () => {
    const note = source('un-sc').terms.note;
    expect(source('un-sc').enabled_by_default).toBe(false);
    expect(note).not.toMatch(/cannot be enabled in this release/);
    expect(note).toMatch(/environment admin/);
    expect(note).toMatch(/acknowledgement/);
    expect(note).toContain('OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED');
    const readme = readFileSync(
      join(dirname(defaultWatchlistManifestPath()), '..', 'docs', 'reports', 'README.md'),
      'utf8',
    );
    expect(readme).not.toMatch(/`un-sc` cannot be enabled in this release/);
    expect(readme).toMatch(/`un-sc` is enabled only by an environment admin's opt-in/);
  });

  it('carries an attribution line and a terms note for every source (C76.7)', () => {
    expect(source('uk-sanctions-list').attribution).toContain('Open Government Licence v3.0');
    expect(source('eu-fsf').attribution).toContain('Decision 2011/833/EU');
    expect(source('un-sc').terms.note).toMatch(/non-commercial/);
    for (const entry of manifest.sources) {
      expect(entry.attribution.length).toBeGreaterThan(10);
      expect(entry.terms.note.length).toBeGreaterThan(10);
    }
  });
});
