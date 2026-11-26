import { describe, expect, it } from 'vitest';
import { writeMmdb } from '../testing/mmdb-writer.js';
import { sandboxNetworkBundle } from '../testing/sandbox-network.js';
import { parseAddress } from './address.js';
import { NetworkParseError } from './errors.js';
import { IntervalSet } from './interval-set.js';
import { MmdbSnapshot } from './mmdb.js';
import { SandboxNetwork } from './sandbox.js';
import { NETWORK_PARSERS, loadSnapshot, normalisePublication } from './snapshot.js';
import { TorExitSet } from './tor-exit-list.js';

function key(text: string): bigint {
  const parsed = parseAddress(text);
  if (parsed === null) {
    throw new Error('test address does not parse');
  }
  return parsed.key;
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof NetworkParseError) {
      return error.code;
    }
    throw error;
  }
  return undefined;
}

const bytes = (value: unknown) =>
  Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));

const AWS = {
  syncToken: '1793107625',
  createDate: '2026-10-27-13-27-05',
  prefixes: [
    {
      ip_prefix: '198.51.100.0/24',
      region: 'GLOBAL',
      service: 'AMAZON',
      network_border_group: 'GLOBAL',
    },
    {
      ip_prefix: '198.51.100.0/26',
      region: 'us-east-1',
      service: 'EC2',
      network_border_group: 'us-east-1',
    },
  ],
  ipv6_prefixes: [
    {
      ipv6_prefix: '2001:db8:a::/48',
      region: 'GLOBAL',
      service: 'AMAZON',
      network_border_group: 'GLOBAL',
    },
  ],
};

