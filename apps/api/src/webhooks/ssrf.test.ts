import { describe, expect, it } from 'vitest';
import {
  ALLOW_PRIVATE_NETWORKS_ENV,
  DEFAULT_NETWORK_POLICY,
  WebhookNetworkConfigError,
  classifyAddress,
  embeddedIPv4,
  isAddressAllowed,
  webhookNetworkPolicyFromEnv,
  type AddressCategory,
} from './ssrf.js';

/**
 * Every row: address, category, allowed by default, allowed when private networks are allowed
 * (`OPENVERIFY_WEBHOOK_ALLOW_PRIVATE_NETWORKS=true`, refused in production).
 */
const TABLE: readonly (readonly [string, AddressCategory, boolean, boolean])[] = [
  // IPv4 public
  ['8.8.8.8', 'public', true, true],
  ['1.1.1.1', 'public', true, true],
  ['93.184.215.14', 'public', true, true],
  ['100.63.255.255', 'public', true, true],
  ['100.128.0.0', 'public', true, true],
  ['172.15.255.255', 'public', true, true],
  ['172.32.0.0', 'public', true, true],
  ['169.253.255.255', 'public', true, true],
  ['192.167.255.255', 'public', true, true],
  ['223.255.255.255', 'public', true, true],
  // IPv4 "this network" and unspecified
  ['0.0.0.0', 'unspecified', false, false],
  ['0.1.2.3', 'unspecified', false, false],
  // IPv4 loopback
  ['127.0.0.1', 'loopback', false, true],
  ['127.255.255.254', 'loopback', false, true],
  // IPv4 private (RFC 1918)
  ['10.0.0.1', 'private', false, true],
  ['10.255.255.255', 'private', false, true],
  ['172.16.0.1', 'private', false, true],
  ['172.31.255.255', 'private', false, true],
  ['192.168.0.1', 'private', false, true],
  ['192.168.255.255', 'private', false, true],
  // IPv4 CGNAT (RFC 6598)
  ['100.64.0.1', 'cgnat', false, true],
  ['100.127.255.255', 'cgnat', false, true],
  // IPv4 link-local
  ['169.254.0.1', 'link_local', false, false],
  ['169.254.255.255', 'link_local', false, false],
  // Cloud metadata endpoints, never allowed
  ['169.254.169.254', 'metadata', false, false],
  ['169.254.170.2', 'metadata', false, false],
  ['100.100.100.200', 'metadata', false, false],
  ['168.63.129.16', 'metadata', false, false],
  ['192.0.0.192', 'metadata', false, false],
  // IPv4 special-purpose
  ['192.0.0.1', 'reserved', false, false],
  ['192.0.2.10', 'documentation', false, false],
  ['198.51.100.7', 'documentation', false, false],
  ['203.0.113.9', 'documentation', false, false],
  ['192.88.99.1', 'reserved', false, false],
  ['198.18.0.1', 'benchmarking', false, false],
  ['198.19.255.255', 'benchmarking', false, false],
  ['224.0.0.1', 'multicast', false, false],
  ['239.255.255.250', 'multicast', false, false],
  ['240.0.0.1', 'reserved', false, false],
  ['255.255.255.254', 'reserved', false, false],
  ['255.255.255.255', 'broadcast', false, false],
  // IPv6 public
  ['2606:4700:4700::1111', 'public', true, true],
  ['2001:4860:4860::8888', 'public', true, true],
  ['2a00:1450:4001:80b::200e', 'public', true, true],
  // IPv6 unspecified and loopback
  ['::', 'unspecified', false, false],
  ['::1', 'loopback', false, true],
  ['0:0:0:0:0:0:0:1', 'loopback', false, true],
  // IPv4-mapped IPv6 takes the category of the embedded IPv4 address
  ['::ffff:127.0.0.1', 'loopback', false, true],
  ['::ffff:7f00:1', 'loopback', false, true],
  ['::ffff:10.1.2.3', 'private', false, true],
  ['::ffff:169.254.169.254', 'metadata', false, false],
  ['::ffff:0.0.0.0', 'unspecified', false, false],
  ['::ffff:8.8.8.8', 'public', true, true],
  ['0:0:0:0:0:ffff:c0a8:101', 'private', false, true],
  // NAT64 well-known prefix embeds an IPv4 address too
  ['64:ff9b::7f00:1', 'loopback', false, true],
  ['64:ff9b::a9fe:a9fe', 'metadata', false, false],
  ['64:ff9b::808:808', 'public', true, true],
  // IPv4-compatible (deprecated) and other non-global IPv6
  ['::127.0.0.1', 'reserved', false, false],
  ['::a00:1', 'reserved', false, false],
  ['64:ff9b:1::1', 'reserved', false, false],
  ['100::1', 'reserved', false, false],
  ['2001::1', 'reserved', false, false],
  ['2001:2::1', 'reserved', false, false],
  ['2001:db8::1', 'documentation', false, false],
  ['3fff::1', 'documentation', false, false],
  ['2002:7f00:1::1', 'reserved', false, false],
  ['2002:808:808::1', 'reserved', false, false],
  ['5f00::1', 'reserved', false, false],
  ['4000::1', 'reserved', false, false],
  ['1000::1', 'reserved', false, false],
  // IPv6 unique local (private), with cloud metadata exceptions
  ['fc00::1', 'private', false, true],
  ['fd12:3456:789a::1', 'private', false, true],
  ['fd00:ec2::254', 'metadata', false, false],
  ['fd00:ec2::23', 'metadata', false, false],
  ['fd20:ce::254', 'metadata', false, false],
  // IPv6 link-local, site-local and multicast
  ['fe80::1', 'link_local', false, false],
  ['fe80::1%eth0', 'link_local', false, false],
  ['febf:ffff::1', 'link_local', false, false],
  ['fec0::1', 'reserved', false, false],
  ['ff02::1', 'multicast', false, false],
  ['ff05::1:3', 'multicast', false, false],
];

