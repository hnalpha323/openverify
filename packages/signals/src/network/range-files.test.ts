import { describe, expect, it } from 'vitest';
import { parseAddress } from './address.js';
import { NetworkParseError } from './errors.js';
import {
  parseAwsIpRanges,
  parseAzureServiceTags,
  parseCloudflareIpsApi,
  parseGeofeed,
  parseGoogleCloudRanges,
  parseOracleIpRanges,
  parsePrefixList,
  type RangePublication,
} from './range-files.js';

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

function json(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value));
}

function services(publication: RangePublication, address: string): (string | null)[] {
  return publication.ranges.lookup(key(address)).map((attributes) => attributes.service);
}

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
      region: 'eu-west-1',
      service: 'AMAZON',
      network_border_group: 'eu-west-1',
    },
  ],
};

describe('parseAwsIpRanges (C92.3)', () => {
  it('reads both families with service and region, dated by syncToken', () => {
    const publication = parseAwsIpRanges(json(AWS));
    expect(publication.publishedAt?.toISOString()).toBe('2026-10-27T13:27:05.000Z');
    expect(services(publication, '198.51.100.5')).toEqual(['AMAZON', 'EC2']);
    expect(publication.ranges.lookup(key('198.51.100.5'))).toContainEqual({
      provider: 'aws',
      service: 'EC2',
      region: 'us-east-1',
    });
    expect(services(publication, '198.51.100.200')).toEqual(['AMAZON']);
    expect(services(publication, '2001:db8:a:1::1')).toEqual(['AMAZON']);
    expect(publication.stats).toEqual({
      prefixes: 3,
      ipv4Prefixes: 2,
      ipv6Prefixes: 1,
      shortestIpv4Prefix: 24,
      shortestIpv6Prefix: 48,
    });
  });

  it('tolerates members it does not read, and takes another provider label', () => {
    const publication = parseAwsIpRanges(json({ ...AWS, futureMember: [1] }), {
      provider: 'aws-gov',
    });
    expect(publication.ranges.lookup(key('198.51.100.200'))[0]?.provider).toBe('aws-gov');
  });

  it('refuses a changed shape, a prefix of the wrong family, host bits and bad text', () => {
    const cases: [string, unknown][] = [
      ['format', { ...AWS, syncToken: undefined }],
      ['time', { ...AWS, syncToken: '17931O7625' }],
      ['format', { ...AWS, prefixes: 'none' }],
      ['format', { ...AWS, prefixes: [{ ...AWS.prefixes[0], ip_prefix: '2001:db8::/32' }] }],
      [
        'format',
        { ...AWS, ipv6_prefixes: [{ ...AWS.ipv6_prefixes[0], ipv6_prefix: '192.0.2.0/24' }] },
      ],
      ['address', { ...AWS, prefixes: [{ ...AWS.prefixes[0], ip_prefix: '198.51.100.1/24' }] }],
      ['format', { ...AWS, prefixes: [{ ...AWS.prefixes[0], service: 7 }] }],
      ['format', { ...AWS, prefixes: [{ ...AWS.prefixes[0], service: 'S'.repeat(65) }] }],
      ['format', { ...AWS, prefixes: [{ ...AWS.prefixes[0], region: 'line\nbreak' }] }],
      ['format', [AWS]],
    ];
    for (const [code, value] of cases) {
      expect(
        codeOf(() => parseAwsIpRanges(json(value))),
        JSON.stringify(value),
      ).toBe(code);
    }
    expect(codeOf(() => parseAwsIpRanges('{"syncToken":'))).toBe('malformed');
    expect(codeOf(() => parseAwsIpRanges(Uint8Array.from([0x7b, 0xff, 0x7d])))).toBe('encoding');
  });
});

