/**
 * Test helpers for the client: a scripted `fetch` that records every request, and the golden
 * API fixtures. Only tests import this file; every value is synthetic.
 */
import { readFileSync } from 'node:fs';

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** The parsed JSON body, or `undefined` when none was sent. */
  body: unknown;
  signal: AbortSignal | undefined;
}

/** What the scripted fetch does for one request. */
export type Scripted =
  | { status: number; body?: unknown; headers?: Record<string, string> }
  | { error: Error }
  | { hang: true }
  | ((request: RecordedRequest) => Response | Promise<Response>);

export interface ScriptedFetch {
  fetch: typeof fetch;
  requests: RecordedRequest[];
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  const text = body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);
  const type =
    status >= 400 ? 'application/problem+json; charset=utf-8' : 'application/json; charset=utf-8';
  return new Response(text, { status, headers: { 'content-type': type, ...headers } });
}

/** A fetch that answers each request with the next script entry; 200 `{}` once they run out. */
export function scriptedFetch(script: Scripted[] = []): ScriptedFetch {
  const requests: RecordedRequest[] = [];
  const queue = [...script];
  const fake = (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const request: RecordedRequest = {
      url: input instanceof Request ? input.url : String(input),
      method: init.method ?? 'GET',
      headers,
      body,
      signal: init.signal ?? undefined,
    };
    requests.push(request);
    const next = queue.shift() ?? { status: 200, body: {} };
    if (typeof next === 'function') {
      return Promise.resolve(next(request));
    }
    if ('error' in next) {
      return Promise.reject(next.error);
    }
    if ('hang' in next) {
      return new Promise((_resolve, reject) => {
        const abort = () => {
          const reason: unknown = request.signal?.reason;
          reject(reason instanceof Error ? reason : new Error('aborted'));
        };
        if (request.signal?.aborted === true) abort();
        request.signal?.addEventListener('abort', abort, { once: true });
      });
    }
    return Promise.resolve(jsonResponse(next.status, next.body, next.headers));
  };
  return { fetch: fake, requests };
}

/** A golden fixture from `contracts/fixtures/api/`. */
export function apiFixture(name: string): Record<string, unknown> {
  const url = new URL(`../../../contracts/fixtures/api/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>;
}
