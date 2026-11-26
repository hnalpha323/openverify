/**
 * C92.1 (ADR 0006): the committed `network/sources.json` and its strict schema. No publisher is
 * called: the test reads the committed file and documents built here.
 */
import { NETWORK_PARSERS, NETWORK_SOURCE_ROLES } from '@openverify/signals/network';
import { describe, expect, it } from 'vitest';
import {
  NETWORK_MANIFEST_FORMAT,
  loadNetworkManifest,
  networkManifest,
  networkManifestSource,
  parseNetworkManifest,
  type NetworkManifestSource,
} from './manifest.js';

const HOUR = 1;
const DAY = 24;

describe('the committed network/sources.json', () => {
  const manifest = loadNetworkManifest();

  it('lists the sources of C92.1 with their parser, default, refresh and staleness', () => {
    const rows = manifest.sources.map((source) => [
      source.id,
      source.parser,
      source.enabled_by_default,
      source.refresh_interval_hours,
      source.stale_after_hours,
    ]);
    expect(rows).toEqual([
      ['dbip-country-lite', 'mmdb-country', true, 24 * HOUR, 45 * DAY],
      ['dbip-asn-lite', 'mmdb-asn', true, 24 * HOUR, 45 * DAY],
      ['dbip-city-lite', 'mmdb-city', false, 24 * HOUR, 45 * DAY],
      ['tor-exit-addresses', 'tordnsel-exit-addresses', true, 1 * HOUR, 6 * HOUR],
      ['aws-ip-ranges', 'aws-ip-ranges', true, 6 * HOUR, 7 * DAY],
      ['gcp-cloud', 'gcp-cloud-json', true, 6 * HOUR, 7 * DAY],
      ['oracle-public-ip-ranges', 'oracle-public-ip-ranges', true, 24 * HOUR, 14 * DAY],
      ['cloudflare-ips', 'cloudflare-ips-api', true, 24 * HOUR, 14 * DAY],
      ['digitalocean-geofeed', 'rfc8805-geofeed', true, 24 * HOUR, 14 * DAY],
      ['linode-geofeed', 'rfc8805-geofeed', true, 24 * HOUR, 14 * DAY],
      ['azure-service-tags', 'azure-service-tags', false, null, 21 * DAY],
      ['apple-private-relay', 'rfc8805-geofeed', false, 24 * HOUR, 7 * DAY],
      ['openverify-sandbox-network', 'openverify-sandbox-network', true, null, null],
    ]);
    expect(manifest.format).toBe(NETWORK_MANIFEST_FORMAT);
  });

  it('downloads DB-IP by month, gunzipped, checked against the page digest, with its link-back', () => {
    for (const id of ['dbip-country-lite', 'dbip-asn-lite', 'dbip-city-lite']) {
      const source = networkManifestSource(id, manifest);
      expect(source?.urls).toEqual([]);
      expect(source?.url_template).toMatch(
        /^https:\/\/download\.db-ip\.com\/free\/dbip-[a-z]+-lite-\{yyyy-mm\}\.mmdb\.gz$/,
      );
      expect(source?.decompress).toBe('gzip');
      expect(source?.digest?.algorithm).toBe('sha1');
      expect(source?.digest?.page_url).toMatch(/^https:\/\/db-ip\.com\//);
      expect(source?.attribution).toBe('IP geolocation by DB-IP');
      expect(source?.link_back).toBe('https://db-ip.com');
    }
  });

  it('gives each role its parsers, the sandbox source alone sandbox-only and import-only', () => {
    const roles = new Map(manifest.sources.map((source) => [source.id, source.role]));
    expect(roles.get('tor-exit-addresses')).toBe('tor');
    expect(roles.get('apple-private-relay')).toBe('relay');
    expect(roles.get('openverify-sandbox-network')).toBe('sandbox');
    expect(manifest.sources.filter((source) => source.sandbox_only).map(({ id }) => id)).toEqual([
      'openverify-sandbox-network',
    ]);
    const importOnly = manifest.sources
      .filter((source) => source.urls.length === 0 && source.url_template === null)
      .map(({ id }) => id);
    expect(importOnly).toEqual(['azure-service-tags', 'openverify-sandbox-network']);
    for (const source of manifest.sources) {
      expect(NETWORK_PARSERS).toContain(source.parser);
      expect(NETWORK_SOURCE_ROLES).toContain(source.role);
      if (source.role === 'cloud-ranges' || source.role === 'relay') {
        expect(source.min_prefix).not.toBeNull();
      }
    }
  });

  it('accepts a missing content type only for the exit list, which TorDNSEL serves without one', () => {
    const untyped = manifest.sources
      .filter((source) => source.content_types.includes('none'))
      .map(({ id }) => id);
    expect(untyped).toEqual(['tor-exit-addresses']);
  });

  it('states the mass-change thresholds with their basis', () => {
    expect(manifest.guards).toMatchObject({
      mass_removal_share: 0.25,
      mass_addition_share: 0.25,
      mmdb_min_size_share: 0.5,
    });
    expect(manifest.guards.basis).toMatch(/provisional/);
  });

  it('is read once per process', () => {
    expect(networkManifest()).toBe(networkManifest());
    expect(networkManifestSource('no-such-source')).toBeUndefined();
  });
});

describe('the manifest schema', () => {
  const committed = loadNetworkManifest();
  const base = structuredClone(committed) as unknown as {
    sources: (NetworkManifestSource & Record<string, unknown>)[];
  } & Record<string, unknown>;
  const withSource = (index: number, change: Record<string, unknown>) => ({
    ...base,
    sources: base.sources.map((source, at) => (at === index ? { ...source, ...change } : source)),
  });
  const tor = base.sources.findIndex((source) => source.id === 'tor-exit-addresses');
  const aws = base.sources.findIndex((source) => source.id === 'aws-ip-ranges');
  const sandbox = base.sources.findIndex((source) => source.id === 'openverify-sandbox-network');

  it('parses the committed document', () => {
    expect(parseNetworkManifest(base).sources).toHaveLength(13);
  });

  it('refuses a change signal (owner decision 10 after Workflow 6B)', () => {
    expect(() => parseNetworkManifest(withSource(tor, { change_signal: 'etag' }))).toThrow();
  });

  it('refuses a plain-HTTP URL', () => {
    expect(() =>
      parseNetworkManifest(
        withSource(tor, { urls: ['http://check.torproject.org/exit-addresses'] }),
      ),
    ).toThrow();
  });

  it.each([
    'https://ipinfo.io/data/ipinfo_lite.mmdb',
    'https://www.ip2location.com/download?file=DB1',
    'https://download.maxmind.com/geoip/databases/GeoLite2-City/download',
    'https://nominatim.openstreetmap.org/search',
    'https://iptoasn.com/data/ip2asn-v4.tsv.gz',
    'https://archive.routeviews.org/bgpdata/',
  ])('refuses a host whose terms fail rule 4: %s', (url) => {
    expect(() => parseNetworkManifest(withSource(aws, { urls: [url] }))).toThrow();
  });

  it('refuses a sandbox role on a public source and a public role on a sandbox source', () => {
    expect(() => parseNetworkManifest(withSource(sandbox, { sandbox_only: false }))).toThrow();
    expect(() => parseNetworkManifest(withSource(aws, { sandbox_only: true }))).toThrow();
  });

  it('refuses a parser of another role, and a geofeed without its provider label', () => {
    expect(() => parseNetworkManifest(withSource(aws, { parser: 'mmdb-asn' }))).toThrow();
    const linode = base.sources.findIndex((source) => source.id === 'linode-geofeed');
    expect(() => parseNetworkManifest(withSource(linode, { provider: null }))).toThrow();
  });

  it('refuses a range source without its shortest prefixes', () => {
    expect(() => parseNetworkManifest(withSource(aws, { min_prefix: null }))).toThrow();
  });

  it('refuses a URL template without the month, or beside fixed URLs', () => {
    const country = base.sources.findIndex((source) => source.id === 'dbip-country-lite');
    expect(() =>
      parseNetworkManifest(
        withSource(country, {
          url_template: 'https://download.db-ip.com/free/dbip-country-lite.mmdb.gz',
        }),
      ),
    ).toThrow();
    expect(() =>
      parseNetworkManifest(withSource(tor, { url_template: 'https://example.org/{yyyy-mm}' })),
    ).toThrow();
  });

  it('refuses a source id given twice', () => {
    expect(() =>
      parseNetworkManifest({ ...base, sources: [...base.sources, base.sources[0]] }),
    ).toThrow();
  });
});
