/**
 * Addresses and prefixes as 16-byte keys (plan C92.3, C93.1), over `node:net` with no address
 * library: every address is a 128-bit unsigned key, IPv6 as written and IPv4 as its IPv4-mapped
 * IPv6 form (`::ffff:a.b.c.d`), so one sorted key space holds both families. An IPv4-mapped IPv6
 * address is folded to IPv4 first (C93.1).
 */
import { isIP } from 'node:net';
import { NetworkParseError } from './errors.js';

/** An address as the network lookups take it. */
export interface ParsedAddress {
  readonly family: 4 | 6;
  /** The 128-bit key: IPv4 in the IPv4-mapped space. */
  readonly key: bigint;
  /** Dotted IPv4, or RFC 5952 IPv6. */
  readonly text: string;
}

/** A prefix (or a single address) as a closed interval of keys. */
export interface ParsedNetwork {
  readonly family: 4 | 6;
  readonly start: bigint;
  readonly end: bigint;
  /** The prefix length in the family's own bits (0 to 32, or 0 to 128). */
  readonly prefixLength: number;
}

/** The first key of the IPv4-mapped space (`::ffff:0.0.0.0`). */
export const IPV4_MAPPED_START = 0xffff_0000_0000n;
/** The last key of the IPv4-mapped space (`::ffff:255.255.255.255`). */
export const IPV4_MAPPED_END = 0xffff_ffff_ffffn;
/** The largest key. */
export const MAX_KEY = (1n << 128n) - 1n;

const IPV6_GROUPS = 8;
const HEX_KEY = /^[0-9a-f]{32}$/;
const PREFIX_LENGTH = /^(?:0|[1-9][0-9]{0,2})$/;

function ipv4Value(text: string): bigint {
  let value = 0n;
  for (const part of text.split('.')) {
    value = (value << 8n) | BigInt(Number.parseInt(part, 10));
  }
  return value;
}

/** The 128-bit value of an IPv6 address that `isIP` accepted (no zone index). */
function ipv6Value(text: string): bigint {
  let source = text;
  // An embedded IPv4 tail (`::ffff:192.0.2.1`) becomes two groups.
  const lastColon = source.lastIndexOf(':');
  const tail = source.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = ipv4Value(tail);
    source = `${source.slice(0, lastColon + 1)}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const [head = '', rest] = source.split('::');
  const headGroups = head === '' ? [] : head.split(':');
  const tailGroups = rest === undefined || rest === '' ? [] : rest.split(':');
  const missing = IPV6_GROUPS - headGroups.length - tailGroups.length;
  const groups = [
    ...headGroups,
    ...Array<string>(rest === undefined ? 0 : missing).fill('0'),
    ...tailGroups,
  ];
  let value = 0n;
  for (const group of groups) {
    value = (value << 16n) | BigInt(Number.parseInt(group, 16));
  }
  return value;
}

function inMappedSpace(key: bigint): boolean {
  return key >= IPV4_MAPPED_START && key <= IPV4_MAPPED_END;
}

function formatIpv4(value: bigint): string {
  return [24n, 16n, 8n, 0n].map((shift) => String((value >> shift) & 0xffn)).join('.');
}

/** RFC 5952: lowercase, no leading zeros, the longest run of two or more zero groups as `::`. */
function formatIpv6(key: bigint): string {
  const groups = Array.from({ length: IPV6_GROUPS }, (_, index) =>
    Number((key >> BigInt(16 * (IPV6_GROUPS - 1 - index))) & 0xffffn),
  );
  let bestStart = -1;
  let bestLength = 1;
  for (let index = 0; index < IPV6_GROUPS;) {
    if (groups[index] !== 0) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < IPV6_GROUPS && groups[end] === 0) {
      end += 1;
    }
    if (end - index > bestLength) {
      bestStart = index;
      bestLength = end - index;
    }
    index = end;
  }
  const hex = groups.map((group) => group.toString(16));
  if (bestStart < 0) {
    return hex.join(':');
  }
  const head = hex.slice(0, bestStart).join(':');
  const tail = hex.slice(bestStart + bestLength).join(':');
  return `${head}::${tail}`;
}

function checkKey(key: bigint): void {
  if (key < 0n || key > MAX_KEY) {
    throw new RangeError('a key is a 128-bit unsigned integer');
  }
}

/** Parses one address; `null` for anything else (a zone index, brackets, a prefix, spaces). */
export function parseAddress(text: string): ParsedAddress | null {
  if (text.includes('%')) {
    return null;
  }
  const written = isIP(text);
  if (written === 4) {
    const key = IPV4_MAPPED_START | ipv4Value(text);
    return { family: 4, key, text: formatIpv4(key & 0xffff_ffffn) };
  }
  if (written !== 6) {
    return null;
  }
  const key = ipv6Value(text);
  return { family: familyOfKey(key), key, text: formatKey(key) };
}

/**
 * Parses a prefix (`address/length`) or a single address (a host route).
 * @throws {NetworkParseError} `address` for a malformed prefix, host bits set, or an IPv6 prefix
 * that crosses the IPv4-mapped space without lying inside it.
 */
export function parseNetwork(text: string): ParsedNetwork {
  const slash = text.indexOf('/');
  const addressText = slash < 0 ? text : text.slice(0, slash);
  const lengthText = slash < 0 ? null : text.slice(slash + 1);
  const parsed = parseAddress(addressText);
  if (parsed === null) {
    throw new NetworkParseError('address', 'not an address or prefix');
  }
  const writtenBits = isIP(addressText) === 4 ? 32 : 128;
  if (lengthText !== null && !PREFIX_LENGTH.test(lengthText)) {
    throw new NetworkParseError('address', 'the prefix length is not a plain integer');
  }
  const written = lengthText === null ? writtenBits : Number.parseInt(lengthText, 10);
  if (written > writtenBits) {
    throw new NetworkParseError('address', 'the prefix length is longer than the address');
  }
  const length = written + (128 - writtenBits);
  const hostMask = (1n << BigInt(128 - length)) - 1n;
  if ((parsed.key & hostMask) !== 0n) {
    throw new NetworkParseError('address', 'the prefix has host bits set');
  }
  const start = parsed.key;
  const end = start | hostMask;
  if (inMappedSpace(start) && inMappedSpace(end)) {
    return { family: 4, start, end, prefixLength: length - 96 };
  }
  if (start <= IPV4_MAPPED_END && end >= IPV4_MAPPED_START) {
    throw new NetworkParseError('address', 'an IPv6 prefix crosses the IPv4-mapped space');
  }
  return { family: 6, start, end, prefixLength: length };
}

/** The address a key names, in its family's canonical text. */
export function formatKey(key: bigint): string {
  checkKey(key);
  return inMappedSpace(key) ? formatIpv4(key & 0xffff_ffffn) : formatIpv6(key);
}

/** The family a key belongs to. */
export function familyOfKey(key: bigint): 4 | 6 {
  return inMappedSpace(key) ? 4 : 6;
}

/** A key as 32 lowercase hex digits (the snapshots' form). */
export function keyToHex(key: bigint): string {
  checkKey(key);
  return key.toString(16).padStart(32, '0');
}

/**
 * A key from 32 lowercase hex digits.
 * @throws {NetworkParseError} `format` for anything else.
 */
export function hexToKey(hex: string): bigint {
  if (!HEX_KEY.test(hex)) {
    throw new NetworkParseError('format', 'a key is 32 lowercase hex digits');
  }
  return BigInt(`0x${hex}`);
}
