/**
 * The HTTP transport of the C18 client: one request with its retries.
 *
 * - Every request carries the bearer API key, `Accept: application/json` and, when the client
 *   names one, `OpenVerify-Version`.
 * - `POST` and `PATCH` carry a JSON body (`{}` when there is nothing to send) and an
 *   `Idempotency-Key` (a ULID unless the caller passes one), the same on every retry, so a
 *   retried write runs at most once (C12).
 * - Network errors, timeouts, 429 and 5xx are retried up to `maxRetries` times, after
 *   `Retry-After` when the API sends it (and gives up at once when it asks for more than a
 *   minute), otherwise after an exponential backoff with jitter. A 409
 *   `idempotency-key-in-use` is retried too: the first request with the key is still running,
 *   and the retry gets its stored response.
 * - Each attempt has its own `timeoutMs` deadline, including reading the body. The caller's
 *   `signal` cancels the request and any wait, without a retry.
 * - Successful answers are parsed with the contract schema of the endpoint.
 */
import {
  API_VERSION_HEADER,
  IDEMPOTENCY_KEY_HEADER,
  idempotencyKeySchema,
  problemTypeUri,
  ulid,
  type ApiVersion,
} from '@openverify/contracts';
import type { z } from 'zod';
import { apiErrorOf, parseApiAnswer } from './answers.js';
import {
  OpenVerifyApiError,
  OpenVerifyConnectionError,
  OpenVerifyResponseValidationError,
  OpenVerifyTimeoutError,
} from './errors.js';

export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_TIMEOUT_MS = 30_000;
/** The `User-Agent` of every request. */
export const CLIENT_USER_AGENT = 'openverify-node/0.0.0';
/** Every server API path starts with this. */
export const API_PATH_PREFIX = '/api/v1';

const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8_000;
/** A `Retry-After` longer than this is not waited for: the error is thrown at once. */
const MAX_RETRY_AFTER_MS = 60_000;
const IDEMPOTENCY_KEY_IN_USE = problemTypeUri('idempotency-key-in-use');
const DECODER = new TextDecoder();

export interface ClientOptions {
  /** An API key (`ov_sbx_...`, `ov_prod_...`) or a dashboard user session token. */
  apiKey: string;
  /** Where the API is served, such as `https://openverify.example.com`; `/api/v1` is added. */
  baseUrl: string;
  /** Sent as `OpenVerify-Version`. Without it the API key's version applies (C12). */
  apiVersion?: ApiVersion;
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Retries after the first attempt. Defaults to 2. */
  maxRetries?: number;
  /** Deadline of each attempt, in milliseconds. Defaults to 30,000. */
  timeoutMs?: number;
  /** Waits between attempts; replaceable in tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** `[0, 1)` source of the backoff jitter; replaceable in tests. */
  random?: () => number;
}

export interface RequestOptions {
  /** Sent on `POST` and `PATCH` instead of a new ULID: 1-255 printable ASCII characters. */
  idempotencyKey?: string;
  /** Cancels the request and any wait between retries. */
  signal?: AbortSignal;
}

/** `DELETE` redacts a report (C73.5); it sends no body. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface TransportRequest<Schema extends z.ZodType> {
  method: HttpMethod;
  /** An absolute URL from `url()` or `nextUrl()`. */
  url: string;
  /** JSON body of a `POST` or `PATCH`; `{}` when absent. A `DELETE` sends none. */
  body?: unknown;
  schema: Schema;
  options?: RequestOptions | undefined;
}

/** A request whose body or answer is not a JSON document. */
export interface RawRequest {
  method: 'GET' | 'POST' | 'PUT';
  url: string;
  /** Multipart as given (`fetch` sets its boundary), anything else as JSON. */
  body?: unknown;
  options?: RequestOptions | undefined;
}

/** A success as bytes. */
export interface RawAnswer {
  status: number;
  bytes: Uint8Array;
  /** The `Content-Type`, without its parameters; `null` when the answer names none. */
  mimeType: string | null;
}

export interface Transport {
  /** The URL of `path` (after `/api/v1`), with the query string. */
  url(path: string, query?: URLSearchParams): string;
  /**
   * The URL of a list's `links.next`.
   * @throws {OpenVerifyResponseValidationError} when the link is not a server API path.
   */
  nextUrl(next: string): string;
  /**
   * Sends the request, with retries, and parses the answer with `schema`.
   * @throws {OpenVerifyApiError} for an error answer (after the retries, if it is retried).
   * @throws {OpenVerifyConnectionError | OpenVerifyTimeoutError} when no answer arrived.
   * @throws {OpenVerifyResponseValidationError} for a success that breaks the contract.
   * @throws {TypeError} for an invalid `idempotencyKey`.
   * @throws the `signal`'s reason once it aborts.
   */
  request<Schema extends z.ZodType>(request: TransportRequest<Schema>): Promise<z.output<Schema>>;
  /**
   * {@link Transport.request} for a body or an answer that is not a JSON document: the same headers,
   * `Idempotency-Key` and retries, and the bytes of a success.
   * @throws the same errors, but for the validation of the answer.
   */
  requestRaw(request: RawRequest): Promise<RawAnswer>;
}

function sleepFor(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(signal.reason as Error);
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason as Error);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function checkedOptions(options: ClientOptions) {
  if (typeof options.apiKey !== 'string' || options.apiKey === '') {
    throw new TypeError('apiKey is required');
  }
  let base: URL;
  try {
    base = new URL(options.baseUrl);
  } catch {
    throw new TypeError('baseUrl must be an absolute http(s) URL');
  }
  if (
    (base.protocol !== 'http:' && base.protocol !== 'https:') ||
    base.username !== '' ||
    base.password !== ''
  ) {
    throw new TypeError('baseUrl must be an http(s) URL without credentials');
  }
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new RangeError('maxRetries must be a whole number, 0 or more');
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('timeoutMs must be a positive number of milliseconds');
  }
  return { base, maxRetries, timeoutMs };
}

