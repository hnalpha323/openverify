/**
 * SSRF guard for webhook deliveries (contract C5). Customers choose webhook URLs, so the
 * dispatcher only connects to public unicast addresses: private, loopback, link-local,
 * CGNAT, multicast, unspecified, documentation, reserved and cloud metadata ranges are
 * refused, for IPv4 and IPv6, including IPv4 addresses embedded in IPv4-mapped and NAT64
 * IPv6 addresses.
 *
 * `OPENVERIFY_WEBHOOK_ALLOW_PRIVATE_NETWORKS=true` lifts the block for loopback, private
 * (RFC 1918, unique local) and CGNAT addresses only, so local development and end-to-end
 * tests can deliver to a receiver on the same machine or Docker network. It is refused in
 * production mode. Metadata, link-local, unspecified and multicast addresses stay blocked.
 *
 * C124.2 (Workflow 8A): the HTTPS action's client reads three more members of the policy, each opt-in
 * per client, so the webhook and outbound clients keep their behaviour. `allowLoopback` lifts loopback
 * alone, `allowCidrs` lifts the listed blocks inside private and CGNAT space alone, and `nat64Prefixes`
 * are read like the well-known prefix, which can only narrow. A metadata address keeps its category
 * whatever a policy holds, because its rule comes first.
 */
import { isIPv4, isIPv6 } from 'node:net';

export type AddressCategory =
  | 'public'
  | 'unspecified'
  | 'loopback'
  | 'private'
  | 'cgnat'
  | 'link_local'
  | 'metadata'
  | 'multicast'
  | 'broadcast'
  | 'documentation'
  | 'benchmarking'
  | 'reserved'
  | 'invalid';

export interface WebhookNetworkPolicy {
  /** Lift the block on loopback, private and CGNAT addresses (never in production). */
  allowPrivateNetworks: boolean;
  /**
   * C124.2, C124.3 (Workflow 8A): the HTTPS action's additive members. Left out, each keeps today's
   * behaviour ({@link DEFAULT_NETWORK_POLICY}). Loopback alone, for a sandbox's local test receivers.
   */
  allowLoopback?: boolean | undefined;
  /** Internal endpoints inside a `private` or `cgnat` block (`workflow-http-private-cidrs`). */
  allowCidrs?: readonly string[] | undefined;
  /** NAT64 network-specific prefixes, whose embedded IPv4 is checked (`OPENVERIFY_NAT64_PREFIXES`). */
  nat64Prefixes?: readonly string[] | undefined;
}

/** C124.2: a policy whose members are all left at today's behaviour. */
export const DEFAULT_NETWORK_POLICY: Readonly<WebhookNetworkPolicy> = Object.freeze({
  allowPrivateNetworks: false,
  allowLoopback: false,
  allowCidrs: Object.freeze([]),
  nat64Prefixes: Object.freeze([]),
});

/** The categories `allowPrivateNetworks` lifts. */
export const PRIVATE_NETWORK_CATEGORIES: ReadonlySet<AddressCategory> = new Set([
  'loopback',
  'private',
  'cgnat',
]);

type Rule = readonly [prefix: readonly number[], length: number, category: AddressCategory];

function ipv4Bytes(text: string): number[] {
  return text.split('.').map(Number);
}

/** Bytes of a valid IPv6 address (`isIPv6`), without its zone. */
function ipv6Bytes(text: string): number[] {
  const groupsOf = (part: string): number[] => {
    if (part === '') {
      return [];
    }
    return part.split(':').flatMap((group) => {
      if (group.includes('.')) {
        const [a = 0, b = 0, c = 0, d = 0] = ipv4Bytes(group);
        return [(a << 8) | b, (c << 8) | d];
      }
      return [Number.parseInt(group, 16)];
    });
  };
  const [headText = '', tailText] = text.split('::');
  const head = groupsOf(headText);
  const tail = tailText === undefined ? [] : groupsOf(tailText);
  const groups = [...head, ...new Array<number>(8 - head.length - tail.length).fill(0), ...tail];
  return groups.flatMap((group) => [group >> 8, group & 0xff]);
}

