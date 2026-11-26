/**
 * C85.1 (F18): the streaming form of the outbound client for list sources, declared in
 * `http/index.ts` (`OutboundHttp.streamClient`). Owner: `api-watchlists` (Workflow 6A Stage 3);
 * the signature is frozen by `foundation-6` (Stage 1b). The watchlist clients and, since C92.2
 * amends C85.1 (Workflow 7A, `api-network`), the network-source clients make one; nothing else.
 * A network client may name {@link STREAM_NO_CONTENT_TYPE} to take an answer without a
 * `Content-Type` (TorDNSEL's exit list); a typed answer must still match its list.
 *
 * - The same agent rules as `createClient`: its own undici agent (no global dispatcher, no proxy
 *   from the environment), connections resolved through the webhook guard's vetted lookup, and a
 *   literal private address refused unless the client allows private networks.
 * - The 2xx body goes to the caller's sink chunk by chunk, each write awaited, while its bytes are
 *   counted against `maxResponseBytes`; past it the body is destroyed (`too_large`).
 * - `timeoutMs` bounds the whole request, both hops and the body; `idleTimeoutMs` bounds each wait
 *   for body bytes (the 10 s default of the other clients would cut a 22 MB list).
 * - At most one redirect, only with `redirect`, only to exactly `redirect.host`, keeping the
 *   request's scheme and port (owner decision 20 after Workflow 6B), without credentials, through
 *   the vetted lookup again, with no request header carried over. Every other redirect is refused
 *   (`blocked`). The `Location` is never logged, kept or put in an error: it carries the
 *   storage's temporary credentials.
 * - Only the response headers named in `exposeHeaders` come back, never a cookie unless named.
 * - (Workflow 11B, C254.2) A `304 Not Modified` answers a conditional request (`If-None-Match`,
 *   `If-Modified-Since`): it comes back as status 304, nothing written, and is never followed.
 */
import { isIP } from 'node:net';
import { Agent, request as undiciRequest, type Dispatcher } from 'undici';
import { WebhookRequestError, createVettedLookup, type Resolver } from '../webhooks/http-sender.js';
import { isAddressAllowed } from '../webhooks/ssrf.js';
import {
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  OutboundHttpError,
  type OutboundHttpErrorCode,
  type OutboundStreamClient,
  type OutboundStreamClientOptions,
} from './index.js';

export interface StreamClientContext {
  resolve: Resolver;
  /** The factory's agents, closed with it. */
  agents: Agent[];
}

/**
 * C92.2 (the C85.1 amendment): a `contentTypes` entry that accepts a 2xx answer without a
 * `Content-Type`, which TorDNSEL's exit list is served as. No watchlist client names it.
 */
export const STREAM_NO_CONTENT_TYPE = '';

/** The rule a redirect's `Location` must meet to be followed. */
export interface RedirectRule {
  /** The one exact host (C76.1 `redirect_host`). */
  host: string;
  /** Only for operator-set URLs on a private network; never a list client. */
  allowPlainHttp: boolean;
}

/** A request URL this client may call: https (or http when allowed), no credentials. */
function parseTarget(value: string, allowPlainHttp: boolean): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const protocolOk = url.protocol === 'https:' || (allowPlainHttp && url.protocol === 'http:');
  return protocolOk && url.username === '' && url.password === '' && url.hostname !== ''
    ? url
    : null;
}

/**
 * C85.1: the URL a redirect may be followed to, or `null`: an absolute HTTPS URL (http only for a
 * client allowed plain HTTP) without credentials whose host is exactly `rule.host`, on the
 * request's own scheme and port (owner decision 20 after 6B: a redirect to another port is
 * another service, refused like another host; the scheme's default port counts written or not).
 * A relative location stays on the first host, which is never the storage host, so it is refused.
 */
export function followableRedirect(
  location: string | undefined,
  base: URL,
  rule: RedirectRule,
): URL | null {
  if (location === undefined || !/^[a-z][a-z0-9+.-]*:/i.test(location)) {
    return null;
  }
  const target = base.href === '' ? null : parseTarget(location, rule.allowPlainHttp);
  return target?.hostname === rule.host.toLowerCase() &&
    target.protocol === base.protocol &&
    target.port === base.port
    ? target
    : null;
}

const TIMEOUT_CODES: ReadonlySet<string> = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

