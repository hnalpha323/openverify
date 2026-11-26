/**
 * Test support for the KYB clients (C61, rule 9: no test touches the network): an outbound HTTP
 * factory whose clients answer through undici's `MockAgent`, with our own synthetic answers shaped
 * like the real APIs. It keeps the outbound client's rules that a client relies on: https only, a
 * status other than 2xx returned without its body (a redirect is never followed, its location
 * kept), the client's content-type allowlist and response cap, and the allowlisted headers. The vetted lookup and the private-network refusal are
 * tested through the real client (`createOutboundHttp`) with an injected resolver.
 */
import { MockAgent, request as undiciRequest } from 'undici';
import {
  DEFAULT_MAX_RESPONSE_BYTES,
  OutboundHttpError,
  type OutboundHttp,
  type OutboundHttpClientOptions,
  type OutboundHttpRequest,
} from '../../http/index.js';

export interface MockOutbound extends OutboundHttp {
  /** Intercepts are declared on it: `agent.get(origin).intercept(...).reply(...)`. */
  readonly agent: MockAgent;
  /** Every client made, with its options. */
  readonly clients: OutboundHttpClientOptions[];
  /** Every request, oldest first, with the client's name. */
  readonly requests: { client: string; request: OutboundHttpRequest }[];
}

/** The media type of a `content-type` header, lower-cased, without parameters. */
const mediaType = (header: string | string[] | undefined): string | null => {
  const value = Array.isArray(header) ? header[0] : header;
  return value === undefined ? null : (value.split(';')[0]?.trim().toLowerCase() ?? null);
};

/** An outbound factory over a fresh `MockAgent` that refuses any request it was not told of. */
export function createMockOutbound(): MockOutbound {
  const agent = new MockAgent();
  agent.disableNetConnect();
  const clients: OutboundHttpClientOptions[] = [];
  const requests: MockOutbound['requests'] = [];
  return {
    agent,
    clients,
    requests,
    client(options) {
      clients.push(options);
      const accepted = new Set(options.contentTypes.map((type) => type.toLowerCase()));
      const cap = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
      return {
        async request(request) {
          requests.push({ client: options.name, request });
          const url = new URL(request.url);
          if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
            throw new OutboundHttpError(options.name, 'invalid_url');
          }
          const response = await undiciRequest(url, {
            method: request.method,
            headers: { ...request.headers },
            ...(request.body === undefined ? {} : { body: request.body }),
            dispatcher: agent,
          });
          const single = (name: string) => {
            const value = response.headers[name];
            return Array.isArray(value) ? (value.length === 1 ? value[0] : undefined) : value;
          };
          if (response.statusCode < 200 || response.statusCode > 299) {
            await response.body.dump();
            const location = single('location');
            return {
              status: response.statusCode,
              contentType: null,
              body: new Uint8Array(),
              ...(response.statusCode >= 300 && response.statusCode <= 399 && location !== undefined
                ? { headers: { location } }
                : {}),
            };
          }
          const contentType = mediaType(response.headers['content-type']);
          if (contentType === null || !accepted.has(contentType)) {
            await response.body.dump();
            throw new OutboundHttpError(options.name, 'content_type');
          }
          const body = new Uint8Array(await response.body.arrayBuffer());
          if (body.byteLength > cap) {
            throw new OutboundHttpError(options.name, 'too_large');
          }
          // As the real client: a 2xx answer's `expires` and `cache-control` (Workflow 5C review K5).
          const expires = single('expires');
          const cacheControl = single('cache-control');
          const headers = {
            ...(expires === undefined ? {} : { expires }),
            ...(cacheControl === undefined ? {} : { 'cache-control': cacheControl }),
          };
          return {
            status: response.statusCode,
            contentType,
            body,
            ...(Object.keys(headers).length === 0 ? {} : { headers }),
          };
        },
      };
    },
    close: () => agent.close(),
  };
}

/** A JSON reply's options for `MockAgent`: the content type given. */
export const jsonHeaders = (contentType = 'application/json') => ({
  headers: { 'content-type': contentType },
});