function rule(prefix: string, length: number, category: AddressCategory): Rule {
  return [isIPv4(prefix) ? ipv4Bytes(prefix) : ipv6Bytes(prefix), length, category];
}

function matches(bytes: readonly number[], [prefix, length]: Rule): boolean {
  for (let bit = 0; bit < length; bit += 8) {
    const index = bit / 8;
    const remaining = Math.min(8, length - bit);
    const mask = (0xff << (8 - remaining)) & 0xff;
    if (((bytes[index] ?? 0) & mask) !== ((prefix[index] ?? 0) & mask)) {
      return false;
    }
  }
  return true;
}

/** First match wins, so the specific metadata addresses come before their ranges. */
const IPV4_RULES: readonly Rule[] = [
  rule('169.254.169.254', 32, 'metadata'), // AWS, GCP, Azure, OCI, DigitalOcean
  rule('169.254.170.2', 32, 'metadata'), // AWS ECS task metadata
  rule('169.254.170.23', 32, 'metadata'), // AWS EKS Pod Identity Agent
  rule('100.100.100.200', 32, 'metadata'), // Alibaba Cloud
  rule('168.63.129.16', 32, 'metadata'), // Azure host services
  rule('192.0.0.192', 32, 'metadata'), // Oracle Cloud classic
  rule('255.255.255.255', 32, 'broadcast'),
  rule('0.0.0.0', 8, 'unspecified'),
  rule('10.0.0.0', 8, 'private'),
  rule('100.64.0.0', 10, 'cgnat'),
  rule('127.0.0.0', 8, 'loopback'),
  rule('169.254.0.0', 16, 'link_local'),
  rule('172.16.0.0', 12, 'private'),
  rule('192.0.0.0', 24, 'reserved'),
  rule('192.0.2.0', 24, 'documentation'),
  rule('192.88.99.0', 24, 'reserved'),
  rule('192.168.0.0', 16, 'private'),
  rule('198.18.0.0', 15, 'benchmarking'),
  rule('198.51.100.0', 24, 'documentation'),
  rule('203.0.113.0', 24, 'documentation'),
  rule('224.0.0.0', 4, 'multicast'),
  rule('240.0.0.0', 4, 'reserved'),
];

/** IPv6 prefixes whose last 32 bits are an IPv4 address that decides the category. */
const IPV6_EMBEDDING_IPV4: readonly Rule[] = [
  rule('::ffff:0:0', 96, 'public'), // IPv4-mapped
  rule('64:ff9b::', 96, 'public'), // NAT64 well-known prefix
];

const IPV6_RULES: readonly Rule[] = [
  rule('::', 128, 'unspecified'),
  rule('::1', 128, 'loopback'),
  rule('::', 96, 'reserved'), // IPv4-compatible (deprecated)
  rule('64:ff9b:1::', 48, 'reserved'), // local-use NAT64
  rule('100::', 64, 'reserved'), // discard-only
  rule('2001:db8::', 32, 'documentation'),
  rule('2001::', 23, 'reserved'), // IETF protocol assignments, Teredo
  rule('2002::', 16, 'reserved'), // 6to4
  rule('3fff::', 20, 'documentation'),
  rule('fd00:ec2::', 32, 'metadata'), // AWS IPv6 instance metadata, DNS and EKS Pod Identity
  rule('fd20:ce::254', 128, 'metadata'), // GCP IPv6 metadata
  rule('fc00::', 7, 'private'), // unique local
  rule('fe80::', 10, 'link_local'),
  rule('fec0::', 10, 'reserved'), // site-local (deprecated)
  rule('ff00::', 8, 'multicast'),
  rule('2000::', 3, 'public'), // global unicast
];

function classifyIPv4(bytes: readonly number[]): AddressCategory {
  return IPV4_RULES.find((candidate) => matches(bytes, candidate))?.[2] ?? 'public';
}

/**
 * RFC 6052 section 2.2: where each prefix length keeps the 32 bits of an IPv4 address. Bits 64 to 71
 * are always zero, so a length that crosses them skips that byte.
 */
const NAT64_IPV4_BYTES: Readonly<Record<number, readonly number[]>> = {
  32: [4, 5, 6, 7],
  40: [5, 6, 7, 9],
  48: [6, 7, 9, 10],
  56: [7, 9, 10, 11],
  64: [9, 10, 11, 12],
  96: [12, 13, 14, 15],
};