function failureCode(error: unknown): OutboundHttpErrorCode {
  const seen = new Set<unknown>();
  let current = error;
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current);
    if (current instanceof OutboundHttpError) {
      return current.code;
    }
    if (current instanceof WebhookRequestError) {
      return current.kind === 'blocked' || current.kind === 'dns' ? current.kind : 'network';
    }
    const { name, code } = current as { name?: unknown; code?: unknown };
    if (
      name === 'TimeoutError' ||
      (name === 'AbortError' &&
        (current as { cause?: { name?: unknown } }).cause?.name === 'TimeoutError') ||
      (typeof code === 'string' && TIMEOUT_CODES.has(code))
    ) {
      return 'timeout';
    }
    current = (current as { cause?: unknown }).cause;
  }
  return 'network';
}

const headerValue = (header: string | string[] | undefined): string | undefined =>
  Array.isArray(header) ? (header.length === 1 ? header[0] : undefined) : header;

const mediaType = (header: string | string[] | undefined): string | null => {
  const value = Array.isArray(header) ? header[0] : header;
  return value === undefined ? null : (value.split(';')[0]?.trim().toLowerCase() ?? null);
};

/** C85.1: a list source's streaming client. */
export function createStreamClient(
  options: OutboundStreamClientOptions,
  context: StreamClientContext,
): OutboundStreamClient {
  const { name } = options;
  const maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS;
  const policy = { allowPrivateNetworks: options.allowPrivateNetworks === true };
  const allowPlainHttp = options.allowPlainHttp === true;
  const accepted = new Set(options.contentTypes.map((type) => type.toLowerCase()));
  const exposed = (options.exposeHeaders ?? []).map((header) => header.toLowerCase());
  const agent = new Agent({
    connect: {
      lookup: createVettedLookup(policy, context.resolve),
      timeout: Math.min(options.timeoutMs, idleTimeoutMs),
    },
    headersTimeout: options.timeoutMs,
    bodyTimeout: idleTimeoutMs,
  });
  context.agents.push(agent);
  const fail = (code: OutboundHttpErrorCode) => new OutboundHttpError(name, code);

  const checkHost = (url: URL) => {
    const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
    if (isIP(host) !== 0 && !isAddressAllowed(host, policy)) {
      throw fail('blocked');
    }
  };

  return {
    async stream({ method, url, headers, body }, sink) {
      const first = parseTarget(url, allowPlainHttp);
      if (first === null) {
        throw fail('invalid_url');
      }
      checkHost(first);
      const signal = AbortSignal.timeout(options.timeoutMs);
      try {
        let target = first;
        let response: Dispatcher.ResponseData = await undiciRequest(target, {
          method,
          headers: { ...headers },
          ...(body === undefined ? {} : { body }),
          dispatcher: agent,
          signal,
        });
        // C254.2 (Workflow 11B): a 304 answers a conditional request; it is no redirect.
        for (
          let hops = 0;
          response.statusCode >= 300 && response.statusCode <= 399 && response.statusCode !== 304;
          hops += 1
        ) {
          await response.body.dump({ limit: 64 * 1024 });
          const next =
            hops === 0 && options.redirect !== undefined
              ? followableRedirect(headerValue(response.headers.location), target, {
                  host: options.redirect.host,
                  allowPlainHttp,
                })
              : null;
          if (next === null) {
            throw fail('blocked');
          }
          checkHost(next);
          target = next;
          // No request header is carried over; a redirected request is a plain GET.
          response = await undiciRequest(target, { method: 'GET', dispatcher: agent, signal });
        }
        const kept: Record<string, string> = {};
        for (const header of exposed) {
          const value = headerValue(response.headers[header]);
          if (value !== undefined) {
            kept[header] = value;
          }
        }
        const { statusCode } = response;
        if (statusCode < 200 || statusCode > 299) {
          await response.body.dump({ limit: 64 * 1024 });
          return { status: statusCode, contentType: null, headers: kept, bytes: 0 };
        }
        // A list answer names its type; one without it is refused like a wrong one, unless the
        // client names STREAM_NO_CONTENT_TYPE (C92.2: TorDNSEL serves its exit list untyped).
        const contentType = mediaType(response.headers['content-type']);
        if (
          contentType === null
            ? !accepted.has(STREAM_NO_CONTENT_TYPE)
            : contentType === STREAM_NO_CONTENT_TYPE || !accepted.has(contentType)
        ) {
          await response.body.dump({ limit: 64 * 1024 });
          throw fail('content_type');
        }
        let bytes = 0;
        for await (const chunk of response.body) {
          const data = chunk as Buffer;
          if (bytes + data.byteLength > maxBytes) {
            response.body.destroy();
            throw fail('too_large');
          }
          bytes += data.byteLength;
          await sink.write(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        }
        return { status: statusCode, contentType, headers: kept, bytes };
      } catch (error) {
        throw error instanceof OutboundHttpError ? error : fail(failureCode(error));
      }
    },
  };
}
