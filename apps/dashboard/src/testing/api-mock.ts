/**
 * A scripted API for tests of server code that calls the API through `src/lib/api`: it stubs
 * the global `fetch` and the server-only settings, records every request, and answers from a
 * queue. In a test file:
 *
 *     const api = mockApi();                    // in beforeEach; api.restore() in afterEach
 *     api.replyTo('GET /dashboard/me', 200, meDocument());   // queue answers, oldest first
 *     api.replyProblemTo('POST /inquiries/inq_.../approve', 403, 'forbidden');
 *     ... call the code ...
 *
 * `replyTo` answers only that method and path (after `/api/v1`); `reply` answers whatever comes
 * next. `restore()` throws when an answer was never used, a route-checked answer met another
 * request, or a request found nothing queued, so a wrong or missing call fails the test even
 * when the code under test swallowed the rejection (Workflow 2D F021).
 *
 * Every value is synthetic.
 */
import { problemTypeUri, type ProblemTypeSlug } from '@openverify/contracts';
import type { Permission } from '@openverify/core';
import { vi } from 'vitest';
import { CREATED_AT, IDS } from './api-fixtures';

export const API_URL = 'http://api.test:3000';
const API_PREFIX = '/api/v1';
export const BFF_TOKEN = 'change-me-synthetic-bff-token-0000000000';

export interface RecordedApiRequest {
  readonly method: string;
  /** The path with `/api/v1`, without the query string. */
  readonly path: string;
  readonly query: URLSearchParams;
  readonly headers: Headers;
  /** The parsed JSON body, or `undefined`. */
  readonly body: unknown;
}

type Answer = {
  /** `METHOD /path` after `/api/v1`, for a route-checked answer. */
  readonly route?: string;
} & ({ readonly respond: () => Response } | { readonly error: Error });

export interface MockApi {
  readonly requests: RecordedApiRequest[];
  /** Queues a JSON answer. */
  reply(status: number, body?: unknown, headers?: Record<string, string>): MockApi;
  /** Queues a problem+json answer of a C9 type, or `about:blank` without one. */
  replyProblem(status: number, slug?: ProblemTypeSlug, extra?: Record<string, unknown>): MockApi;
  /** Queues a JSON answer for `route` (`METHOD /path` after `/api/v1`) only. */
  replyTo(route: string, status: number, body?: unknown, headers?: Record<string, string>): MockApi;
  /** Queues a problem+json answer for `route` only. */
  replyProblemTo(
    route: string,
    status: number,
    slug?: ProblemTypeSlug,
    extra?: Record<string, unknown>,
  ): MockApi;
  /** Queues a network failure. */
  fail(error?: Error): MockApi;
  /** The latest request. */
  last(): RecordedApiRequest;
  /**
   * Unstubs `fetch` and the settings.
   * @throws {Error} when an answer was never used, a route-checked answer met another request,
   *   or a request found nothing queued.
   */
  restore(): void;
}

export function jsonResponse(
  status: number,
  body?: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: {
      'content-type': status >= 400 ? 'application/problem+json' : 'application/json',
      ...headers,
    },
  });
}

/** A problem document as the API sends it (C9 types, or `about:blank`). */
export function problemDocument(
  status: number,
  slug?: ProblemTypeSlug,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: slug === undefined ? 'about:blank' : problemTypeUri(slug),
    title: slug === undefined ? 'Synthetic Problem' : `Synthetic ${slug}`,
    status,
    detail: `Synthetic detail for ${String(status)}.`,
    instance: '/api/v1/synthetic',
    requestId: 'req-synthetic-0001',
    ...extra,
  };
}

/**
 * Stubs `fetch`, `OPENVERIFY_API_URL` and `OPENVERIFY_DASHBOARD_BFF_TOKEN`. Unanswered requests
 * fail the test with a clear error.
 */