/** The bytes and length of an IPv4 or IPv6 CIDR, or `null` for anything else. */
function parseCidr(text: string): { family: 4 | 6; bytes: number[]; length: number } | null {
  const [address = '', lengthText, extra] = text.split('/');
  if (lengthText === undefined || extra !== undefined || !/^\d{1,3}$/.test(lengthText)) {
    return null;
  }
  const length = Number(lengthText);
  if (isIPv4(address) && length <= 32) {
    return { family: 4, bytes: ipv4Bytes(address), length };
  }
  return isIPv6(address) && length <= 128 ? { family: 6, bytes: ipv6Bytes(address), length } : null;
}

/** The bytes of the IPv4 address an IPv6 address carries under an RFC 6052 prefix, if it does. */
function embeddedIPv4Bytes(bytes: readonly number[], prefix: string): number[] | null {
  const parsed = parseCidr(prefix);
  const positions = parsed === null ? undefined : NAT64_IPV4_BYTES[parsed.length];
  if (parsed?.family !== 6 || positions === undefined) {
    return null;
  }
  if (!matches(bytes, [parsed.bytes, parsed.length, 'public'])) {
    return null;
  }
  return positions.map((position) => bytes[position] ?? 0);
}

/** C124.3: the IPv4 address `address` embeds under the network-specific prefix `prefix`, or `null`. */
export function embeddedIPv4(address: string, prefix: string): string | null {
  if (!isIPv6(address)) {
    return null;
  }
  return embeddedIPv4Bytes(ipv6Bytes(address.split('%')[0] ?? ''), prefix)?.join('.') ?? null;
}

/**
 * The IPv4 bytes an IPv6 address stands for, under the well-known embeddings and the listed NAT64
 * prefixes, or `null` when it stands for none.
 */
function ipv4Behind(bytes: readonly number[], nat64Prefixes: readonly string[]): number[] | null {
  if (IPV6_EMBEDDING_IPV4.some((candidate) => matches(bytes, candidate))) {
    return bytes.slice(12);
  }
  for (const prefix of nat64Prefixes) {
    const embedded = embeddedIPv4Bytes(bytes, prefix);
    if (embedded !== null) {
      return embedded;
    }
  }
  return null;
}

/**
 * The category of a literal IPv4 or IPv6 address (an IPv6 zone such as `%eth0` is
 * ignored). Anything that is not an address literal, including bracketed IPv6 and short
 * IPv4 forms such as `127.1`, is `invalid`. An address under a listed NAT64 prefix takes the category
 * of its embedded IPv4, as one under the well-known prefix does (C124.3).
 */
export function classifyAddress(
  address: string,
  nat64Prefixes: readonly string[] = [],
): AddressCategory {
  if (isIPv4(address)) {
    return classifyIPv4(ipv4Bytes(address));
  }
  if (!isIPv6(address)) {
    return 'invalid';
  }
  const bytes = ipv6Bytes(address.split('%')[0] ?? '');
  const embedded = ipv4Behind(bytes, nat64Prefixes);
  if (embedded !== null) {
    return classifyIPv4(embedded);
  }
  return IPV6_RULES.find((candidate) => matches(bytes, candidate))?.[2] ?? 'reserved';
}

/** C124.3: whether `address`, compared in its canonical form, lies inside a listed block. */
function inAllowedCidr(address: string, policy: WebhookNetworkPolicy): boolean {
  const cidrs = (policy.allowCidrs ?? []).flatMap((cidr) => parseCidr(cidr) ?? []);
  if (cidrs.length === 0) {
    return false;
  }
  const v6 = isIPv6(address) ? ipv6Bytes(address.split('%')[0] ?? '') : null;
  const v4 = v6 === null ? ipv4Bytes(address) : ipv4Behind(v6, policy.nat64Prefixes ?? []);
  return cidrs.some(({ family, bytes, length }) => {
    const candidate = family === 4 ? v4 : v6;
    return candidate !== null && matches(candidate, [bytes, length, 'private']);
  });
}

