/**
 * How the flow talks to the API: one JSON request, checked against its contract schema, with
 * a deadline (1B F018). Requests omit cookies and the referrer, and a token only ever travels
 * in the `Authorization` header.
 *
 * Every request ends: a server that never answers, or stops in the middle of a body, becomes
 * a `timeout` error after its deadline, which the screens show as a recoverable error.
 */
import { FLOW_SPEC_HEADER, problemSchema, type Problem } from '@openverify/contracts';
import type { z } from 'zod';
import { FlowApiError } from './flow-api-error';

export interface FlowTimeouts {
  /** Every request but uploads: the whole answer, body included, must arrive within this. */
  readonly requestMs: number;
  /** Image uploads, which carry up to 10 MiB over what can be a slow mobile network. */
  readonly uploadMs: number;
}

export const DEFAULT_FLOW_TIMEOUTS: FlowTimeouts = Object.freeze({
  requestMs: 30_000,
  uploadMs: 120_000,
});

export interface FlowTransportOptions {
  /** API base URL from `parseApiBaseUrl`; `''` for the flow's own origin. */
  readonly baseUrl: string;
  /** Injected in tests; defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
  /** Defaults to {@link DEFAULT_FLOW_TIMEOUTS}. */
  readonly timeouts?: Partial<FlowTimeouts>;
}

export interface FlowRequest {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly json?: unknown;
  /** A multipart upload; it gets the upload deadline. */
  readonly form?: FormData;
  readonly signal?: AbortSignal | undefined;
  /** The bearer token. Only the one-time link redeem goes without one. */
  readonly token?: string;
  /** The request outlives the page; the browser caps such a body at 64 KiB. */
  readonly keepalive?: boolean;
}

export interface FlowTransport {
  send<Schema extends z.ZodType>(schema: Schema, request: FlowRequest): Promise<z.infer<Schema>>;
}

const ACCEPT = 'application/json, application/problem+json';

/**
 * C151.7 (Workflow 9A): the flow-spec versions this client renders. Negotiation changes only what
 * the server sends (the current step's client view to a spec-2 client), never the path.
 */
export const DECLARED_FLOW_SPECS = '1, 2';

/**
 * A request's own abort signal. It follows the caller's signal, and aborts by itself once the
 * deadline passes.
 */
class Deadline {
  readonly signal: AbortSignal;
  private expired = false;
  private readonly controller = new AbortController();
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly follow: () => void;

  constructor(
    ms: number,
    private readonly caller: AbortSignal | undefined,
  ) {
    this.signal = this.controller.signal;
    this.follow = () => {
      this.controller.abort(caller?.reason);
    };
    if (caller?.aborted === true) {
      this.follow();
    } else {
      caller?.addEventListener('abort', this.follow, { once: true });
    }
    this.timer = setTimeout(() => {
      this.expired = true;
      this.controller.abort(new DOMException('The request timed out.', 'TimeoutError'));
    }, ms);
  }

  get timedOut(): boolean {
    return this.expired;
  }

  /**
   * Settles like `promise`, or rejects as soon as the request is aborted: a body that stops
   * arriving must not hold the screen forever, whatever `fetch` does with the signal.
   */
  race<T>(promise: Promise<T>): Promise<T> {
    const { signal } = this;
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        reject(signal.reason as Error);
      };
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
      promise.then(
        (value) => {
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort);
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- passes the original rejection through unchanged
          reject(error);
        },
      );
    });
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.caller?.removeEventListener('abort', this.follow);
  }
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  );
}

/**
 * The problem document in `body`, or `null` when it is not one. A `reason` this version does
 * not know (one a newer server added to `session_canceled`, C25.8) is left out instead of
 * losing the whole problem, and with it the `code` that ends the flow on the right screen.
 */
function parseProblem(body: unknown): Problem | null {
  const parsed = problemSchema.safeParse(body);
  if (parsed.success) {
    return parsed.data;
  }
  const onlyTheReason = parsed.error.issues.every(({ path }) => path[0] === 'reason');
  if (!onlyTheReason || typeof body !== 'object' || body === null) {
    return null;
  }
  const withoutReason: Record<string, unknown> = { ...body };
  delete withoutReason.reason;
  const retried = problemSchema.safeParse(withoutReason);
  return retried.success ? retried.data : null;
}

async function readProblem(response: Response): Promise<Problem | null> {
  const type = response.headers.get('content-type') ?? '';
  if (!/\bjson\b/i.test(type)) {
    return null;
  }
  try {
    return parseProblem(await response.json());
  } catch {
    return null;
  }
}

export function createFlowTransport(options: FlowTransportOptions): FlowTransport {
  const { baseUrl } = options;
  const fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const timeouts: FlowTimeouts = { ...DEFAULT_FLOW_TIMEOUTS, ...options.timeouts };

  async function send<Schema extends z.ZodType>(
    schema: Schema,
    { method, path, json, form, signal, token, keepalive }: FlowRequest,
  ): Promise<z.infer<Schema>> {
    const label = `${method} ${path}`;
    const headers = new Headers({ accept: ACCEPT, [FLOW_SPEC_HEADER]: DECLARED_FLOW_SPECS });
    // eslint-disable-next-line security/detect-possible-timing-attacks -- a presence check against null or undefined, not a comparison of two secrets
    if (token !== undefined) {
      headers.set('authorization', `Bearer ${token}`);
    }
    let body: BodyInit | undefined;
    if (json !== undefined) {
      headers.set('content-type', 'application/json');
      body = JSON.stringify(json);
    } else if (form !== undefined) {
      body = form;
    }

    const deadline = new Deadline(
      form === undefined ? timeouts.requestMs : timeouts.uploadMs,
      signal,
    );
    /** The error for a request that was cut short, or `null` when it failed on its own. */
    const interrupted = (error: unknown): FlowApiError | null => {
      if (deadline.timedOut) {
        return new FlowApiError('timeout', `${label} timed out`, { cause: error });
      }
      if (signal?.aborted === true || isAbortError(error)) {
        return new FlowApiError('aborted', `${label} was aborted`, { cause: error });
      }
      return null;
    };

    try {
      let response: Response;
      try {
        response = await deadline.race(
          fetchImpl(`${baseUrl}${path}`, {
            method,
            headers,
            ...(body === undefined ? {} : { body }),
            ...(keepalive === true ? { keepalive } : {}),
            signal: deadline.signal,
            credentials: 'omit',
            cache: 'no-store',
            referrerPolicy: 'no-referrer',
          }),
        );
      } catch (error: unknown) {
        throw (
          interrupted(error) ??
          new FlowApiError('network', `${label} failed: no response`, { cause: error })
        );
      }

      if (!response.ok) {
        let problem: Problem | null;
        try {
          problem = await deadline.race(readProblem(response));
        } catch (error: unknown) {
          throw interrupted(error) ?? error;
        }
        throw new FlowApiError('http', `${label} failed with HTTP ${String(response.status)}`, {
          status: response.status,
          problem,
        });
      }

      let payload: unknown;
      try {
        payload = await deadline.race(response.json());
      } catch (error: unknown) {
        throw (
          interrupted(error) ??
          new FlowApiError('invalid-response', `${label} returned a body that is not JSON`, {
            status: response.status,
            cause: error,
          })
        );
      }
      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        throw new FlowApiError('invalid-response', `${label} returned an unexpected body`, {
          status: response.status,
          cause: parsed.error,
        });
      }
      return parsed.data;
    } finally {
      deadline.dispose();
    }
  }

  return { send };
}
