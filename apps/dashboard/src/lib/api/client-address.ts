/**
 * The operator's address, which the BFF forwards to the API as `x-openverify-client-ip` so that
 * the login limiter and audit entries see the operator, not the dashboard server (C15, C21;
 * Workflow 1B findings F003 and F007).
 *
 * - With `OPENVERIFY_DASHBOARD_TRUSTED_PROXY_HOPS=0` (the default) it is the socket peer that
 *   `server.ts` records in `x-openverify-peer-ip`. `X-Forwarded-For` is ignored: a client chose it.
 * - With N > 0 trusted proxies it is the Nth entry from the right of `X-Forwarded-For`: each
 *   trusted proxy appends the address it received the request from, so entries further left
 *   came from the client and are never believed.
 * - Anything missing or malformed means no address: the BFF then sends no header, and the API
 *   uses the BFF's own address.
 */
import 'server-only';
import { isIP } from 'node:net';
import { headers } from 'next/headers';
import { trustedProxyHops } from '../config';
import { PEER_ADDRESS_HEADER, isPeerAddressHeaderTrusted } from './peer-address';

// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/**
 * `value` as one IP literal, or `null`. An IPv4-mapped IPv6 address, as a dual-stack socket
 * reports an IPv4 client, becomes the IPv4 address. Ports, brackets and host names are refused.
 */
export function normalizeAddress(value: string | null | undefined): string | null {
  const address = value?.trim() ?? '';
  if (isIP(address) === 0) {
    return null;
  }
  const mapped = IPV4_MAPPED.exec(address)?.[1];
  return mapped !== undefined && isIP(mapped) === 4 ? mapped : address;
}

export interface ClientAddressOptions {
  /** `OPENVERIFY_DASHBOARD_TRUSTED_PROXY_HOPS`. */
  readonly trustedProxyHops: number;
  /** Whether `server.ts` set `x-openverify-peer-ip` in this process. */
  readonly peerHeaderTrusted: boolean;
}

/** The operator's address from a request's headers, or `null` when it is not known. */
export function clientAddressOf(
  requestHeaders: Headers,
  { trustedProxyHops: hops, peerHeaderTrusted }: ClientAddressOptions,
): string | null {
  if (hops === 0) {
    return peerHeaderTrusted ? normalizeAddress(requestHeaders.get(PEER_ADDRESS_HEADER)) : null;
  }
  // Repeated X-Forwarded-For headers arrive joined with commas, as one chain.
  const entries = (requestHeaders.get('x-forwarded-for') ?? '').split(',');
  return entries.length < hops ? null : normalizeAddress(entries[entries.length - hops]);
}

/** The operator's address for the request being handled. */
export async function requestClientAddress(): Promise<string | null> {
  return clientAddressOf(await headers(), {
    trustedProxyHops: trustedProxyHops(),
    peerHeaderTrusted: isPeerAddressHeaderTrusted(),
  });
}