/** C124.2: the only categories a listed block can lift. */
const CIDR_CATEGORIES: ReadonlySet<AddressCategory> = new Set(['private', 'cgnat']);

/** Whether the dispatcher may connect to `address` under `policy`. */
export function isAddressAllowed(address: string, policy: WebhookNetworkPolicy): boolean {
  const category = classifyAddress(address, policy.nat64Prefixes);
  return (
    category === 'public' ||
    (policy.allowPrivateNetworks && PRIVATE_NETWORK_CATEGORIES.has(category)) ||
    (policy.allowLoopback === true && category === 'loopback') ||
    (CIDR_CATEGORIES.has(category) && inAllowedCidr(address, policy))
  );
}

/**
 * C124.3: what a CIDR entry is, for the settings check: the category it must not be listed for, or
 * `null` for a block wholly inside private or CGNAT space. A block is refused when it overlaps any
 * rule that is not private or CGNAT, a metadata address inside it included, or when its ends are not
 * private or CGNAT. A mapped block reads as the IPv4 block it stands for.
 */
export function cidrCategory(cidr: string): AddressCategory | null {
  const parsed = parseCidr(cidr);
  if (parsed === null) {
    return 'invalid';
  }
  const mapped =
    parsed.family === 6 &&
    parsed.length >= 96 &&
    matches(parsed.bytes, [ipv6Bytes('::ffff:0:0'), 96, 'public']);
  const family = mapped ? 4 : parsed.family;
  const bytes = mapped ? parsed.bytes.slice(12) : parsed.bytes;
  const length = mapped ? parsed.length - 96 : parsed.length;
  const rules = family === 4 ? IPV4_RULES : IPV6_RULES;
  for (const [prefix, ruleLength, category] of rules) {
    const shared = Math.min(length, ruleLength);
    if (!CIDR_CATEGORIES.has(category) && matches(bytes, [prefix, shared, category])) {
      return category;
    }
  }
  const ends = [firstOf(bytes, length), lastOf(bytes, length)].map((address) =>
    family === 4
      ? classifyIPv4(address)
      : (IPV6_RULES.find((candidate) => matches(address, candidate))?.[2] ?? 'reserved'),
  );
  return ends.find((category) => !CIDR_CATEGORIES.has(category)) ?? null;
}

/** The first address of a block, whatever host bits it was written with. */
function firstOf(bytes: readonly number[], length: number): number[] {
  return bytes.map((byte, index) => {
    const kept = Math.max(0, Math.min(8, length - index * 8));
    return byte & (0xff << (8 - kept)) & 0xff;
  });
}

/** The last address of a block. */
function lastOf(bytes: readonly number[], length: number): number[] {
  return bytes.map((byte, index) => {
    const kept = Math.max(0, Math.min(8, length - index * 8));
    return byte | (0xff >> kept);
  });
}

export const ALLOW_PRIVATE_NETWORKS_ENV = 'OPENVERIFY_WEBHOOK_ALLOW_PRIVATE_NETWORKS';

export type RuntimeMode = 'production' | 'development' | 'test';

/** The webhook network settings are invalid or not allowed in this mode. */
export class WebhookNetworkConfigError extends Error {
  override name = 'WebhookNetworkConfigError';
}

/**
 * Reads `OPENVERIFY_WEBHOOK_ALLOW_PRIVATE_NETWORKS`: unset, empty or `false` keeps private
 * networks blocked; `true` lifts the block outside production.
 * @throws {WebhookNetworkConfigError} for `true` in production mode, or any other value.
 */
export function webhookNetworkPolicyFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  mode: RuntimeMode,
): WebhookNetworkPolicy {
  const value = (env[ALLOW_PRIVATE_NETWORKS_ENV] ?? '').trim();
  if (value === '' || value === 'false') {
    return { allowPrivateNetworks: false };
  }
  if (value !== 'true') {
    throw new WebhookNetworkConfigError(`${ALLOW_PRIVATE_NETWORKS_ENV} must be "true" or "false"`);
  }
  if (mode === 'production') {
    throw new WebhookNetworkConfigError(
      `${ALLOW_PRIVATE_NETWORKS_ENV}=true is refused in production mode`,
    );
  }
  return { allowPrivateNetworks: true };
}