describe('classifyAddress', () => {
  it.each(TABLE)('%s is %s', (address, category) => {
    expect(classifyAddress(address)).toBe(category);
  });

  it.each(['', 'localhost', 'example.com', '127.1', '256.0.0.1', '1.2.3', '::ffff::1', '[::1]'])(
    'treats %j as invalid',
    (address) => {
      expect(classifyAddress(address)).toBe('invalid');
    },
  );
});

describe('isAddressAllowed', () => {
  it.each(TABLE)(
    '%s (%s): allowed %s by default, %s with private networks allowed',
    (address, _category, allowedByDefault, allowedWithPrivate) => {
      expect(isAddressAllowed(address, { allowPrivateNetworks: false })).toBe(allowedByDefault);
      expect(isAddressAllowed(address, { allowPrivateNetworks: true })).toBe(allowedWithPrivate);
    },
  );

  it('never allows an invalid address', () => {
    expect(isAddressAllowed('not-an-ip', { allowPrivateNetworks: true })).toBe(false);
  });
});

describe('webhookNetworkPolicyFromEnv', () => {
  it('names the environment variable', () => {
    expect(ALLOW_PRIVATE_NETWORKS_ENV).toBe('OPENVERIFY_WEBHOOK_ALLOW_PRIVATE_NETWORKS');
  });

  it.each([undefined, '', 'false', ' false '])(
    'blocks private networks when the flag is %j',
    (value) => {
      for (const mode of ['production', 'development', 'test'] as const) {
        expect(webhookNetworkPolicyFromEnv({ [ALLOW_PRIVATE_NETWORKS_ENV]: value }, mode)).toEqual({
          allowPrivateNetworks: false,
        });
      }
    },
  );

  it.each(['development', 'test'] as const)('allows private networks in %s mode', (mode) => {
    expect(webhookNetworkPolicyFromEnv({ [ALLOW_PRIVATE_NETWORKS_ENV]: 'true' }, mode)).toEqual({
      allowPrivateNetworks: true,
    });
  });

  it('refuses to allow private networks in production mode', () => {
    expect(() =>
      webhookNetworkPolicyFromEnv({ [ALLOW_PRIVATE_NETWORKS_ENV]: 'true' }, 'production'),
    ).toThrow(WebhookNetworkConfigError);
    expect(() =>
      webhookNetworkPolicyFromEnv({ [ALLOW_PRIVATE_NETWORKS_ENV]: 'true' }, 'production'),
    ).toThrow(/production/);
  });

  it.each(['1', 'yes', 'TRUE', 'True', 'on'])('rejects the ambiguous value %j', (value) => {
    expect(() =>
      webhookNetworkPolicyFromEnv({ [ALLOW_PRIVATE_NETWORKS_ENV]: value }, 'development'),
    ).toThrow(WebhookNetworkConfigError);
  });
});

describe('the additive policy (C124.2)', () => {
  it('states today’s behaviour as its defaults', () => {
    expect(DEFAULT_NETWORK_POLICY).toEqual({
      allowPrivateNetworks: false,
      allowLoopback: false,
      allowCidrs: [],
      nat64Prefixes: [],
    });
  });

  it.each(TABLE)('answers %s as a policy of one member does', (address) => {
    expect(isAddressAllowed(address, DEFAULT_NETWORK_POLICY)).toBe(
      isAddressAllowed(address, { allowPrivateNetworks: false }),
    );
  });

  it('leaves the webhook guard as it was: only the new members lift anything', () => {
    const policy = { allowPrivateNetworks: false };

    expect(isAddressAllowed('127.0.0.1', policy)).toBe(false);
    expect(isAddressAllowed('10.0.0.1', policy)).toBe(false);
  });
});

