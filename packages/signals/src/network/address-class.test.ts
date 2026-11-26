import { describe, expect, it } from 'vitest';
import { seededRandom } from '../testing/random.js';
import {
  IPV4_MAPPED_END,
  IPV4_MAPPED_START,
  MAX_KEY,
  formatKey,
  parseAddress,
  parseNetwork,
} from './address.js';
import { SPECIAL_BLOCKS, classifyAddress, type AddressClass } from './address-class.js';

function classOf(text: string): AddressClass {
  const parsed = parseAddress(text);
  if (parsed === null) {
    throw new Error(`test address does not parse: ${text}`);
  }
  return classifyAddress(parsed);
}

/** The brute-force answer over the table, with C93.1's rule for IPv6 outside 2000::/3. */
function bruteForce(key: bigint): AddressClass {
  const ipv4 = key >= IPV4_MAPPED_START && key <= IPV4_MAPPED_END;
  for (const block of SPECIAL_BLOCKS) {
    const network = parseNetwork(block.network);
    if ((network.family === 4) === ipv4 && key >= network.start && key <= network.end) {
      return block.class;
    }
  }
  if (!ipv4 && key >> 125n !== 1n) {
    return 'not_public';
  }
  return 'public';
}

describe('classifyAddress (C93.1)', () => {
  it('names the four documentation ranges, and only them, documentation', () => {
    for (const text of [
      '192.0.2.1',
      '198.51.100.200',
      '203.0.113.255',
      '2001:db8::1',
      '2001:db8:ffff::9',
    ]) {
      expect(classOf(text), text).toBe('documentation');
    }
    const documentation = SPECIAL_BLOCKS.filter((block) => block.class === 'documentation').map(
      (block) => block.network,
    );
    expect(documentation.sort()).toEqual([
      '192.0.2.0/24',
      '198.51.100.0/24',
      '2001:db8::/32',
      '203.0.113.0/24',
    ]);
  });

  it('holds the private, loopback, link-local and carrier-grade NAT blocks C93.1 names', () => {
    const networks = new Set(SPECIAL_BLOCKS.map((block) => block.network));
    for (const network of [
      '10.0.0.0/8',
      '172.16.0.0/12',
      '192.168.0.0/16',
      '127.0.0.0/8',
      '169.254.0.0/16',
      '100.64.0.0/10',
      'fc00::/7',
      'fe80::/10',
      '::1/128',
    ]) {
      expect(networks.has(network), network).toBe(true);
    }
    for (const block of SPECIAL_BLOCKS) {
      expect(block.source.length, block.network).toBeGreaterThan(0);
      expect(() => parseNetwork(block.network), block.network).not.toThrow();
    }
  });

  it('classifies the first and last address of every block by its class (derived, never typed)', () => {
    for (const block of SPECIAL_BLOCKS) {
      const network = parseNetwork(block.network);
      for (const key of [network.start, network.end]) {
        const parsed = parseAddress(formatKey(key));
        expect(parsed && classifyAddress(parsed), block.network).toBe(block.class);
      }
    }
  });

  it('answers not_public for IPv6 outside the global unicast space 2000::/3', () => {
    const parsed = parseAddress(formatKey(0x4000n << 112n));
    expect(parsed && classifyAddress(parsed)).toBe('not_public');
  });

  it('agrees with the table for random keys of both families (property)', () => {
    const random = seededRandom('address-class');
    let publicSeen = 0;
    for (let i = 0; i < 5_000; i += 1) {
      const key =
        i % 2 === 0
          ? random.bigint(IPV4_MAPPED_START, IPV4_MAPPED_END)
          : random.bigint(0n, MAX_KEY);
      const parsed = parseAddress(formatKey(key));
      expect(parsed).not.toBeNull();
      if (parsed === null) {
        continue;
      }
      const expected = bruteForce(parsed.key);
      expect(classifyAddress(parsed)).toBe(expected);
      publicSeen += expected === 'public' ? 1 : 0;
    }
    expect(publicSeen).toBeGreaterThan(0);
  });
});