export function mockApi(): MockApi {
  const requests: RecordedApiRequest[] = [];
  const queue: Answer[] = [];
  const failures: string[] = [];
  vi.stubEnv('OPENVERIFY_API_URL', API_URL);
  vi.stubEnv('OPENVERIFY_DASHBOARD_BFF_TOKEN', BFF_TOKEN);
  const fake = vi.fn((input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push({
      method: init.method ?? 'GET',
      path: url.pathname,
      query: url.searchParams,
      headers: new Headers(init.headers),
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    });
    const method = init.method ?? 'GET';
    const next = queue.shift();
    const failure =
      next === undefined
        ? `Unexpected API request: ${method} ${url.pathname}`
        : next.route !== undefined &&
            next.route !== `${method} ${url.pathname.slice(API_PREFIX.length)}`
          ? `Expected ${next.route}, got ${method} ${url.pathname.slice(API_PREFIX.length)}`
          : undefined;
    if (failure !== undefined || next === undefined) {
      failures.push(failure ?? '');
      return Promise.reject(new Error(failure));
    }
    return 'error' in next ? Promise.reject(next.error) : Promise.resolve(next.respond());
  });
  vi.stubGlobal('fetch', fake);

  const api: MockApi = {
    requests,
    reply(status, body, headers) {
      queue.push({ respond: () => jsonResponse(status, body, headers) });
      return api;
    },
    replyProblem(status, slug, extra) {
      queue.push({ respond: () => jsonResponse(status, problemDocument(status, slug, extra)) });
      return api;
    },
    replyTo(route, status, body, headers) {
      queue.push({ route, respond: () => jsonResponse(status, body, headers) });
      return api;
    },
    replyProblemTo(route, status, slug, extra) {
      queue.push({
        route,
        respond: () => jsonResponse(status, problemDocument(status, slug, extra)),
      });
      return api;
    },
    fail(error = new TypeError('fetch failed')) {
      queue.push({ error });
      return api;
    },
    last() {
      const request = requests.at(-1);
      if (request === undefined) {
        throw new Error('No API request was sent');
      }
      return request;
    },
    restore() {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      const unused = queue.length;
      const problems = [
        ...failures,
        ...(unused === 0
          ? []
          : [
              `${String(unused)} queued API ${unused === 1 ? 'answer was' : 'answers were'} never used`,
            ]),
      ];
      queue.length = 0;
      failures.length = 0;
      if (problems.length > 0) {
        throw new Error(problems.join('; '));
      }
    },
  };
  return api;
}

export const ENVIRONMENTS = {
  sandbox: { id: 'env_01J9ZK3M5Q7R8S9T0V1W2X3Y51', kind: 'sandbox' },
  production: { id: 'env_01J9ZK3M5Q7R8S9T0V1W2X3Y52', kind: 'production' },
} as const;

export interface MeOptions {
  permissions?: readonly Permission[];
  environment?: { id: string; kind: 'sandbox' | 'production' };
  mfaSatisfied?: boolean;
  /** `meta.environments`: the organization's environments (left out unless given). */
  environments?: readonly { id: string; kind: 'sandbox' | 'production' }[];
  name?: string | null;
}

/** `GET /api/v1/dashboard/me`, for a synthetic operator. */
export function meDocument(options: MeOptions = {}): Record<string, unknown> {
  return {
    data: {
      type: 'user',
      id: IDS.user,
      attributes: {
        email: 'operator@example.test',
        name: options.name === undefined ? 'Synthetic Operator' : options.name,
        status: 'active',
        'created-at': CREATED_AT,
        'updated-at': CREATED_AT,
      },
      relationships: { roles: { data: [{ type: 'role', id: 'role_01J9ZK3M5Q7R8S9T0V1W2X3Y53' }] } },
    },
    meta: {
      environment: options.environment ?? ENVIRONMENTS.sandbox,
      permissions: options.permissions ?? ['inquiries:read'],
      'mfa-satisfied': options.mfaSatisfied ?? true,
      ...(options.environments === undefined ? {} : { environments: options.environments }),
    },
  };
}
