/**
 * C124.3: one sample address per row of the IANA special-purpose registries as they stood on
 * 2026-10-13 (`iana-ipv4-special-registry`, `iana-ipv6-special-registry`), against what the guard
 * says of it, so an update of a registry is a reviewed change to this table. A row IANA marks globally
 * reachable (AS112, AMT) is public; every row it does not is refused, by its own rule or by the final
 * default. A range that embeds an IPv4 address reads as that address.
 */
import { describe, expect, it } from 'vitest';
import { classifyAddress, isAddressAllowed, type AddressCategory } from './ssrf.js';

const REGISTRY_DATE = '2026-10-13';

type Row = readonly [block: string, sample: string, category: AddressCategory];

const IPV4_ROWS: readonly Row[] = [
  ['0.0.0.0/8', '0.1.0.1', 'unspecified'],
  ['0.0.0.0/32', '0.0.0.0', 'unspecified'],
  ['10.0.0.0/8', '10.20.30.40', 'private'],
  ['100.64.0.0/10', '100.65.0.1', 'cgnat'],
  ['127.0.0.0/8', '127.0.1.1', 'loopback'],
  ['169.254.0.0/16', '169.254.10.1', 'link_local'],
  ['172.16.0.0/12', '172.20.0.1', 'private'],
  ['192.0.0.0/24', '192.0.0.100', 'reserved'],
  ['192.0.0.0/29', '192.0.0.1', 'reserved'],
  ['192.0.0.8/32', '192.0.0.8', 'reserved'],
  ['192.0.0.9/32', '192.0.0.9', 'reserved'],
  ['192.0.0.10/32', '192.0.0.10', 'reserved'],
  ['192.0.0.170/32', '192.0.0.170', 'reserved'],
  ['192.0.0.171/32', '192.0.0.171', 'reserved'],
  ['192.0.2.0/24', '192.0.2.1', 'documentation'],
  ['192.31.196.0/24', '192.31.196.1', 'public'],
  ['192.52.193.0/24', '192.52.193.1', 'public'],
  ['192.88.99.0/24', '192.88.99.1', 'reserved'],
  ['192.168.0.0/16', '192.168.10.1', 'private'],
  ['192.175.48.0/24', '192.175.48.1', 'public'],
  ['198.18.0.0/15', '198.18.5.1', 'benchmarking'],
  ['198.51.100.0/24', '198.51.100.1', 'documentation'],
  ['203.0.113.0/24', '203.0.113.1', 'documentation'],
  ['240.0.0.0/4', '250.0.0.1', 'reserved'],
  ['255.255.255.255/32', '255.255.255.255', 'broadcast'],
];

const IPV6_ROWS: readonly Row[] = [
  ['::1/128', '::1', 'loopback'],
  ['::/128', '::', 'unspecified'],
  ['::ffff:0:0/96', '::ffff:192.168.0.1', 'private'],
  ['64:ff9b::/96', '64:ff9b::a00:1', 'private'],
  ['64:ff9b:1::/48', '64:ff9b:1::1', 'reserved'],
  ['100::/64', '100::1', 'reserved'],
  ['100:0:0:1::/64', '100:0:0:1::1', 'reserved'],
  ['2001::/23', '2001:100::1', 'reserved'],
  ['2001::/32', '2001:0:1::1', 'reserved'],
  ['2001:1::1/128', '2001:1::1', 'reserved'],
  ['2001:1::2/128', '2001:1::2', 'reserved'],
  ['2001:1::3/128', '2001:1::3', 'reserved'],
  ['2001:2::/48', '2001:2::1', 'reserved'],
  ['2001:3::/32', '2001:3::1', 'reserved'],
  ['2001:4:112::/48', '2001:4:112::1', 'reserved'],
  ['2001:10::/28', '2001:10::1', 'reserved'],
  ['2001:20::/28', '2001:20::1', 'reserved'],
  ['2001:30::/28', '2001:30::1', 'reserved'],
  ['2001:db8::/32', '2001:db8::1', 'documentation'],
  ['2002::/16', '2002:a00:1::1', 'reserved'],
  ['2620:4f:8000::/48', '2620:4f:8000::1', 'public'],
  ['3fff::/20', '3fff:100::1', 'documentation'],
  ['5f00::/16', '5f00::1', 'reserved'],
  ['fc00::/7', 'fd00:1::1', 'private'],
  ['fe80::/10', 'fe80::1', 'link_local'],
];

describe(`the IANA special-purpose registries of ${REGISTRY_DATE}`, () => {
  it.each(IPV4_ROWS)('IPv4 %s: %s is %s', (_block, sample, category) => {
    expect(classifyAddress(sample)).toBe(category);
  });

  it.each(IPV6_ROWS)('IPv6 %s: %s is %s', (_block, sample, category) => {
    expect(classifyAddress(sample)).toBe(category);
  });

  it.each([...IPV4_ROWS, ...IPV6_ROWS].filter(([, , category]) => category !== 'public'))(
    'refuses %s by default',
    (_block, sample) => {
      expect(isAddressAllowed(sample, { allowPrivateNetworks: false })).toBe(false);
    },
  );
});
