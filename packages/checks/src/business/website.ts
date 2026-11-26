/**
 * The website's host (C61.3, C61.4): read from the entered URL as the ports take it (lower case,
 * ASCII, without a trailing dot), whether an address the resolver answered is public, and C56's
 * reserved-name rule for sandbox environments: `*.example` and `*.test` resolve and `*.invalid`
 * does not, with no DNS query. The site itself is never fetched.
 */
import { BlockList, isIP } from 'node:net';
import type { EnvironmentKind } from '../data/feature-table.js';

// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const IPV4_LITERAL = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** The host of an `http` or `https` URL, lower case and ASCII; `null` for anything else. */
export function websiteHostOf(url: string): string | null {
  if (!URL.canParse(url)) {
    return null;
  }
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (host === '' || host.startsWith('[') || IPV4_LITERAL.test(host) || isIP(host) !== 0) {
    return null;
  }
  return host;
}

/**
 * The address ranges that are not public (RFC 6890 and the special-purpose registries; the same
 * ranges as the API's webhook guard, `apps/api/src/webhooks/ssrf.ts`).
 */
const NOT_PUBLIC = new BlockList();
for (const [prefix, length] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  NOT_PUBLIC.addSubnet(prefix, length, 'ipv4');
}
for (const [prefix, length] of [
  ['::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001:db8::', 32],
  ['2001::', 23],
  ['2002::', 16],
  ['3fff::', 20],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  NOT_PUBLIC.addSubnet(prefix, length, 'ipv6');
}
const GLOBAL_UNICAST = new BlockList();
GLOBAL_UNICAST.addSubnet('2000::', 3, 'ipv6');

/** The IPv4 address an IPv4-mapped or NAT64 address carries, else `null`. */
function embeddedIpv4(address: string): string | null {
  const lower = address.toLowerCase();
  for (const prefix of ['::ffff:', '64:ff9b::']) {
    if (lower.startsWith(prefix)) {
      const rest = lower.slice(prefix.length);
      if (isIP(rest) === 4) {
        return rest;
      }
      const groups = rest.split(':');
      if (groups.length === 2 && groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) {
        const [high = 0, low = 0] = groups.map((group) => Number.parseInt(group, 16));
        return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
      }
    }
  }
  return null;
}

/** Whether an IPv4 or IPv6 address is a public one (not private, loopback, link-local, reserved). */
export function isPublicIpAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    return !NOT_PUBLIC.check(address, 'ipv4');
  }
  if (version !== 6) {
    return false;
  }
  const embedded = embeddedIpv4(address);
  if (embedded !== null) {
    return !NOT_PUBLIC.check(embedded, 'ipv4');
  }
  return GLOBAL_UNICAST.check(address, 'ipv6') && !NOT_PUBLIC.check(address, 'ipv6');
}

/** What the sandbox rule says about a host, or `null` when the resolver must answer. */
export type SandboxWebsiteHostOutcome = 'resolves' | 'does_not_resolve';

/** The sandbox answer for a lower-case host, or `null` (production, or not reserved). */
export function sandboxWebsiteHostRule(
  host: string,
  environment: EnvironmentKind,
): SandboxWebsiteHostOutcome | null {
  if (environment !== 'sandbox') {
    return null;
  }
  if (host.endsWith('.example') || host.endsWith('.test')) {
    return 'resolves';
  }
  return host.endsWith('.invalid') ? 'does_not_resolve' : null;
}