describe('parseGoogleCloudRanges (C92.3)', () => {
  const GOOGLE = {
    syncToken: '1793110333116',
    creationTime: '2026-10-27T14:12:13.116812',
    prefixes: [
      { ipv4Prefix: '203.0.113.0/25', service: 'Google Cloud', scope: 'us-east1' },
      { ipv6Prefix: '2001:db8:b::/48', service: 'Google Cloud', scope: 'global' },
    ],
  };

  it('reads either prefix member, dated by syncToken in milliseconds', () => {
    const publication = parseGoogleCloudRanges(json(GOOGLE));
    expect(publication.publishedAt?.toISOString()).toBe('2026-10-27T14:12:13.116Z');
    expect(publication.ranges.lookup(key('203.0.113.7'))).toEqual([
      { provider: 'google-cloud', service: 'Google Cloud', region: 'us-east1' },
    ]);
    expect(publication.ranges.has(key('2001:db8:b::9'))).toBe(true);
    expect(publication.ranges.has(key('203.0.113.200'))).toBe(false);
  });

  it('refuses an item with both prefixes or neither', () => {
    for (const prefix of [
      {
        ipv4Prefix: '203.0.113.0/25',
        ipv6Prefix: '2001:db8:b::/48',
        service: 'Google Cloud',
        scope: 'x',
      },
      { service: 'Google Cloud', scope: 'x' },
    ]) {
      expect(codeOf(() => parseGoogleCloudRanges(json({ ...GOOGLE, prefixes: [prefix] })))).toBe(
        'format',
      );
    }
    expect(codeOf(() => parseGoogleCloudRanges(json({ ...GOOGLE, syncToken: 7 })))).toBe('format');
  });
});

describe('parseOracleIpRanges (C92.3)', () => {
  const ORACLE = {
    last_updated_timestamp: '2026-08-25T08:06:24.123456',
    regions: [
      {
        region: 'example-region-1',
        cidrs: [
          { cidr: '192.0.2.128/25', tags: ['OSN', 'OCI'] },
          { cidr: '192.0.2.64/26', tags: [] },
        ],
        ipv6_cidrs: [{ cidr: '2001:db8:c::/48', tags: ['OCI'] }],
      },
    ],
  };

  it('reads the regions and their tags, dated by last_updated_timestamp in UTC', () => {
    const publication = parseOracleIpRanges(json(ORACLE));
    expect(publication.publishedAt?.toISOString()).toBe('2026-08-25T08:06:24.123Z');
    expect(publication.ranges.lookup(key('192.0.2.200'))).toEqual([
      { provider: 'oracle-cloud', service: 'OCI,OSN', region: 'example-region-1' },
    ]);
    expect(services(publication, '192.0.2.70')).toEqual([null]);
    expect(services(publication, '2001:db8:c::1')).toEqual(['OCI']);
    expect(
      parseOracleIpRanges(
        json({ ...ORACLE, last_updated_timestamp: '2026-08-25T08:06:24Z' }),
      ).publishedAt?.toISOString(),
    ).toBe('2026-08-25T08:06:24.000Z');
  });

  it('refuses a bad timestamp or a missing cidr list', () => {
    expect(
      codeOf(() => parseOracleIpRanges(json({ ...ORACLE, last_updated_timestamp: '25/08/2026' }))),
    ).toBe('time');
    expect(
      codeOf(() =>
        parseOracleIpRanges(json({ ...ORACLE, regions: [{ region: 'example-region-1' }] })),
      ),
    ).toBe('format');
  });
});

describe('parseCloudflareIpsApi and parsePrefixList (C92.3)', () => {
  it('reads the API answer, which carries no publication time', () => {
    const publication = parseCloudflareIpsApi(
      json({
        result: { ipv4_cidrs: ['198.51.100.128/25'], ipv6_cidrs: ['2001:db8:d::/48'], etag: 'abc' },
        success: true,
        errors: [],
        messages: [],
      }),
    );
    expect(publication.publishedAt).toBeNull();
    expect(publication.ranges.lookup(key('198.51.100.130'))).toEqual([
      { provider: 'cloudflare', service: null, region: null },
    ]);
    expect(publication.stats.prefixes).toBe(2);
    expect(
      codeOf(() =>
        parseCloudflareIpsApi(json({ result: { ipv4_cidrs: [], ipv6_cidrs: [] }, success: false })),
      ),
    ).toBe('format');
  });

  it('reads a plain prefix list, blank lines allowed, anything else refused', () => {
    const publication = parsePrefixList('198.51.100.128/25\n\n2001:db8:d::/48\n', {
      provider: 'cloudflare',
    });
    expect(publication.stats).toMatchObject({ ipv4Prefixes: 1, ipv6Prefixes: 1 });
    expect(
      codeOf(() => parsePrefixList('# heading\n198.51.100.128/25\n', { provider: 'cloudflare' })),
    ).toBe('address');
  });
});

