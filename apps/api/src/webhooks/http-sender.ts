/**
 * The webhook HTTP client: one POST with a 10 s deadline, no redirects, and the SSRF guard
 * applied at connect time. Host names are resolved inside the socket's `lookup`, every
 * resolved address is vetted, and the socket connects to the vetted address itself, so a
 * DNS answer that changes between the check and the connection (DNS rebinding) cannot
 * redirect the request. Literal IP hosts are vetted before the request starts.
 *
 * Errors never echo the URL, which can carry customer tokens in its path or query.
 */
import type { LookupAddress, LookupOptions } from 'node:dns';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { performance } from 'node:perf_hooks';
import { Agent, request } from 'undici';
import { isAddressAllowed, type WebhookNetworkPolicy } from './ssrf.js';

/** C5: a delivery attempt that takes longer than 10 s fails. */
export const DEFAULT_WEBHOOK_TIMEOUT_MS = 10_000;

export type WebhookRequestErrorKind = 'invalid_url' | 'blocked' | 'dns' | 'timeout' | 'network';

const MESSAGES: Readonly<Record<WebhookRequestErrorKind, string>> = {
  invalid_url: 'The webhook URL is not an http(s) URL without credentials',
  blocked: 'The webhook destination address is not allowed',
  dns: 'The webhook host name could not be resolved',
  timeout: 'The webhook receiver did not answer in time',
  network: 'The webhook receiver could not be reached',
};

/** A delivery attempt that got no HTTP response. `retryable` says whether to try again. */
export class WebhookRequestError extends Error {
  override name = 'WebhookRequestError';
  readonly kind: WebhookRequestErrorKind;
  readonly retryable: boolean;

  constructor(kind: WebhookRequestErrorKind) {
    super(MESSAGES[kind]);
    this.kind = kind;
    this.retryable = kind !== 'invalid_url' && kind !== 'blocked';
  }
}

export interface ResolvedAddress {
  address: string;
  family: number;
}

/** Resolves a host name to every address it has. */
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

/** The system resolver (`getaddrinfo`, so `/etc/hosts` applies), all addresses. */
export const systemResolver: Resolver = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map(({ address, family }) => ({
    address,
    family,
  }));

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

export type VettedLookup = (
  hostname: string,
  options: LookupOptions,
  callback: LookupCallback,
) => void;

async function vettedAddress(
  hostname: string,
  policy: WebhookNetworkPolicy,
  resolve: Resolver,
): Promise<ResolvedAddress> {
  let addresses: ResolvedAddress[];
  try {
    addresses = await resolve(hostname);
  } catch {
    throw new WebhookRequestError('dns');
  }
  const [first] = addresses;
  if (first === undefined) {
    throw new WebhookRequestError('dns');
  }
  // Every answer must be allowed: a mixed answer is refused, not filtered.
  if (!addresses.every(({ address }) => isAddressAllowed(address, policy))) {
    throw new WebhookRequestError('blocked');
  }
  return first;
}

/**
 * A `net.connect` lookup that resolves, vets every address and answers with the first one
 * only, so the socket connects to exactly the address that was checked.
 */
export function createVettedLookup(policy: WebhookNetworkPolicy, resolve: Resolver): VettedLookup {
  return (hostname, options, callback) => {
    vettedAddress(hostname, policy, resolve).then(
      (vetted) => {
        if (options.all === true) {
          callback(null, [{ address: vetted.address, family: vetted.family }]);
        } else {
          callback(null, vetted.address, vetted.family);
        }
      },
      (error: unknown) => {
        callback(error as WebhookRequestError, '');
      },
    );
  };
}

export interface WebhookHttpRequest {
  url: string;
  headers: Readonly<Record<string, string>>;
  body: string;
}

export interface WebhookHttpResponse {
  status: number;
  durationMs: number;
}

export interface WebhookSender {
  /**
   * POSTs one delivery. Any HTTP status resolves (redirects are returned, not followed).
   * @throws {WebhookRequestError} when no response was received.
   */
  send(request: WebhookHttpRequest): Promise<WebhookHttpResponse>;
  close(): Promise<void>;
}

export interface GuardedSenderOptions {
  policy: WebhookNetworkPolicy;
  /** Defaults to 10 s (C5). */
  timeoutMs?: number;
  /** Defaults to the system resolver. */
  resolve?: Resolver;
}

const TIMEOUT_CODES: ReadonlySet<string> = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/** Maps a request failure to its kind, finding a guard error anywhere in the cause chain. */
function toRequestError(error: unknown): WebhookRequestError {
  const seen = new Set<unknown>();
  let current = error;
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current);
    if (current instanceof WebhookRequestError) {
      return current;
    }
    const { name, code } = current as { name?: unknown; code?: unknown };
    if (name === 'TimeoutError' || (typeof code === 'string' && TIMEOUT_CODES.has(code))) {
      return new WebhookRequestError('timeout');
    }
    current = (current as { cause?: unknown }).cause;
  }
  return new WebhookRequestError('network');
}

function parseWebhookUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new WebhookRequestError('invalid_url');
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' ||
    url.password !== '' ||
    url.hostname === ''
  ) {
    throw new WebhookRequestError('invalid_url');
  }
  return url;
}

/**
 * Creates the guarded sender. Close it to release its connections.
 * @throws {TypeError} for a non-positive timeout.
 */
export function createGuardedWebhookSender(options: GuardedSenderOptions): WebhookSender {
  const timeoutMs = options.timeoutMs ?? DEFAULT_WEBHOOK_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('The webhook timeout must be a positive number of milliseconds');
  }
  const { policy } = options;
  const agent = new Agent({
    connect: {
      lookup: createVettedLookup(policy, options.resolve ?? systemResolver),
      timeout: timeoutMs,
    },
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
  });

  return {
    async send({ url, headers, body }) {
      const target = parseWebhookUrl(url);
      const host = target.hostname.replace(/^\[(.*)\]$/, '$1');
      if (isIP(host) !== 0 && !isAddressAllowed(host, policy)) {
        throw new WebhookRequestError('blocked');
      }
      const started = performance.now();
      try {
        const response = await request(target, {
          method: 'POST',
          headers: { ...headers },
          body,
          dispatcher: agent,
          signal: AbortSignal.timeout(timeoutMs),
        });
        // Response bodies are never stored; drain a little so the connection can be reused.
        await response.body.dump({ limit: 64 * 1024 });
        return { status: response.statusCode, durationMs: Math.round(performance.now() - started) };
      } catch (error) {
        throw toRequestError(error);
      }
    },
    close: () => agent.close(),
  };
}
