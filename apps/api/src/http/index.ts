/**
 * C54.6 (P07): the one outbound HTTP client of Phase 5, for every request the API or the worker
 * makes to a third party on its own initiative: Twilio, the business registries, RDAP, the feeds,
 * the trust-store sync and the EVM RPC. Each provider makes its own client
 * ({@link OutboundHttp.client}) with the content types it accepts and its response cap.
 *
 * - GET and POST over undici, through a dedicated agent (so `HTTP_PROXY` and the global dispatcher
 *   never apply), whose connections resolve host names with the webhook guard's vetted lookup
 *   (`createVettedLookup`): every resolved address is checked and the socket connects to exactly
 *   that one. Private networks are refused, fixed; only a client created with
 *   `allowPrivateNetworks` (the EVM RPC, from `OPENVERIFY_EVM_RPC_ALLOW_PRIVATE_NETWORKS`,
 *   decision 22) lifts that, never the webhook flag.
 * - No redirect is followed (the plan's `maxRedirections: 0`; undici 7 follows none without its
 *   redirect interceptor): a 3xx comes back as the response, its body discarded and its
 *   `location` kept, so a credential never follows one. Only the trust-store sync follows one,
 *   for CRLs, by its own rules (Workflow 5C review K2).
 * - A response cap (1 MiB unless the client sets another) and a content-type allowlist for 2xx
 *   answers (a missing type taken only by a client that opts in, Workflow 5C review K3); any
 *   other answer's body is discarded and only its status returned.
 * - Errors ({@link OutboundHttpError}) carry a code and `retryable`; their messages name the
 *   client, never the URL, its query or a body.
 */
import { isIP } from 'node:net';
import { Agent, request as undiciRequest, type Dispatcher } from 'undici';
import {
  WebhookRequestError,
  createVettedLookup,
  systemResolver,
  type Resolver,
} from '../webhooks/http-sender.js';
import { isAddressAllowed, type WebhookNetworkPolicy } from '../webhooks/ssrf.js';
import { createPolicyClient } from './policy-client.js';
import { createStreamClient } from './stream.js';

/** C54.6: the default response cap. */
export const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
/** The default per-request deadline. */
export const DEFAULT_OUTBOUND_TIMEOUT_MS = 10_000;

/**
 * C124.2 (Workflow 8A): the methods a policy client may be given. An ordinary client takes `GET` and
 * `POST`, as every client before Phase 8 does.
 */
export type OutboundHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** C124.3: the ports a client may call, opt-in per client. */
export interface OutboundHttpPortPolicy {
  allowed: readonly number[];
}

/**
 * C124.4: the request headers a client refuses, opt-in per client. Lower-case names, and `prefixes`
 * for a family such as `proxy-`. Every name must meet the HTTP token syntax, and a value refuses CR,
 * LF and NUL.
 */
export interface OutboundHttpHeaderPolicy {
  refused: readonly string[];
  refusedPrefixes: readonly string[];
}

export type OutboundHttpErrorCode =
  | 'invalid_url'
  | 'blocked'
  | 'dns'
  | 'timeout'
  | 'network'
  | 'connection_refused'
  | 'too_large'
  | 'content_type'
  | 'content_encoding'
  | 'method_refused'
  | 'port_refused'
  | 'header_refused';

/** An outbound request failed without a usable answer. Never carries a URL or a body. */
export class OutboundHttpError extends Error {
  override name = 'OutboundHttpError';
  readonly code: OutboundHttpErrorCode;
  readonly retryable: boolean;

  constructor(client: string, code: OutboundHttpErrorCode) {
    super(`${client}: outbound request failed (${code})`);
    this.code = code;
    this.retryable =
      code === 'dns' || code === 'timeout' || code === 'network' || code === 'connection_refused';
  }
}

