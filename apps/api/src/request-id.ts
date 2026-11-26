import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Accepted client ids: short and log-safe, e.g. a UUID or an edge proxy trace id. */
const VALID_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Fastify `genReqId`: reuse a well-formed `x-request-id` from the client (so traces join
 * up across services), otherwise generate a random UUID.
 */
export function requestIdFor(request: IncomingMessage): string {
  const header = request.headers[REQUEST_ID_HEADER];
  const candidate = Array.isArray(header) ? header[0] : header;
  return candidate !== undefined && VALID_REQUEST_ID.test(candidate) ? candidate : randomUUID();
}