describe('normalisePublication and loadSnapshot (C92.3)', () => {
  it('names a parser for every publisher format the manifest uses', () => {
    expect(NETWORK_PARSERS).toEqual([
      'mmdb-country',
      'mmdb-city',
      'mmdb-asn',
      'tordnsel-exit-addresses',
      'aws-ip-ranges',
      'gcp-cloud-json',
      'oracle-public-ip-ranges',
      'cloudflare-ips-api',
      'prefix-list',
      'rfc8805-geofeed',
      'azure-service-tags',
      'openverify-sandbox-network',
    ]);
  });

  it('stores a range file as the canonical JSON of its merged intervals, and loads it back', () => {
    const publication = normalisePublication('aws-ip-ranges', bytes(AWS));
    expect(publication).toMatchObject({ kind: 'ranges', mmdbRole: null, entryCount: 3 });
    expect(publication.publishedAt?.toISOString()).toBe('2026-10-27T13:27:05.000Z');
    expect(publication.coverage).toEqual({ ipv4: 256n, ipv6: 1n << 80n });
    expect(publication.rangeStats).toMatchObject({
      prefixes: 3,
      shortestIpv4Prefix: 24,
      shortestIpv6Prefix: 48,
    });
    const stored = JSON.parse(publication.bytes.toString('utf8')) as Record<string, unknown>;
    expect(stored).toMatchObject({
      format: 'openverify-network-ranges',
      version: 1,
      'published-at': '2026-10-27T13:27:05.000Z',
    });
    // The same publication with its members reordered stores the same bytes.
    const reordered = normalisePublication(
      'aws-ip-ranges',
      bytes({ ...AWS, prefixes: [...AWS.prefixes].reverse() }),
    );
    expect(reordered.bytes.equals(publication.bytes)).toBe(true);
    const loaded = loadSnapshot('ranges', publication.bytes);
    expect(loaded).toBeInstanceOf(IntervalSet);
    expect((loaded as IntervalSet<unknown>).lookup(key('198.51.100.1'))).toHaveLength(2);
    expect(JSON.stringify(loaded)).toBe(JSON.stringify(publication.snapshot));
  });

  it('takes a provider label for a geofeed and a prefix list', () => {
    const geofeed = normalisePublication('rfc8805-geofeed', bytes('203.0.113.0/24,ZZ\n'), {
      provider: 'example-cloud',
    });
    expect(
      (geofeed.snapshot as IntervalSet<{ provider: string }>).lookup(key('203.0.113.1'))[0]
        ?.provider,
    ).toBe('example-cloud');
    expect(() => normalisePublication('prefix-list', bytes('203.0.113.0/24\n'))).toThrow(
      RangeError,
    );
    for (const parser of [
      'gcp-cloud-json',
      'oracle-public-ip-ranges',
      'cloudflare-ips-api',
      'azure-service-tags',
    ] as const) {
      expect(() => normalisePublication(parser, bytes('{}')), parser).toThrow(NetworkParseError);
    }
  });

  it('stores an exit list as its canonical exit set', () => {
    const list =
      'ExitNode ' +
      'A'.repeat(40) +
      '\nPublished 2026-10-27 09:00:00\nLastStatus 2026-10-27 16:00:00\nExitAddress 192.0.2.10 2026-10-27 16:01:00\n';
    const publication = normalisePublication('tordnsel-exit-addresses', bytes(list));
    expect(publication).toMatchObject({
      kind: 'tor-exits',
      entryCount: 1,
      coverage: null,
      rangeStats: null,
    });
    const loaded = loadSnapshot('tor-exits', publication.bytes);
    expect(loaded).toBeInstanceOf(TorExitSet);
    expect((loaded as TorExitSet).listed(key('192.0.2.10'), 24)).toBe(true);
  });

  it('stores an MMDB as published, after its whole-file check', () => {
    const file = writeMmdb({
      databaseType: 'DBIP-ASN-Lite (compat=GeoLite2-ASN)',
      buildEpoch: new Date('2026-10-01T01:41:36Z'),
      entries: [{ network: '198.51.100.0/24', data: { autonomous_system_number: 64501 } }],
    });
    const publication = normalisePublication('mmdb-asn', file);
    expect(publication).toMatchObject({
      kind: 'mmdb',
      mmdbRole: 'asn',
      entryCount: 1,
      coverage: null,
    });
    expect(publication.bytes.equals(file)).toBe(true);
    expect(publication.publishedAt?.toISOString()).toBe('2026-10-01T01:41:36.000Z');
    const loaded = loadSnapshot('mmdb', publication.bytes, 'asn');
    expect(loaded).toBeInstanceOf(MmdbSnapshot);
    expect(codeOf(() => normalisePublication('mmdb-country', file))).toBe('mmdb');
    expect(() => loadSnapshot('mmdb', file)).toThrow(RangeError);
  });

  it('stores the sandbox bundle as published', () => {
    const bundle = sandboxNetworkBundle();
    const publication = normalisePublication('openverify-sandbox-network', bundle);
    expect(publication.kind).toBe('sandbox');
    expect(publication.bytes.equals(bundle)).toBe(true);
    expect(loadSnapshot('sandbox', bundle)).toBeInstanceOf(SandboxNetwork);
  });

  it('refuses a stored object that is not canonical', () => {
    const publication = normalisePublication('aws-ip-ranges', bytes(AWS));
    const pretty = Buffer.from(
      JSON.stringify(JSON.parse(publication.bytes.toString('utf8')), null, 2),
    );
    expect(codeOf(() => loadSnapshot('ranges', pretty))).toBe('format');
    expect(codeOf(() => loadSnapshot('ranges', bytes({ format: 'other', version: 1 })))).toBe(
      'format',
    );
    expect(
      codeOf(() =>
        loadSnapshot('tor-exits', bytes({ format: 'openverify-tor-exits', version: 1 })),
      ),
    ).toBe('format');
    const exits = normalisePublication(
      'tordnsel-exit-addresses',
      bytes(
        'ExitNode ' +
          'B'.repeat(40) +
          '\nPublished 2026-10-27 09:00:00\nLastStatus 2026-10-27 16:00:00\n',
      ),
    );
    const prettyExits = Buffer.from(
      JSON.stringify(JSON.parse(exits.bytes.toString('utf8')), null, 1),
    );
    expect(codeOf(() => loadSnapshot('tor-exits', prettyExits))).toBe('format');
  });
});
