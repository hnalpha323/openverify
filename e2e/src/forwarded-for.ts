/**
 * C93.6, F34 (Workflow 7A): the e2e stack runs the API with `OPENVERIFY_TRUST_PROXY=127.0.0.1`, as
 * an operator behind one proxy on the same host would, and the 7A specs present a sandbox address
 * to it by adding a standard `X-Forwarded-For` to the browser's API requests with `page.route`,
 * below CORS: the browser sends no such header itself, the API's CORS list is unchanged, and no
 * other header is touched. Only the documentation ranges, which the sandbox network source answers
 * for in sandbox environments (C93.1, C111.1), may be presented.
 */
import { BlockList, isIP } from 'node:net';

/** The request header the trusted proxy writes (`request.ip` under `OPENVERIFY_TRUST_PROXY`). */
export const FORWARDED_FOR_HEADER = 'x-forwarded-for';

const DOCUMENTATION = new BlockList();
DOCUMENTATION.addSubnet('192.0.2.0', 24, 'ipv4');
DOCUMENTATION.addSubnet('198.51.100.0', 24, 'ipv4');
DOCUMENTATION.addSubnet('203.0.113.0', 24, 'ipv4');
DOCUMENTATION.addSubnet('2001:db8::', 32, 'ipv6');

/** `headers` with `X-Forwarded-For: <address>` and nothing else added or changed. */
export function withForwardedFor(
  headers: Readonly<Record<string, string>>,
  address: string,
): Record<string, string> {
  const family = isIP(address);
  if (family === 0 || !DOCUMENTATION.check(address, family === 4 ? 'ipv4' : 'ipv6')) {
    throw new Error('a spec presents only documentation addresses (C111.1)');
  }
  const kept = Object.entries(headers).filter(
    ([name]) => name.toLowerCase() !== FORWARDED_FOR_HEADER,
  );
  return { ...Object.fromEntries(kept), [FORWARDED_FOR_HEADER]: address };
}