export interface OutboundHttpClientOptions {
  /** Names the client in errors, such as `twilio` or `gleif`; never a URL. */
  name: string;
  /** The media types a 2xx answer may have, such as `application/json`. */
  contentTypes: readonly string[];
  /** Response cap; defaults to {@link DEFAULT_MAX_RESPONSE_BYTES}. */
  maxResponseBytes?: number;
  /** Per-request deadline; defaults to {@link DEFAULT_OUTBOUND_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Only the EVM RPC client may set it (decision 22); every other client refuses them. */
  allowPrivateNetworks?: boolean;
  /** Allows `http:` URLs besides `https:`; only for operator-set URLs on a private network. */
  allowPlainHttp?: boolean;
  /**
   * Accepts a 2xx answer that carries no `Content-Type` (Workflow 5C review K3). Only the
   * trust-store sync's clients set it: their payloads are verified by signature or pin before
   * use. A `Content-Type` outside `contentTypes` is still refused.
   */
  acceptMissingContentType?: boolean;
}

export interface OutboundHttpRequest {
  method: 'GET' | 'POST';
  url: string;
  headers?: Readonly<Record<string, string>>;
  body?: string | Uint8Array;
}

/**
 * C124.2 (Workflow 8A): a client of its own policy, opt-in per client, for the HTTPS action and the
 * Slack adapter (`policy-client.ts`). An ordinary client never gains these, and this one never takes
 * `allowPrivateNetworks`: what it may reach is {@link networkPolicy}, which only `api-egress` sets.
 */
export interface OutboundHttpPolicyClientOptions extends OutboundHttpClientOptions {
  /** The methods this client takes. */
  methods: readonly OutboundHttpMethod[];
  /** C124.3: the ports it may call. */
  portPolicy: OutboundHttpPortPolicy;
  /** C124.4: the headers it refuses. */
  headerPolicy: OutboundHttpHeaderPolicy;
  /** C124.2: refuses an answer with a non-identity `content-encoding`. */
  refuseContentEncoding: boolean;
  /** C124.2, enforced inside the vetted lookup; nothing is lifted when it is left out. */
  networkPolicy?: Omit<WebhookNetworkPolicy, 'allowPrivateNetworks'> | undefined;
  /** Lower-case response headers to return; `location` only ever on a 3xx. */
  exposeHeaders?: readonly string[] | undefined;
}

export interface OutboundHttpPolicyRequest extends Omit<OutboundHttpRequest, 'method'> {
  method: OutboundHttpMethod;
  /** C124.1: this request's deadline, under the client's own. */
  timeoutMs?: number | undefined;
  /** C124.5: keeps up to this many bytes of a non-2xx body; none otherwise. */
  captureErrorBodyBytes?: number | undefined;
  /** Aborts the request: a lost claim (C117.4). */
  signal?: AbortSignal | undefined;
}

export interface OutboundHttpPolicyResponse {
  status: number;
  /** The media type the answer named, lower-cased, whatever its status; `null` when it named none. */
  contentType: string | null;
  /** A 2xx answer's body, or what a request asked to keep of another. */
  body: Uint8Array;
  /** The exposed headers the answer carried. */
  headers: Readonly<Record<string, string>>;
}

export interface OutboundHttpPolicyClient {
  /**
   * One request. Any status resolves, 3xx included (never followed).
   * @throws {OutboundHttpError} without a usable answer.
   */
  request(request: OutboundHttpPolicyRequest): Promise<OutboundHttpPolicyResponse>;
  /** Closes this client's own connections, so nothing kept alive outlives its policy (C124.2). */
  close(): Promise<void>;
}

/** The response headers a caller may read (Workflow 5C review K2, K5); lower-case names. */
export type OutboundHttpResponseHeader = 'location' | 'expires' | 'cache-control';

export interface OutboundHttpResponse {
  status: number;
  /** The media type of a 2xx answer, lower-cased; `null` otherwise. */
  contentType: string | null;
  /** A 2xx answer's body; empty for any other status (C54.6: never kept or logged). */
  body: Uint8Array;
  /**
   * The allowlisted headers the answer carried, never a cookie: a redirect's `location`, a 2xx
   * answer's `expires` and `cache-control`. Absent when it carried none.
   */
  headers?: Readonly<Partial<Record<OutboundHttpResponseHeader, string>>>;
}

