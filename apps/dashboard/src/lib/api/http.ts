/**
 * The BFF's HTTP layer (C21): every request to the API carries the operator's address and the
 * BFF token, is never cached by Next.js and never follows a redirect. Answers are parsed and
 * errors raised exactly as `@openverify/node` does, so the dashboard handles one set of errors
 * whichever API surface it called.
 */
import 'server-only';
import {
  OpenVerifyConnectionError,
  OpenVerifyTimeoutError,
  apiErrorOf,
  parseApiAnswer,
} from '@openverify/node';
import type { z } from 'zod';

/** Everything a BFF request needs besides the call itself. */
export interface BffContext {
  /** `OPENVERIFY_API_URL`, without `/api/v1`. */
  readonly baseUrl: string;
  /** The `ovu_` session token, or `null` for the routes that take none (login, invitations). */
  readonly token: string | null;
  /** The operator's address (`client-address.ts`), or `null` when it is not known. */
  readonly clientAddress: string | null;
  /** `OPENVERIFY_DASHBOARD_BFF_TOKEN`, or `null` when none is configured. */
  readonly bffToken: string | null;
}

export const CLIENT_IP_HEADER = 'x-openverify-client-ip';
export const BFF_TOKEN_HEADER = 'x-openverify-bff-token';

/** Deadline of one API request. Server components wait for it, so it is short. */
export const API_TIMEOUT_MS = 15_000;

export type ApiMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** One API call, typed by the contract schema of its answer. */
export interface ApiCall<Schema extends z.ZodType> {
  readonly method: ApiMethod;
  /**
   * The path after `/api/v1`, such as `/dashboard/me` or `/inquiries/inq_.../approve`. Encode
   * IDs that come from a URL with `encodeURIComponent`.
   */
  readonly path: string;
  readonly query?: Readonly<Record<string, string | undefined>>;
  /** Sent as JSON. */
  readonly body?: unknown;
  /**
   * Request headers of the call itself, such as `If-Match` (C154.3). The session, the BFF token,
   * the client address and the content headers are always the BFF's own.
   */
  readonly headers?: Readonly<Record<string, string>>;
  /** The `@openverify/contracts` schema of a successful answer (`z.undefined()` for a 204). */
  readonly schema: Schema;
}

/** The headers that tell the API who the operator is (C15). */
export function bffHeaders(context: BffContext): Record<string, string> {
  return {
    ...(context.clientAddress === null ? {} : { [CLIENT_IP_HEADER]: context.clientAddress }),
    ...(context.bffToken === null ? {} : { [BFF_TOKEN_HEADER]: context.bffToken }),
  };
}

/**
 * A `fetch` that sends the BFF headers on every request, never cached, never redirected. Values
 * of those headers the caller passed are dropped, so nothing else can choose them.
 */
export function createBffFetch(context: BffContext, base: typeof fetch = fetch): typeof fetch {
  const own = bffHeaders(context);
  return (input, init = {}) => {
    const headers = new Headers(init.headers);
    headers.delete(CLIENT_IP_HEADER);
    headers.delete(BFF_TOKEN_HEADER);
    for (const [name, value] of Object.entries(own)) {
      headers.set(name, value);
    }
    return base(input, { ...init, headers, cache: 'no-store', redirect: 'error' });
  };
}

/** A path of letters, digits and `-._~%` segments: no `..`, query or fragment. */
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const API_PATH = /^(?:\/(?!\.\.?(?:\/|$))[A-Za-z0-9\-._~%]+)+$/;

/**
 * Sends one call and parses its answer.
 * @throws {TypeError} for a malformed `path`, before anything is sent.
 * @throws {OpenVerifyApiError} for an error answer.
 * @throws {OpenVerifyConnectionError} when no answer came; `OpenVerifyTimeoutError` after
 *   `API_TIMEOUT_MS`.
 * @throws {OpenVerifyResponseValidationError} for a success that breaks the contract.
 */
export async function sendApiRequest<Schema extends z.ZodType>(
  context: BffContext,
  call: ApiCall<Schema>,
  base: typeof fetch = fetch,
): Promise<z.output<Schema>> {
  return (await sendApiRequestWithHeaders(context, call, base)).data;
}

/** A parsed answer with the answer's headers (an `ETag`, C154.3). */
export interface ApiAnswerWithHeaders<Data> {
  readonly data: Data;
  readonly headers: Headers;
}

/**
 * `sendApiRequest`, also answering the response headers (an `ETag`, C154.3). The call's own
 * headers are sent first; the session, the BFF token, the client address, `accept` and
 * `content-type` are the BFF's and replace any the call named.
 */
export async function sendApiRequestWithHeaders<Schema extends z.ZodType>(
  context: BffContext,
  call: ApiCall<Schema>,
  base: typeof fetch = fetch,
): Promise<ApiAnswerWithHeaders<z.output<Schema>>> {
  if (!API_PATH.test(call.path)) {
    throw new TypeError(`Not an API path: ${call.path}`);
  }
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(call.query ?? {})) {
    if (value !== undefined) {
      query.append(name, value);
    }
  }
  const search = query.toString();
  const url = `${context.baseUrl}/api/v1${call.path}${search === '' ? '' : `?${search}`}`;
  const headers = new Headers(call.headers);
  headers.delete('authorization');
  headers.set('accept', 'application/json');
  if (context.token !== null) {
    headers.set('authorization', `Bearer ${context.token}`);
  }
  if (call.body === undefined) {
    headers.delete('content-type');
  } else {
    headers.set('content-type', 'application/json');
  }

  let response: Response;
  let text: string;
  try {
    response = await createBffFetch(context, base)(url, {
      method: call.method,
      headers,
      ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    text = await response.text();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new OpenVerifyTimeoutError(`No answer within ${String(API_TIMEOUT_MS)} ms`, {
        cause: error,
      });
    }
    throw new OpenVerifyConnectionError('The API could not be reached', { cause: error });
  }
  if (!response.ok) {
    throw apiErrorOf(response, text);
  }
  return { data: parseApiAnswer(call.schema, response.status, text), headers: response.headers };
}
