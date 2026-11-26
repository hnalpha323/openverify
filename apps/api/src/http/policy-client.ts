/**
 * C124.2 (Workflow 8A): a client of its own policy, one more client of `createOutboundHttp()` for the
 * one step that reaches a host an operator chose. Every property of the ordinary client holds: its own
 * agent, every resolved address vetted and the socket bound to the vetted one, SNI and the certificate
 * on the URL's host, `https:` only, no credentials in the URL, no redirect followed, and errors that
 * carry a code and never the URL or a body. On top of those, each opt-in per client:
 *
 * - PUT, PATCH and DELETE, and only the methods a client lists;
 * - a port policy, read on the URL before anything connects;
 * - a header policy: HTTP token names, no CR, LF or NUL in a value, and a refused list;
 * - refusal of a non-identity `content-encoding`, because nothing here decompresses;
 * - a 2xx with a body needs a listed type, and one with no body (a 204) needs none;
 * - the network policy, enforced inside the vetted lookup, never before the request, so a kept-alive
 *   socket can never carry one client's policy into another's: each client owns its agent, and
 *   {@link OutboundHttpPolicyClient.close} ends it when its policy changes.
 *
 * `allowPrivateNetworks` is never read here: only the EVM RPC client may set it (decision 22).
 */
import { isIP } from 'node:net';
import { Agent, request as undiciRequest, type Dispatcher } from 'undici';
import { WebhookRequestError, createVettedLookup, type Resolver } from '../webhooks/http-sender.js';
import { isAddressAllowed, type WebhookNetworkPolicy } from '../webhooks/ssrf.js';
import {
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_OUTBOUND_TIMEOUT_MS,
  OutboundHttpError,
  type OutboundHttpErrorCode,
  type OutboundHttpHeaderPolicy,
  type OutboundHttpPolicyClient,
  type OutboundHttpPolicyClientOptions,
  type OutboundHttpPolicyResponse,
} from './index.js';

export interface PolicyClientContext {
  resolve: Resolver;
  /** The factory's agents, closed with it. */
  agents: Agent[];
  /** Only tests: see `OutboundHttpOptions.testDispatcher`. */
  testDispatcher?: Dispatcher | undefined;
}

const TIMEOUT_CODES: ReadonlySet<string> = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/** The HTTP token syntax (RFC 9110). */
const HEADER_NAME = /^[!#$%&'*+.^`|~\w-]+$/;
const FORBIDDEN_IN_VALUE = /[\r\n\0]/;
const DISCARD_LIMIT = 64 * 1024;
const IDENTITY = 'identity';

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
    if (code === 'ECONNREFUSED') {
      return 'connection_refused';
    }
    current = (current as { cause?: unknown }).cause;
  }
  return 'network';
}

function parseTarget(value: string, allowPlainHttp: boolean): URL | null {
  if (!URL.canParse(value)) {
    return null;
  }
  const url = new URL(value);
  const protocolOk = url.protocol === 'https:' || (allowPlainHttp && url.protocol === 'http:');
  return protocolOk && url.username === '' && url.password === '' && url.hostname !== ''
    ? url
    : null;
}

const portOf = (url: URL): number =>
  url.port === '' ? (url.protocol === 'http:' ? 80 : 443) : Number(url.port);

function headersAllowed(
  headers: Readonly<Record<string, string>>,
  { refused, refusedPrefixes }: OutboundHttpHeaderPolicy,
): boolean {
  return Object.entries(headers).every(([name, value]) => {
    const lower = name.toLowerCase();
    return (
      HEADER_NAME.test(name) &&
      !FORBIDDEN_IN_VALUE.test(value) &&
      !refused.includes(lower) &&
      !refusedPrefixes.some((prefix) => lower.startsWith(prefix))
    );
  });
}

type ResponseHeaders = Dispatcher.ResponseData['headers'];

/** A header's single value, or `undefined` when it is absent or repeated. */
const headerValue = (header: string | string[] | undefined): string | undefined =>
  Array.isArray(header) ? (header.length === 1 ? header[0] : undefined) : header;

/** The media type of a `content-type` header, lower-cased, without parameters. */
const mediaType = (header: string | string[] | undefined): string | null => {
  const value = Array.isArray(header) ? header[0] : header;
  return value === undefined ? null : (value.split(';')[0]?.trim().toLowerCase() ?? null);
};

function exposedHeaders(
  headers: ResponseHeaders,
  names: readonly string[],
  status: number,
): Readonly<Record<string, string>> {
  const kept: Record<string, string> = {};
  for (const name of names) {
    const value = headerValue(headers[name]);
    if (value !== undefined && (name !== 'location' || (status >= 300 && status <= 399))) {
      kept[name] = value;
    }
  }
  return kept;
}

