/**
 * The socket peer of each request, as the custom server (`server.ts`) records it (C21).
 *
 * Next.js only fills `X-Forwarded-For` when a request has none, so behind no proxy a
 * client-chosen value passes through and the real peer is lost. `server.ts` therefore deletes
 * any incoming `x-openverify-peer-ip` and sets it from `req.socket.remoteAddress` before Next.js
 * sees the request, and marks the process, so that the BFF believes the header only when that
 * server is in front (never under a bare `next start` or `next dev`, where a client could send it).
 *
 * This module has no imports: `server.ts` loads it directly under Node's type stripping.
 */

/** Set by `server.ts` from the socket; never taken from the client. */
export const PEER_ADDRESS_HEADER = 'x-openverify-peer-ip';

/** Only code in this process can set a symbol-keyed global; no request or setting can. */
const TRUSTED = Symbol.for('openverify.dashboard.peer-address-header');

/** Called once by `server.ts`: from now on every request carries the header it set. */
export function markPeerAddressHeaderTrusted(): void {
  (globalThis as Record<symbol, unknown>)[TRUSTED] = true;
}

/** Whether `server.ts` sets the header in this process. */
export function isPeerAddressHeaderTrusted(): boolean {
  return (globalThis as Record<symbol, unknown>)[TRUSTED] === true;
}

/** Replaces whatever the client sent in the peer header with the socket address. */
export function setPeerAddressHeader(
  headers: Record<string, string | string[] | undefined>,
  remoteAddress: string | undefined,
): void {
  Reflect.deleteProperty(headers, PEER_ADDRESS_HEADER);
  if (remoteAddress !== undefined && remoteAddress !== '') {
    headers[PEER_ADDRESS_HEADER] = remoteAddress;
  }
}