function idempotencyKeyOf(key: string | undefined): string {
  if (key === undefined) {
    return ulid();
  }
  if (!idempotencyKeySchema.safeParse(key).success) {
    throw new TypeError(
      'idempotencyKey must be 1-255 printable ASCII characters without surrounding spaces',
    );
  }
  return key;
}

/** `Retry-After` in milliseconds (delay-seconds or an HTTP date), or `null`. */
function retryAfterMs(response: Response): number | null {
  const value = response.headers.get('retry-after');
  if (value === null || value.trim() === '') {
    return null;
  }
  if (/^\d+$/.test(value.trim())) {
    return Number(value.trim()) * 1000;
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

function isRetryable(error: OpenVerifyApiError): boolean {
  return (
    error.status === 429 ||
    error.status >= 500 ||
    (error.status === 409 && error.type === IDEMPOTENCY_KEY_IN_USE)
  );
}

export function createTransport(options: ClientOptions): Transport {
  const { base, maxRetries, timeoutMs } = checkedOptions(options);
  const root = `${base.origin}${base.pathname.replace(/\/+$/, '')}`;
  const send: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const sleep = options.sleep ?? sleepFor;
  const random = options.random ?? Math.random;
  const authorization = `Bearer ${options.apiKey}`;

  /** Backoff before retry `attempt + 1`: exponential, capped, half fixed and half random. */
  const backoff = (attempt: number): number => {
    const ceiling = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
    return Math.round(ceiling / 2 + random() * (ceiling / 2));
  };

  /** One attempt within its deadline: the answer and its body. */
  async function attempt(
    url: string,
    init: RequestInit,
    signal: AbortSignal | undefined,
  ): Promise<{ response: Response; bytes: Uint8Array }> {
    const deadline = new AbortController();
    const timer = setTimeout(() => {
      deadline.abort(new OpenVerifyTimeoutError(`No answer within ${String(timeoutMs)} ms`));
    }, timeoutMs);
    try {
      const response = await send(url, {
        ...init,
        signal: signal === undefined ? deadline.signal : AbortSignal.any([signal, deadline.signal]),
      });
      return { response, bytes: new Uint8Array(await response.arrayBuffer()) };
    } catch (error) {
      if (signal?.aborted === true) {
        throw signal.reason;
      }
      if (deadline.signal.aborted) {
        throw new OpenVerifyTimeoutError(
          `The request did not complete within ${String(timeoutMs)} ms`,
          { cause: error },
        );
      }
      throw new OpenVerifyConnectionError('The request could not be sent or was not answered', {
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /** The method and headers every request carries; a write's `Idempotency-Key` among them. */
  function requestInit(method: string, call: RequestOptions | undefined): RequestInit {
    const headers: Record<string, string> = {
      accept: 'application/json',
      authorization,
      'user-agent': CLIENT_USER_AGENT,
    };
    if (options.apiVersion !== undefined) {
      headers[API_VERSION_HEADER] = options.apiVersion;
    }
    if (method !== 'GET') {
      headers[IDEMPOTENCY_KEY_HEADER] = idempotencyKeyOf(call?.idempotencyKey);
    }
    return { method, headers };
  }

  /** Sends `init` until it succeeds or a retry is no longer due; answers the success. */
  async function exchange(
    url: string,
    init: RequestInit,
    signal: AbortSignal | undefined,
  ): Promise<{ response: Response; bytes: Uint8Array }> {
    for (let retry = 0; ; retry += 1) {
      signal?.throwIfAborted();
      let answer: { response: Response; bytes: Uint8Array };
      try {
        answer = await attempt(url, init, signal);
      } catch (error) {
        if (!(error instanceof OpenVerifyConnectionError) || retry >= maxRetries) {
          throw error;
        }
        await sleep(backoff(retry), signal);
        continue;
      }
      const { response, bytes } = answer;
      if (response.ok) {
        return answer;
      }
      const failure = apiErrorOf(response, DECODER.decode(bytes));
      if (!isRetryable(failure) || retry >= maxRetries) {
        throw failure;
      }
      const delay = retryAfterMs(response) ?? backoff(retry);
      if (delay > MAX_RETRY_AFTER_MS) {
        throw failure;
      }
      await sleep(delay, signal);
    }
  }

  return {
    url(path, query) {
      const search = query?.toString() ?? '';
      return `${root}${API_PATH_PREFIX}${path}${search === '' ? '' : `?${search}`}`;
    },

    nextUrl(next) {
      if (!next.startsWith(`${API_PATH_PREFIX}/`)) {
        throw new OpenVerifyResponseValidationError('The next page link is not an API path', 200);
      }
      return `${root}${next}`;
    },

    async request({ method, url, body, schema, options: call }) {
      const init = requestInit(method, call);
      if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        (init.headers as Record<string, string>)['content-type'] = 'application/json';
        init.body = JSON.stringify(body ?? {});
      }
      const { response, bytes } = await exchange(url, init, call?.signal);
      return parseApiAnswer(schema, response.status, DECODER.decode(bytes));
    },

    async requestRaw({ method, url, body, options: call }) {
      const init = requestInit(method, call);
      if (body instanceof FormData) {
        init.body = body;
      } else if (body !== undefined) {
        (init.headers as Record<string, string>)['content-type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      const { response, bytes } = await exchange(url, init, call?.signal);
      const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? null;
      return { status: response.status, bytes, mimeType };
    },
  };
}