describe('parseGeofeed (C92.3: RFC 8805, the relay egress list)', () => {
  it('reads prefixes with their country and region, skipping comments', () => {
    const feed = [
      '# Example geofeed, RFC 8805',
      '# Last modified: 2026-10-27 10:00:05',
      '203.0.113.0/26,ZZ,ZZ-01,"Example City, North",00000',
      '203.0.113.64/26,ZZ,,,',
      '2001:db8:e::/48,ZZ',
      '2001:db8:f::/48',
      '',
    ].join('\n');
    const publication = parseGeofeed(feed, { provider: 'example-cloud' });
    expect(publication.publishedAt?.toISOString()).toBe('2026-10-27T10:00:05.000Z');
    expect(publication.ranges.lookup(key('203.0.113.1'))).toEqual([
      { provider: 'example-cloud', service: null, region: 'ZZ-01' },
    ]);
    expect(publication.ranges.lookup(key('203.0.113.70'))[0]?.region).toBe('ZZ');
    expect(publication.ranges.lookup(key('2001:db8:f::1'))[0]?.region).toBeNull();
    expect(publication.stats.prefixes).toBe(4);
  });

  it('dates a feed without a stamp null, and refuses a bad country, region or quoting', () => {
    expect(
      parseGeofeed('203.0.113.0/26,ZZ\n', { provider: 'example-cloud' }).publishedAt,
    ).toBeNull();
    // Country and region codes are read case-insensitively and kept in upper case.
    expect(
      parseGeofeed('203.0.113.0/26,zz,zz-01\n', { provider: 'example-cloud' }).ranges.lookup(
        key('203.0.113.1'),
      )[0]?.region,
    ).toBe('ZZ-01');
    for (const line of [
      '203.0.113.0/26,Z1',
      '203.0.113.0/26,ZZ,01',
      '203.0.113.0/26,ZZ,ZZ-01,"open',
      'not-a-prefix,ZZ',
    ]) {
      expect(['format', 'address']).toContain(
        codeOf(() => parseGeofeed(`${line}\n`, { provider: 'example-cloud' })),
      );
    }
  });
});

describe('parseAzureServiceTags (C92.3)', () => {
  it('reads overlapping tags with their service and region', () => {
    const publication = parseAzureServiceTags(
      json({
        changeNumber: 423,
        cloud: 'Public',
        values: [
          {
            name: 'AzureCloud',
            id: 'AzureCloud',
            properties: {
              changeNumber: 1,
              region: '',
              regionId: 0,
              platform: 'Azure',
              systemService: '',
              addressPrefixes: ['192.0.2.0/24', '2001:db8:1::/48'],
            },
          },
          {
            name: 'Storage.ExampleRegion',
            id: 'Storage.ExampleRegion',
            properties: {
              changeNumber: 2,
              region: 'exampleregion',
              regionId: 9,
              platform: 'Azure',
              systemService: 'AzureStorage',
              addressPrefixes: ['192.0.2.32/27'],
            },
          },
        ],
      }),
    );
    expect(publication.publishedAt).toBeNull();
    // Values come in their canonical JSON order.
    expect(publication.ranges.lookup(key('192.0.2.40'))).toEqual([
      { provider: 'azure', service: 'AzureStorage', region: 'exampleregion' },
      { provider: 'azure', service: null, region: null },
    ]);
    expect(publication.stats).toMatchObject({ prefixes: 3, shortestIpv4Prefix: 24 });
    expect(
      codeOf(() =>
        parseAzureServiceTags(json({ changeNumber: 1, cloud: 'Public', values: [{ name: 'x' }] })),
      ),
    ).toBe('format');
  });
});