const encodedWith = (headers: ResponseHeaders): boolean => {
  const encoding = headerValue(headers['content-encoding'])?.trim().toLowerCase();
  return encoding !== undefined && encoding !== '' && encoding !== IDENTITY;
};

/** Up to `limit` bytes of a body; `onOver` says what passing the limit means. */
async function readBody(
  body: Dispatcher.ResponseData['body'],
  limit: number,
  onOver: 'cut' | 'fail',
  fail: (code: OutboundHttpErrorCode) => OutboundHttpError,
): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    const bytes = chunk as Buffer;
    size += bytes.byteLength;
    if (size > limit) {
      body.destroy();
      if (onOver === 'fail') {
        throw fail('too_large');
      }
      chunks.push(bytes.subarray(0, bytes.byteLength - (size - limit)));
      break;
    }
    chunks.push(bytes);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

export function createPolicyClient(
  options: OutboundHttpPolicyClientOptions,
  context: PolicyClientContext,
): OutboundHttpPolicyClient {
  const { name, methods, portPolicy, headerPolicy, refuseContentEncoding } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_OUTBOUND_TIMEOUT_MS;
  const maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const exposed = options.exposeHeaders ?? [];
  const accepted = new Set(options.contentTypes.map((type) => type.toLowerCase()));
  const policy: WebhookNetworkPolicy = { ...options.networkPolicy, allowPrivateNetworks: false };
  // Its own agent: no global dispatcher, no proxy from the environment, and no other client's socket.
  const agent = new Agent({
    connect: { lookup: createVettedLookup(policy, context.resolve), timeout: timeoutMs },
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
  });
  context.agents.push(agent);
  const fail = (code: OutboundHttpErrorCode) => new OutboundHttpError(name, code);

  async function answerOf(
    response: Dispatcher.ResponseData,
    captureErrorBodyBytes: number,
  ): Promise<OutboundHttpPolicyResponse> {
    const { statusCode: status, headers: raw, body } = response;
    const headers = exposedHeaders(raw, exposed, status);
    const contentType = mediaType(raw['content-type']);
    const encoded = refuseContentEncoding && encodedWith(raw);
    if (status < 200 || status > 299) {
      const kept = captureErrorBodyBytes > 0 && !encoded;
      const bytes = kept ? await readBody(body, captureErrorBodyBytes, 'cut', fail) : undefined;
      if (!kept) {
        await body.dump({ limit: DISCARD_LIMIT });
      }
      return { status, contentType, body: bytes ?? new Uint8Array(), headers };
    }
    if (encoded) {
      await body.dump({ limit: DISCARD_LIMIT });
      throw fail('content_encoding');
    }
    // C124.5: an answer with no body needs no type (a 204 above all); one with a body needs its type.
    if (contentType !== null && !accepted.has(contentType)) {
      await body.dump({ limit: DISCARD_LIMIT });
      throw fail('content_type');
    }
    const bytes = await readBody(body, maxBytes, 'fail', fail);
    if (contentType === null && bytes.byteLength > 0) {
      throw fail('content_type');
    }
    return { status, contentType, body: bytes, headers };
  }

  return {
    async request({ method, url, headers, body, signal, ...limits }) {
      if (!methods.includes(method)) {
        throw fail('method_refused');
      }
      const target = parseTarget(url, options.allowPlainHttp === true);
      if (target === null) {
        throw fail('invalid_url');
      }
      if (!portPolicy.allowed.includes(portOf(target))) {
        throw fail('port_refused');
      }
      if (headers !== undefined && !headersAllowed(headers, headerPolicy)) {
        throw fail('header_refused');
      }
      const host = target.hostname.replace(/^\[(.*)\]$/, '$1');
      if (isIP(host) !== 0 && !isAddressAllowed(host, policy)) {
        throw fail('blocked');
      }
      const deadline = AbortSignal.timeout(limits.timeoutMs ?? timeoutMs);
      try {
        const response = await undiciRequest(target, {
          method,
          headers: { ...headers },
          ...(body === undefined ? {} : { body }),
          // undici 7 follows no redirect unless a redirect interceptor is composed in, and this
          // agent has none (C124.2).
          dispatcher: context.testDispatcher ?? agent,
          signal: signal === undefined ? deadline : AbortSignal.any([deadline, signal]),
        });
        return await answerOf(response, limits.captureErrorBodyBytes ?? 0);
      } catch (error) {
        throw error instanceof OutboundHttpError
          ? error
          : fail(deadline.aborted ? 'timeout' : failureCode(error));
      }
    },
    async close() {
      const index = context.agents.indexOf(agent);
      if (index !== -1) {
        context.agents.splice(index, 1);
      }
      await agent.close();
    },
  };
}
