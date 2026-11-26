/**
 * The operator's real address behind the dashboard BFF (contract C15, findings F003 and F007).
 *
 * The dashboard server calls the API on the operator's behalf, so `request.ip` is the BFF's
 * address. The BFF sends the operator's address in `x-openverify-client-ip`, derived from
 * `x-forwarded-for` with its own trusted hop count, and proves it is the BFF with
 * `x-openverify-bff-token`. The API believes the header only when that token equals
 * `OPENVERIFY_DASHBOARD_BFF_TOKEN` (compared in constant time); anyone else gets `request.ip`,
 * which honours `OPENVERIFY_TRUST_PROXY`. The result keys the login limiter and is recorded
 * in audit entries.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';

export const BFF_CLIENT_IP_HEADER = 'x-openverify-client-ip';
export const BFF_TOKEN_HEADER = 'x-openverify-bff-token';

/** Resolves the client address of a dashboard API request. */
export type ClientAddressResolver = (request: FastifyRequest) => string;

const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

/** A single header value; repeated headers are refused, as a proxy could have added one. */
function single(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * @param bffToken `OPENVERIFY_DASHBOARD_BFF_TOKEN`; without it the header is never believed.
 */
export function createClientAddressResolver(bffToken: string | undefined): ClientAddressResolver {
  // Comparing digests keeps the comparison constant-time whatever length was presented.
  const expected = bffToken === undefined || bffToken === '' ? null : digest(bffToken);
  return (request) => {
    if (expected === null) {
      return request.ip;
    }
    const presented = single(request.headers[BFF_TOKEN_HEADER]);
    const address = single(request.headers[BFF_CLIENT_IP_HEADER]);
    if (presented === undefined || address === undefined) {
      return request.ip;
    }
    const trusted = timingSafeEqual(digest(presented), expected);
    return trusted && isIP(address) !== 0 ? address : request.ip;
  };
}
