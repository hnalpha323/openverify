/**
 * A route-matching API for tests of the lifecycle pages and actions. Pages load several
 * resources at once (`Promise.all`), so answers are matched by method and path rather than
 * taken from a queue in request order (`testing/api-mock.ts`). In a test file:
 *
 *     const api = routeApi();                                   // beforeEach; api.restore() after
 *     api.me({ permissions: ['inquiries:read'] });              // GET /dashboard/me
 *     api.on('GET', `/dashboard/inquiries/${id}`, 200, document);
 *     api.onProblem('POST', `/inquiries/${id}/approve`, 409, 'invalid-transition');
 *     ... call the code ...
 *     expect(api.find('POST', `/inquiries/${id}/approve`)?.body).toEqual({});
 *
 * Paths are given after `/api/v1`. Every value is synthetic.
 */
import type { ProblemTypeSlug } from '@openverify/contracts';
import { vi } from 'vitest';
import {
  API_URL,
  BFF_TOKEN,
  jsonResponse,
  meDocument,
  problemDocument,
  type MeOptions,
} from './api-mock';

const PREFIX = '/api/v1';

export interface RoutedRequest {
  readonly method: string;
  /** The path after `/api/v1`, without the query string. */
  readonly path: string;
  readonly query: URLSearchParams;
  readonly headers: Headers;
  /** The parsed JSON body, or `undefined`. */
  readonly body: unknown;
}

export interface RouteAnswer {
  readonly status: number;
  readonly body?: unknown;
  /** Response headers, such as a template version's `etag` (C154.3). */
  readonly headers?: Readonly<Record<string, string>>;
}

type Handler = (request: RoutedRequest) => RouteAnswer;

export interface RouteApi {
  /** Every request, oldest first. */
  readonly requests: RoutedRequest[];
  /** Answers every `method path` request with this JSON (the latest registration wins). */
  on(
    method: string,
    path: string,
    status: number,
    body?: unknown,
    headers?: Readonly<Record<string, string>>,
  ): RouteApi;
  /** Answers every `method path` request with a problem document. */
  onProblem(
    method: string,
    path: string,
    status: number,
    slug?: ProblemTypeSlug,
    extra?: Record<string, unknown>,
  ): RouteApi;
  /** Answers every `method path` request with what `handler` returns for it. */
  handle(method: string, path: string, handler: Handler): RouteApi;
  /** `GET /dashboard/me` for a synthetic operator. */
  me(options?: MeOptions): RouteApi;
  /** The requests sent to `method path`, oldest first. */
  all(method: string, path: string): RoutedRequest[];
  /** The latest request sent to `method path`. */
  find(method: string, path: string): RoutedRequest | undefined;
  restore(): void;
}

/**
 * Stubs `fetch`, `OPENVERIFY_API_URL` and `OPENVERIFY_DASHBOARD_BFF_TOKEN`. A request no route
 * answers fails the call with a clear error.
 */
export function routeApi(): RouteApi {
  const requests: RoutedRequest[] = [];
  const routes = new Map<string, Handler>();
  const keyOf = (method: string, path: string) => `${method.toUpperCase()} ${path}`;
  vi.stubEnv('OPENVERIFY_API_URL', API_URL);
  vi.stubEnv('OPENVERIFY_DASHBOARD_BFF_TOKEN', BFF_TOKEN);
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request, init: RequestInit = {}) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = init.method ?? 'GET';
      const path = url.pathname.startsWith(PREFIX)
        ? url.pathname.slice(PREFIX.length)
        : url.pathname;
      const request: RoutedRequest = {
        method,
        path,
        query: url.searchParams,
        headers: new Headers(init.headers),
        body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      };
      requests.push(request);
      const handler = routes.get(keyOf(method, path));
      if (handler === undefined) {
        return Promise.reject(new Error(`Unexpected API request: ${method} ${path}`));
      }
      const answer = handler(request);
      return Promise.resolve(jsonResponse(answer.status, answer.body, { ...answer.headers }));
    }),
  );

  const api: RouteApi = {
    requests,
    on(method, path, status, body, headers) {
      routes.set(keyOf(method, path), () => ({ status, body, ...(headers ? { headers } : {}) }));
      return api;
    },
    onProblem(method, path, status, slug, extra) {
      routes.set(keyOf(method, path), () => ({
        status,
        body: problemDocument(status, slug, extra),
      }));
      return api;
    },
    handle(method, path, handler) {
      routes.set(keyOf(method, path), handler);
      return api;
    },
    me(options) {
      return api.on('GET', '/dashboard/me', 200, meDocument(options));
    },
    all(method, path) {
      return requests.filter(
        (request) => request.method === method.toUpperCase() && request.path === path,
      );
    },
    find(method, path) {
      return api.all(method, path).at(-1);
    },
    restore() {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    },
  };
  return api;
}
