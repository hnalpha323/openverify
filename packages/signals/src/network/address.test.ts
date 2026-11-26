import { describe, expect, it } from 'vitest';
import { seededRandom } from '../testing/random.js';
import {
  IPV4_MAPPED_END,
  IPV4_MAPPED_START,
  MAX_KEY,
  familyOfKey,
  formatKey,
  hexToKey,
  keyToHex,
  parseAddress,
  parseNetwork,
} from './address.js';
import { NetworkParseError } from './errors.js';

const DOC_V6 = 0x2001_0db8n << 96n;

function addressCode(run: () => unknown): string | undefined {
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

describe('parseAddress (C93.1: IPv4-mapped IPv6 folded to IPv4)', () => {
  it('keys IPv4 in the IPv4-mapped space', () => {
    expect(parseAddress('192.0.2.1')).toEqual({
      family: 4,
      key: 0xffff_c000_0201n,
      text: '192.0.2.1',
    });
  });

  it('folds an IPv4-mapped IPv6 address to IPv4, in either notation', () => {
    for (const text of ['::ffff:192.0.2.1', '::FFFF:C000:201', '0:0:0:0:0:ffff:c000:0201']) {
      expect(parseAddress(text)).toEqual({ family: 4, key: 0xffff_c000_0201n, text: '192.0.2.1' });
    }
  });

  it('keys IPv6 as written and formats it by RFC 5952', () => {
    expect(parseAddress('2001:DB8::A')).toEqual({
      family: 6,
      key: DOC_V6 | 0xan,
      text: '2001:db8::a',
    });
    expect(parseAddress('2001:db8:0:0:1:0:0:1')?.text).toBe('2001:db8::1:0:0:1');
    expect(parseAddress('2001:db8:0:1:1:1:1:1')?.text).toBe('2001:db8:0:1:1:1:1:1');
    expect(parseAddress('2001:db8:1:0:0:1:0:0')?.text).toBe('2001:db8:1::1:0:0');
    expect(parseAddress('2001:db8::198.51.100.1')).toEqual({
      family: 6,
      key: DOC_V6 | 0xc633_6401n,
      text: '2001:db8::c633:6401',
    });
  });

  it('refuses zone indexes, brackets, spaces, leading zeros, prefixes and names', () => {
    for (const text of [
      '2001:db8::1%eth0',
      '2001:db8::1%1',
      '[2001:db8::1]',
      ' 192.0.2.1',
      '192.0.2.1 ',
      '192.0.2.01',
      '192.0.2.1/32',
      '2001:db8::/32',
      '',
      'example.org',
    ]) {
      expect(parseAddress(text), text).toBeNull();
    }
  });

  it('formats every key back to an address that parses to the same key (property)', () => {
    const random = seededRandom('address-round-trip');
    for (let i = 0; i < 2_000; i += 1) {
      const key =
        i % 3 === 0
          ? random.bigint(IPV4_MAPPED_START, IPV4_MAPPED_END)
          : i % 3 === 1
            ? random.bigint(0n, MAX_KEY)
            : // Keys with long zero runs exercise the compression rules.
              random.bigint(0n, 0xffffn) << BigInt(16 * random.int(0, 7));
      const text = formatKey(key);
      const parsed = parseAddress(text);
      expect(parsed?.key, text).toBe(key);
      expect(parsed?.text).toBe(text);
      expect(parsed?.family).toBe(familyOfKey(key));
    }
  });
});

describe('familyOfKey, keyToHex and hexToKey', () => {
  it('names IPv4 only inside the IPv4-mapped space', () => {
    expect(familyOfKey(IPV4_MAPPED_START)).toBe(4);
    expect(familyOfKey(IPV4_MAPPED_END)).toBe(4);
    expect(familyOfKey(IPV4_MAPPED_START - 1n)).toBe(6);
    expect(familyOfKey(IPV4_MAPPED_END + 1n)).toBe(6);
  });

  it('writes 32 lowercase hex digits and reads only that form', () => {
    expect(keyToHex(0xffff_c000_0201n)).toBe('00000000000000000000ffffc0000201');
    expect(keyToHex(MAX_KEY)).toBe('f'.repeat(32));
    expect(hexToKey('00000000000000000000ffffc0000201')).toBe(0xffff_c000_0201n);
    for (const bad of [
      '',
      'ffffc0000201',
      `${'0'.repeat(31)}G`,
      `${'0'.repeat(31)}A`,
      `0x${'0'.repeat(30)}`,
    ]) {
      expect(
        addressCode(() => hexToKey(bad)),
        bad,
      ).toBe('format');
    }
    expect(() => keyToHex(-1n)).toThrow(RangeError);
    expect(() => keyToHex(MAX_KEY + 1n)).toThrow(RangeError);
  });
});

describe('parseNetwork (C92.3: prefixes as closed key intervals)', () => {
  it('reads IPv4 and IPv6 prefixes and single addresses', () => {
    expect(parseNetwork('192.0.2.0/24')).toEqual({
      family: 4,
      start: 0xffff_c000_0200n,
      end: 0xffff_c000_02ffn,
      prefixLength: 24,
    });
    expect(parseNetwork('192.0.2.7')).toEqual({
      family: 4,
      start: 0xffff_c000_0207n,
      end: 0xffff_c000_0207n,
      prefixLength: 32,
    });
    expect(parseNetwork('2001:db8::/32')).toEqual({
      family: 6,
      start: DOC_V6,
      end: DOC_V6 | ((1n << 96n) - 1n),
      prefixLength: 32,
    });
    expect(parseNetwork('2001:db8::5')).toMatchObject({ family: 6, prefixLength: 128 });
  });

  it('folds an IPv4-mapped prefix to IPv4', () => {
    expect(parseNetwork('::ffff:198.51.100.0/120')).toEqual({
      family: 4,
      start: 0xffff_c633_6400n,
      end: 0xffff_c633_64ffn,
      prefixLength: 24,
    });
  });

  it('refuses host bits, bad lengths, zone indexes and IPv6 prefixes over the IPv4 space', () => {
    for (const text of [
      '192.0.2.1/24',
      '192.0.2.0/33',
      '192.0.2.0/024',
      '192.0.2.0/+24',
      '192.0.2.0/',
      '/24',
      '2001:db8::/129',
      '2001:db8::1/64',
      '2001:db8::%1/64',
      '::/80',
      'example.org/24',
    ]) {
      expect(
        addressCode(() => parseNetwork(text)),
        text,
      ).toBe('address');
    }
  });

  it('never names the refused text in its message', () => {
    try {
      parseNetwork('203.0.113.9/24');
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain('203.0.113');
    }
  });
});