describe('allowLoopback (C124.3)', () => {
  const policy = { allowPrivateNetworks: false, allowLoopback: true };

  it.each(['127.0.0.1', '127.255.255.254', '::1', '::ffff:127.0.0.1'])(
    'admits the loopback address %s',
    (address) => {
      expect(isAddressAllowed(address, policy)).toBe(true);
    },
  );

  it.each(['10.0.0.1', '100.64.0.1', '169.254.169.254', '169.254.0.1', '0.0.0.0', 'fc00::1'])(
    'admits nothing else: %s',
    (address) => {
      expect(isAddressAllowed(address, policy)).toBe(false);
    },
  );
});

describe('allowCidrs (C124.3)', () => {
  const policy = {
    allowPrivateNetworks: false,
    allowCidrs: ['10.1.0.0/16', '100.64.1.0/24', 'fd12:3456::/32'],
  };

  it.each(['10.1.2.3', '100.64.1.9', 'fd12:3456::1', '::ffff:10.1.2.3', '::ffff:a01:203'])(
    'admits %s, inside a listed block, a mapped address as its embedded IPv4',
    (address) => {
      expect(isAddressAllowed(address, policy)).toBe(true);
    },
  );

  it.each(['10.2.0.1', '100.64.2.1', 'fd12:3457::1', '192.168.0.1', '::ffff:10.2.0.1'])(
    'leaves %s, outside every block, refused',
    (address) => {
      expect(isAddressAllowed(address, policy)).toBe(false);
    },
  );

  it.each(['127.0.0.1', '169.254.169.254', '100.100.100.200', 'fd00:ec2::254'])(
    'never lifts %s, whatever a stored list holds, because only private and CGNAT space is lifted',
    (address) => {
      const wide = {
        allowPrivateNetworks: false,
        allowCidrs: ['0.0.0.0/0', '::/0', '169.254.0.0/16', '100.64.0.0/10', 'fd00::/8'],
      };

      expect(isAddressAllowed(address, wide)).toBe(false);
    },
  );

  it('ignores an entry that is no CIDR', () => {
    const odd = { allowPrivateNetworks: false, allowCidrs: ['10.1.0.0', 'nonsense/8'] };

    expect(isAddressAllowed('10.1.0.1', odd)).toBe(false);
  });
});

describe('nat64Prefixes (C124.3, RFC 6052)', () => {
  it.each([
    // RFC 6052 section 2.4's table embeds 192.0.2.33 at each length.
    ['2001:db8:c000:221::/32', '2001:db8::/32'],
    ['2001:db8:1c0:2:21::/40', '2001:db8:100::/40'],
    ['2001:db8:122:c000:2:2100::/48', '2001:db8:122::/48'],
    ['2001:db8:122:3c0:0:221::/56', '2001:db8:122:300::/56'],
    ['2001:db8:122:344:c0:2:2100:0/64', '2001:db8:122:344::/64'],
    ['2001:db8:122:344::c000:221/96', '2001:db8:122:344::/96'],
  ])('reads the embedded IPv4 of %s under %s', (written, prefix) => {
    const address = written.split('/')[0] ?? '';

    expect(embeddedIPv4(address, prefix)).toBe('192.0.2.33');
  });

  it('takes the category of the embedded IPv4 on a global prefix', () => {
    const nat64Prefixes = ['2a00:db8:64::/96'];

    expect(classifyAddress('2a00:db8:64::a00:1', nat64Prefixes)).toBe('private');
    expect(classifyAddress('2a00:db8:64::a9fe:a9fe', nat64Prefixes)).toBe('metadata');
    expect(classifyAddress('2a00:db8:64::7f00:1', nat64Prefixes)).toBe('loopback');
    expect(classifyAddress('2a00:db8:64::808:808', nat64Prefixes)).toBe('public');
  });

  it('refuses a private IPv4 behind a listed prefix through the policy', () => {
    const policy = { allowPrivateNetworks: false, nat64Prefixes: ['2a00:db8:64::/96'] };

    expect(isAddressAllowed('2a00:db8:64::a00:1', policy)).toBe(false);
    expect(isAddressAllowed('2a00:db8:64::808:808', policy)).toBe(true);
  });

  it('leaves an address outside every prefix as it was', () => {
    expect(classifyAddress('2a00:db8:65::a00:1', ['2a00:db8:64::/96'])).toBe('public');
  });

  it('reads the same address as public with no prefix, which is why the setting exists', () => {
    expect(classifyAddress('2a00:db8:64::a00:1')).toBe('public');
  });
});

describe('the EKS Pod Identity Agent (C124.3)', () => {
  it.each(['169.254.170.23', 'fd00:ec2::23', '::ffff:169.254.170.23'])(
    '%s is metadata, refused before any other rule',
    (address) => {
      expect(classifyAddress(address)).toBe('metadata');
      expect(
        isAddressAllowed(address, {
          allowPrivateNetworks: true,
          allowLoopback: true,
          allowCidrs: ['0.0.0.0/0'],
        }),
      ).toBe(false);
    },
  );
});