export interface OutboundHttpClient {
  /**
   * One request. Any status resolves, 3xx included (never followed).
   * @throws {OutboundHttpError} without a usable answer.
   */
  request(request: OutboundHttpRequest): Promise<OutboundHttpResponse>;
}

/**
 * C85.1 (F18): a list source's client, made only by the watchlist clients. The body goes to a
 * bounded sink (the sync's private file) while its bytes are counted against
 * `maxResponseBytes`; the answer returns the headers named in `exposeHeaders`; one HTTPS redirect
 * is followed, only to exactly `redirect.host`, with the vetted lookup again, no request header
 * carried over and the `Location` never logged; `timeoutMs` bounds the whole request and
 * `idleTimeoutMs` each wait for body bytes.
 */
export interface OutboundStreamClientOptions extends OutboundHttpClientOptions {
  /** The whole request's deadline: the source's `timeout_seconds`. */
  timeoutMs: number;
  /** Each wait for body bytes; defaults to {@link DEFAULT_STREAM_IDLE_TIMEOUT_MS}. */
  idleTimeoutMs?: number;
  /** Lower-case response headers to return, such as `etag` or `x-amz-meta-publication-id`. */
  exposeHeaders?: readonly string[];
  /** At most one HTTPS redirect, to exactly this host (C76.1 `redirect_host`). */
  redirect?: { maxHops: 1; host: string } | undefined;
}

/** C85.1: where a streamed body goes; the client awaits each write (backpressure). */
export interface OutboundStreamSink {
  write(chunk: Uint8Array): Promise<void>;
}

export interface OutboundStreamResponse {
  status: number;
  /** The media type of a 2xx answer, lower-cased; `null` otherwise. */
  contentType: string | null;
  /** The exposed headers the answer carried, lower-case names. */
  headers: Readonly<Record<string, string>>;
  /** The body bytes written to the sink (a 2xx answer only). */
  bytes: number;
}

export interface OutboundStreamClient {
  /**
   * One request whose 2xx body is written to `sink`.
   * @throws {OutboundHttpError} without a usable answer, a refused redirect (`blocked`) or a body
   *   over the cap (`too_large`).
   */
  stream(request: OutboundHttpRequest, sink: OutboundStreamSink): Promise<OutboundStreamResponse>;
}

/** C85.1: the idle timeout of a streamed body. */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 30_000;

/** What `ApiDependencies.outboundHttp` and the worker's deps carry: a client factory. */
export interface OutboundHttp {
  client(options: OutboundHttpClientOptions): OutboundHttpClient;
  /** C85.1: a list source's streaming client (`http/stream.ts`); absent from test fakes. */
  streamClient?(options: OutboundStreamClientOptions): OutboundStreamClient;
  /** C124.2: the client of its own policy; absent from test fakes. */
  policyClient?(options: OutboundHttpPolicyClientOptions): OutboundHttpPolicyClient;
  /** Releases every client's connections. */
  close(): Promise<void>;
}

export interface OutboundHttpOptions {
  /** Defaults to the system resolver; tests inject their own. */
  resolve?: Resolver;
  /** C126.3: only tests: a policy client's requests go here (a `MockAgent`), never to a socket. */
  testDispatcher?: Dispatcher | undefined;
}

const TIMEOUT_CODES: ReadonlySet<string> = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/** The code of a request failure, found anywhere in its cause chain. */
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
    if (name === 'TimeoutError' || (typeof code === 'string' && TIMEOUT_CODES.has(code))) {
      return 'timeout';
    }
    current = (current as { cause?: unknown }).cause;
  }
  return 'network';
}

/** The URL if it is one this client may call: https (or http when allowed), no credentials. */
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

/** A header's single value, or `undefined` when it is absent or repeated. */
const headerValue = (header: string | string[] | undefined): string | undefined =>
  Array.isArray(header) ? (header.length === 1 ? header[0] : undefined) : header;

/** The media type of a `content-type` header, lower-cased, without parameters. */
const mediaType = (header: string | string[] | undefined): string | null => {
  const value = Array.isArray(header) ? header[0] : header;
  return value === undefined ? null : (value.split(';')[0]?.trim().toLowerCase() ?? null);
};

function createClient(
  options: OutboundHttpClientOptions,
  resolve: Resolver,
  agents: Agent[],
): OutboundHttpClient {
  const { name } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_OUTBOUND_TIMEOUT_MS;
  const maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const policy = { allowPrivateNetworks: options.allowPrivateNetworks === true };
  const accepted = new Set(options.contentTypes.map((type) => type.toLowerCase()));
  // Its own agent: no global dispatcher and no proxy from the environment apply.
  const agent = new Agent({
    connect: { lookup: createVettedLookup(policy, resolve), timeout: timeoutMs },
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
  });
  agents.push(agent);
  const fail = (code: OutboundHttpErrorCode) => new OutboundHttpError(name, code);

  return {
    async request({ method, url, headers, body }) {
      const target = parseTarget(url, options.allowPlainHttp === true);
      if (target === null) {
        throw fail('invalid_url');
      }
      const host = target.hostname.replace(/^\[(.*)\]$/, '$1');
      if (isIP(host) !== 0 && !isAddressAllowed(host, policy)) {
        throw fail('blocked');
      }
      try {
        const response = await undiciRequest(target, {
          method,
          headers: { ...headers },
          ...(body === undefined ? {} : { body }),
          // undici 7 follows no redirect unless a redirect interceptor is composed in, and this
          // agent has none (C54.6 `maxRedirections: 0`).
          dispatcher: agent,
          signal: AbortSignal.timeout(timeoutMs),
        });
        const { statusCode } = response;
        if (statusCode < 200 || statusCode > 299) {
          // C54.6: a redirect or an error answer comes back by status only, with a redirect's
          // location, which the caller may follow by its own rules (Workflow 5C review K2).
          await response.body.dump({ limit: 64 * 1024 });
          const location = headerValue(response.headers.location);
          return {
            status: statusCode,
            contentType: null,
            body: new Uint8Array(),
            ...(statusCode >= 300 && statusCode <= 399 && location !== undefined
              ? { headers: { location } }
              : {}),
          };
        }
        const contentType = mediaType(response.headers['content-type']);
        const untypedTaken = contentType === null && options.acceptMissingContentType === true;
        if (!untypedTaken && (contentType === null || !accepted.has(contentType))) {
          await response.body.dump({ limit: 64 * 1024 });
          throw fail('content_type');
        }
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of response.body) {
          const bytes = chunk as Buffer;
          size += bytes.byteLength;
          if (size > maxBytes) {
            response.body.destroy();
            throw fail('too_large');
          }
          chunks.push(bytes);
        }
        // Workflow 5C review K5: the freshness headers a caller may read, never a cookie.
        const expires = headerValue(response.headers.expires);
        const cacheControl = headerValue(response.headers['cache-control']);
        const kept = {
          ...(expires === undefined ? {} : { expires }),
          ...(cacheControl === undefined ? {} : { 'cache-control': cacheControl }),
        };
        return {
          status: statusCode,
          contentType,
          body: new Uint8Array(Buffer.concat(chunks)),
          ...(Object.keys(kept).length === 0 ? {} : { headers: kept }),
        };
      } catch (error) {
        throw error instanceof OutboundHttpError ? error : fail(failureCode(error));
      }
    },
  };
}

/** The outbound client factory. */
export function createOutboundHttp(options: OutboundHttpOptions = {}): OutboundHttp {
  const resolve = options.resolve ?? systemResolver;
  const agents: Agent[] = [];
  return {
    client: (clientOptions) => createClient(clientOptions, resolve, agents),
    streamClient: (clientOptions) => createStreamClient(clientOptions, { resolve, agents }),
    policyClient: (clientOptions) =>
      createPolicyClient(clientOptions, {
        resolve,
        agents,
        testDispatcher: options.testDispatcher,
      }),
    async close() {
      await Promise.all(agents.map((agent) => agent.close()));
    },
  };
}
