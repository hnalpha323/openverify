/**
 * The flow server (C157; Workflow 9A, `flow-server-embed`):
 * `node --conditions=@openverify/source apps/flow/server.ts [--hostname <h>] [--port <p>] [--dist <dir>]`.
 *
 * It serves the built flow (`dist/`) and computes each document's response headers per request,
 * because `frame-ancestors` is ignored in a `<meta>` policy (C157.4):
 * - **hosted** (`/` and every route): the flow's policy of `src/security/csp-policy.ts` as a header
 *   with `frame-ancestors 'none'`, and `X-Frame-Options: DENY` for browsers that ignore CSP;
 * - **preview** (`/preview`): `connect-src 'none'`, framed by the console's origin only
 *   (`OPENVERIFY_DASHBOARD_PUBLIC_URL`), which the document also carries in a `<meta>` for the
 *   preview's message checks (C156.2, C156.3);
 * - **embed** (`/embed/{inquiry id}`): the hosted policy with `frame-ancestors` the inquiry's embed
 *   policy, read from the API's internal route (`OPENVERIFY_FLOW_SERVER_API_URL`, with
 *   `OPENVERIFY_FLOW_SERVER_TOKEN`), and `'none'` for an empty list, an unknown inquiry, an inactive
 *   template or any failure. The id is checked before anything else; each client address
 *   (`OPENVERIFY_FLOW_SERVER_TRUSTED_PROXY_HOPS`) has a token bucket before any lookup; answers
 *   are cached 60 s by inquiry id, refusals 60 s too.
 *
 * Every response carries Phase 7's `FLOW_RESPONSE_HEADERS` (C107.9) as its base, so a file or an
 * error is never framable either. The access log names the entry and the status, never the path,
 * the id or the address.
 *
 * Node runs this file with its built-in type stripping (Node 22.18+), so it uses erasable
 * TypeScript only and imports with file extensions; `tsconfig.server.json` type-checks it. It
 * imports no package index and no zod (V04): only the import-free origin module and the flow's
 * import-free policy modules.
 */
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { open, realpath, readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  isOriginEntry,
  MAX_ORIGIN_ENTRIES,
  parseEmbedPolicyAnswer,
} from '@openverify/contracts/origin-pattern';
import {
  apiOrigin,
  buildContentSecurityPolicy,
  parseApiBaseUrl,
} from './src/security/csp-policy.ts';
import { FLOW_RESPONSE_HEADERS } from './src/security/response-headers.ts';
import { resolveSecretFiles } from './src/security/secret-files.ts';
import { FLOW_API_URL_VARIABLE, FLOW_RUNTIME_CONFIG_PATH } from './src/security/runtime-config.ts';

/**
 * C157.2: the flow server's limits, all ours and provisional (decision 23's rule; never tuned on
 * test data): a burst of 60 embed loads per client and one a second after it, so a person
 * reloading a page never meets it while a client cannot drain the API's shared lookup budget
 * (`internal-embed-policy`, 6,000 a minute); 10,000 clients and 10,000 answers in memory (a few MB
 * at most); answers and refusals kept 60 s, so an allowlist change reaches new loads within a
 * minute; a lookup answers within 2 s or fails closed; an answer holds at most 50 origins of at
 * most 300 characters, so 64 KiB is far above any valid one.
 */
export const FLOW_SERVER_LIMITS = Object.freeze({
  embedRequestsPerMinute: 60,
  rateLimitClients: 10_000,
  policyCacheEntries: 10_000,
  policyCacheSeconds: 60,
  negativeCacheSeconds: 60,
  lookupTimeoutMs: 2_000,
  lookupAnswerBytes: 65_536,
});

/** C156.2: the `<meta name>` the preview document carries its console origin in. */
export const PREVIEW_CONSOLE_ORIGIN_META = 'openverify-console-origin';

/** What the access log names: the entry and the status, never the path (C157.1). */
export type FlowEntry =
  | 'hosted'
  | 'preview'
  | 'embed'
  | 'asset'
  | 'config'
  | 'not-found'
  | 'refused'
  | 'rate-limited'
  | 'error';

export interface AccessLogLine {
  readonly entry: FlowEntry;
  readonly status: number;
}

export interface FlowServerConfig {
  /** The built flow (`vite build`'s output). */
  readonly distDir: string;
  /** The API origin the flow calls (`VITE_OPENVERIFY_API_URL`), for `connect-src`. */
  readonly apiOrigin: string | null;
  /**
   * C257.1 (Phase 11, Workflow 11C): the API base URL served as `/config.json` to a bundle built
   * without one (`''` or absent: the flow's own origin).
   */
  readonly apiBaseUrl?: string;
  /** The console's origin (`OPENVERIFY_DASHBOARD_PUBLIC_URL`), the only frame of the preview. */
  readonly consoleOrigin: string | null;
  /** The internal embed-policy lookup; `null` without a token, so every embed answers `'none'`. */
  readonly lookup: { readonly apiUrl: string; readonly token: string } | null;
  /** Reverse proxies in front of this server that append `X-Forwarded-For`. */
  readonly trustedProxyHops: number;
  /**
   * C255.1 (Phase 11, Workflow 11B, platform-ops): `OPENVERIFY_HSTS_MAX_AGE`, 0 (the default, off)
   * to 63,072,000 seconds: above 0, every response adds `Strict-Transport-Security` on top of
   * `FLOW_RESPONSE_HEADERS`, for an install whose TLS terminator cannot add it.
   */
  readonly hstsMaxAge?: number;
}

/** C255.1: the most `OPENVERIFY_HSTS_MAX_AGE` may say (two years). */
export const HSTS_MAX_AGE_LIMIT = 63_072_000;

/** The configuration's problems, each `NAME: what is wrong`, never a value. */
export class FlowServerConfigError extends Error {
  override name = 'FlowServerConfigError';
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`The flow server's configuration is not valid:\n${issues.join('\n')}`);
    this.issues = issues;
  }
}

export interface FlowServerArgs {
  readonly help: boolean;
  readonly hostname: string;
  readonly port: number;
  /** `--dist`; `null` for `dist/` beside this file. */
  readonly dist: string | null;
}

const DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Options from the command line. Defaults: 127.0.0.1:4173 (the port `vite preview` used).
 * @throws {Error} for an unknown option or a port that is not 1-65535.
 */
export function parseFlowServerArgs(args: readonly string[]): FlowServerArgs {
  const { values } = parseArgs({
    args: args[0] === '--' ? args.slice(1) : [...args],
    options: {
      hostname: { type: 'string', default: '127.0.0.1' },
      port: { type: 'string', default: '4173' },
      dist: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  const port = /^\d{1,5}$/.test(values.port) ? Number(values.port) : Number.NaN;
  if (!(port >= 1 && port <= 65_535)) {
    throw new Error('--port must be a whole number from 1 to 65535');
  }
  return { help: values.help, hostname: values.hostname, port, dist: values.dist ?? null };
}

/** C174.7: a flow server token holds at least 32 bytes (as the API's check). */
const MIN_TOKEN_BYTES = 32;

/** An absolute http(s) URL with no query, fragment or credentials, or `null`. */
function plainHttpUrl(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const plain =
    (url.protocol === 'https:' || url.protocol === 'http:') &&
    url.search === '' &&
    url.hash === '' &&
    url.username === '' &&
    url.password === '';
  return plain ? url : null;
}

/**
 * The configuration from the environment (C174.7). Without `OPENVERIFY_FLOW_SERVER_TOKEN` the
 * server makes no lookup and every embed answers `'none'`.
 * @throws {FlowServerConfigError} naming each problem, never a value.
 */
export function readFlowServerConfig(
  env: Readonly<Record<string, string | undefined>>,
  distDir: string,
): FlowServerConfig {
  const issues: string[] = [];
  const read = (name: string): string | undefined => {
    const value = env[name]?.trim();
    return value === undefined || value === '' ? undefined : value;
  };

  // C257.1 (Phase 11, Workflow 11C; OD-11C-3): OPENVERIFY_FLOW_API_URL, else the build's variable.
  const apiVariable =
    read(FLOW_API_URL_VARIABLE) === undefined ? 'VITE_OPENVERIFY_API_URL' : FLOW_API_URL_VARIABLE;
  let api: string | null = null;
  let apiBaseUrl = '';
  try {
    api = apiOrigin(read(apiVariable));
    apiBaseUrl = parseApiBaseUrl(read(apiVariable));
  } catch {
    issues.push(`${apiVariable}: must be an absolute http(s) URL without query or credentials`);
  }

  const dashboard = read('OPENVERIFY_DASHBOARD_PUBLIC_URL');
  let consoleOrigin: string | null = null;
  if (dashboard !== undefined) {
    const url = plainHttpUrl(dashboard);
    if (url === null) {
      issues.push('OPENVERIFY_DASHBOARD_PUBLIC_URL: must be an absolute http(s) URL');
    } else {
      consoleOrigin = url.origin;
    }
  }

  const token = read('OPENVERIFY_FLOW_SERVER_TOKEN');
  const apiUrl = read('OPENVERIFY_FLOW_SERVER_API_URL');
  let lookup: FlowServerConfig['lookup'] = null;
  // eslint-disable-next-line security/detect-possible-timing-attacks -- a presence check against null or undefined, not a comparison of two secrets
  if (token !== undefined) {
    if (Buffer.byteLength(token, 'utf8') < MIN_TOKEN_BYTES) {
      issues.push(
        `OPENVERIFY_FLOW_SERVER_TOKEN: must be at least ${String(MIN_TOKEN_BYTES)} bytes`,
      );
    } else if (read('OPENVERIFY_MODE') === 'production' && token.startsWith('change-me')) {
      issues.push(
        'OPENVERIFY_FLOW_SERVER_TOKEN: still holds a change-me placeholder; set a real secret',
      );
    }
    const url = apiUrl === undefined ? null : plainHttpUrl(apiUrl);
    if (url === null) {
      issues.push(
        'OPENVERIFY_FLOW_SERVER_API_URL: must be the absolute http(s) URL the flow server reaches the API at',
      );
    } else {
      lookup = { apiUrl: `${url.origin}${url.pathname}`.replace(/\/+$/, ''), token };
    }
  } else if (apiUrl !== undefined && plainHttpUrl(apiUrl) === null) {
    issues.push('OPENVERIFY_FLOW_SERVER_API_URL: must be an absolute http(s) URL');
  }

  const hstsText = read('OPENVERIFY_HSTS_MAX_AGE') ?? '0';
  const hstsMaxAge = /^\d{1,8}$/.test(hstsText) ? Number(hstsText) : Number.NaN;
  if (!(hstsMaxAge >= 0 && hstsMaxAge <= HSTS_MAX_AGE_LIMIT)) {
    issues.push(
      `OPENVERIFY_HSTS_MAX_AGE: must be a whole number of seconds from 0 to ${String(HSTS_MAX_AGE_LIMIT)}`,
    );
  }

  const hopsText = read('OPENVERIFY_FLOW_SERVER_TRUSTED_PROXY_HOPS') ?? '0';
  const hops = /^\d{1,2}$/.test(hopsText) ? Number(hopsText) : Number.NaN;
  if (!(hops >= 0 && hops <= 32)) {
    issues.push('OPENVERIFY_FLOW_SERVER_TRUSTED_PROXY_HOPS: must be a whole number from 0 to 32');
  }

  if (issues.length > 0) {
    throw new FlowServerConfigError(issues);
  }
  return {
    distDir,
    apiOrigin: api,
    apiBaseUrl,
    consoleOrigin,
    lookup,
    trustedProxyHops: hops,
    hstsMaxAge,
  };
}

/**
 * C157.2, C158.1: the `frame-ancestors` directive of `origins`: each must be an origin entry of
 * the grammar (re-checked here even after `parseEmbedPolicyAnswer`), at most 50, else the whole
 * directive is `'none'`, so no stored value can inject a directive or a header.
 */
export function frameAncestorsDirective(origins: readonly string[]): string {
  const valid =
    origins.length > 0 &&
    origins.length <= MAX_ORIGIN_ENTRIES &&
    origins.every((origin) => isOriginEntry(origin, 'sandbox'));
  return valid ? `frame-ancestors ${origins.join(' ')}` : "frame-ancestors 'none'";
}

/**
 * Phase 7's hosted headers (C107.9), the base of every response, with C255.1's
 * `Strict-Transport-Security` on top while `hstsMaxAge` is above 0 (never a second list).
 */
const baseHeaders = (hstsMaxAge = 0): Record<string, string> => ({
  ...FLOW_RESPONSE_HEADERS,
  ...(hstsMaxAge > 0
    ? { 'Strict-Transport-Security': `max-age=${String(hstsMaxAge)}; includeSubDomains` }
    : {}),
});

/** C157.1: the hosted entry's headers. */
export function hostedHeaders(
  config: Pick<FlowServerConfig, 'apiOrigin' | 'hstsMaxAge'>,
): Record<string, string> {
  return {
    ...baseHeaders(config.hstsMaxAge),
    'Content-Security-Policy': `${buildContentSecurityPolicy({ apiOrigin: config.apiOrigin })}; frame-ancestors 'none'`,
    'X-Frame-Options': 'DENY',
    'Cache-Control': 'no-store',
  };
}

/** C157.1: the embed entry's headers: the hosted policy, framed by `frameAncestors` only. */
export function embedHeaders(
  config: Pick<FlowServerConfig, 'apiOrigin' | 'hstsMaxAge'>,
  frameAncestors: readonly string[],
): Record<string, string> {
  return {
    ...baseHeaders(config.hstsMaxAge),
    'Content-Security-Policy': `${buildContentSecurityPolicy({ apiOrigin: config.apiOrigin })}; ${frameAncestorsDirective(frameAncestors)}`,
    'Cache-Control': 'no-store',
  };
}

/** C156.3, C157.1: the preview entry's headers. */
export function previewHeaders(
  config: Pick<FlowServerConfig, 'consoleOrigin' | 'hstsMaxAge'>,
): Record<string, string> {
  const ancestors =
    config.consoleOrigin === null
      ? "'none'"
      : frameAncestorsDirective([config.consoleOrigin]).slice('frame-ancestors '.length);
  return {
    ...baseHeaders(config.hstsMaxAge),
    'Content-Security-Policy': [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' blob: data:",
      "font-src 'self'",
      "connect-src 'none'",
      `frame-ancestors ${ancestors}`,
      "base-uri 'none'",
      "form-action 'none'",
    ].join('; '),
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cache-Control': 'no-store',
  };
}

/**
 * C157.1 (reviews P05, P10): an inquiry id, exactly as `isId('inq', ...)` of `@openverify/contracts`
 * reads it (a test holds the two together; the server cannot import the package index, V04).
 */
const INQUIRY_ID = /^inq_[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
export function isInquiryId(value: string): boolean {
  return INQUIRY_ID.test(value);
}

/** An address as one key: IPv4-mapped IPv6 as IPv4, lower case. */
function normaliseAddress(address: string): string {
  const lower = address.trim().toLowerCase();
  return lower.startsWith('::ffff:') && lower.includes('.') ? lower.slice('::ffff:'.length) : lower;
}

/**
 * C157.2: the client's address: the socket peer, or with `trustedProxyHops` proxies in front, the
 * address the farthest trusted proxy appended to `X-Forwarded-For` (Fastify's and Express's hop
 * count), never a raw header beyond them.
 */
export function clientAddress(
  socketAddress: string | undefined,
  forwardedFor: string | readonly string[] | undefined,
  trustedProxyHops: number,
): string {
  const chain = [socketAddress === undefined ? 'unknown' : normaliseAddress(socketAddress)];
  if (trustedProxyHops > 0 && forwardedFor !== undefined) {
    const header = typeof forwardedFor === 'string' ? forwardedFor : forwardedFor.join(',');
    chain.push(
      ...header
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part !== '')
        .reverse()
        .map(normaliseAddress),
    );
  }
  return chain[Math.min(trustedProxyHops, chain.length - 1)] ?? 'unknown';
}

export interface TokenBucketOptions {
  readonly capacity: number;
  readonly refillPerSecond: number;
  /** Buckets kept at most; the least recently seen client is forgotten first. */
  readonly maxClients: number;
  readonly now: () => number;
}

interface Bucket {
  tokens: number;
  at: number;
}

/** C157.2: an in-memory token bucket per client (review P05). */
export class TokenBucketLimiter {
  readonly options: TokenBucketOptions;
  private readonly buckets = new Map<string, Bucket>();

  constructor(options: TokenBucketOptions) {
    this.options = options;
  }

  private bucket(client: string): Bucket {
    const now = this.options.now();
    const found = this.buckets.get(client);
    let bucket: Bucket;
    if (found === undefined) {
      bucket = { tokens: this.options.capacity, at: now };
    } else {
      const refilled = ((now - found.at) / 1000) * this.options.refillPerSecond;
      bucket = { tokens: Math.min(this.options.capacity, found.tokens + refilled), at: now };
      this.buckets.delete(client);
    }
    this.buckets.set(client, bucket);
    while (this.buckets.size > this.options.maxClients) {
      const oldest = this.buckets.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.buckets.delete(oldest);
    }
    return bucket;
  }

  /** Takes one request for `client`; `false` when its bucket is empty. */
  take(client: string): boolean {
    const bucket = this.bucket(client);
    if (bucket.tokens < 1) {
      return false;
    }
    bucket.tokens -= 1;
    return true;
  }

  /** Whole seconds until `client` has a token again (at least 1). */
  retryAfterSeconds(client: string): number {
    const bucket = this.bucket(client);
    return Math.max(1, Math.ceil((1 - bucket.tokens) / this.options.refillPerSecond));
  }
}

export interface ExpiringCacheOptions {
  readonly maxEntries: number;
  readonly ttlMs: number;
  readonly now: () => number;
}

/** A map whose entries expire after `ttlMs`, least recently used first past `maxEntries`. */
export class ExpiringCache<V> {
  readonly options: ExpiringCacheOptions;
  private readonly entries = new Map<string, { readonly value: V; readonly expiresAt: number }>();

  constructor(options: ExpiringCacheOptions) {
    this.options = options;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      return undefined;
    }
    this.entries.delete(key);
    if (entry.expiresAt <= this.options.now()) {
      return undefined;
    }
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.options.now() + this.options.ttlMs });
    while (this.entries.size > this.options.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.entries.delete(oldest);
    }
  }

  deleteWhere(matches: (value: V) => boolean): void {
    for (const [key, entry] of [...this.entries]) {
      if (matches(entry.value)) {
        this.entries.delete(key);
      }
    }
  }
}

export interface EmbedPolicyLookup {
  /** The origins that may frame `inquiryId`; empty (`'none'`) for no answer or any failure. */
  (inquiryId: string): Promise<readonly string[]>;
  /** Forgets the cached answers of a template or an environment. */
  invalidate(scope: { readonly templateId?: string; readonly environmentId?: string }): void;
}

export interface EmbedPolicyLookupOptions {
  /** The API as the flow server reaches it, without a trailing slash. */
  readonly apiUrl: string;
  readonly token: string;
  readonly fetch: typeof fetch;
  readonly now: () => number;
  readonly timeoutMs?: number;
}

interface CachedPolicy {
  readonly frameAncestors: readonly string[];
  readonly templateId: string;
  readonly environmentId: string;
}

type LookupResult =
  | { readonly kind: 'policy'; readonly policy: CachedPolicy }
  | { readonly kind: 'refused' }
  | { readonly kind: 'failed' };

/** The body as text, or `null` past `limit` bytes. */
async function cappedText(response: Response, limit: number): Promise<string | null> {
  if (response.body === null) {
    return '';
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * C157.2 (reviews P05, P10, F03): the embed policy of an inquiry through
 * `GET {apiUrl}/api/v1/internal/embed-policies/{id}` with the flow-server token: the id checked
 * first and encoded, the answer guarded by `parseEmbedPolicyAnswer` (every origin re-checked) and
 * its inquiry id compared, cached 60 s by inquiry id; a 404 or an invalid answer is cached as a
 * refusal for 60 s; a failure (network, timeout, another status) answers `'none'` uncached.
 * Concurrent lookups of one id share one request.
 */
export function createEmbedPolicyLookup(options: EmbedPolicyLookupOptions): EmbedPolicyLookup {
  const policies = new ExpiringCache<CachedPolicy>({
    maxEntries: FLOW_SERVER_LIMITS.policyCacheEntries,
    ttlMs: FLOW_SERVER_LIMITS.policyCacheSeconds * 1000,
    now: options.now,
  });
  const refusals = new ExpiringCache<true>({
    maxEntries: FLOW_SERVER_LIMITS.policyCacheEntries,
    ttlMs: FLOW_SERVER_LIMITS.negativeCacheSeconds * 1000,
    now: options.now,
  });
  const inFlight = new Map<string, Promise<LookupResult>>();
  const timeoutMs = options.timeoutMs ?? FLOW_SERVER_LIMITS.lookupTimeoutMs;

  const ask = async (inquiryId: string): Promise<LookupResult> => {
    let response: Response;
    try {
      response = await options.fetch(
        `${options.apiUrl}/api/v1/internal/embed-policies/${encodeURIComponent(inquiryId)}`,
        {
          headers: { authorization: `Bearer ${options.token}`, accept: 'application/json' },
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
        },
      );
    } catch {
      return { kind: 'failed' };
    }
    if (response.status === 404) {
      await response.body?.cancel();
      return { kind: 'refused' };
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      return { kind: 'failed' };
    }
    let text: string | null;
    try {
      text = await cappedText(response, FLOW_SERVER_LIMITS.lookupAnswerBytes);
    } catch {
      return { kind: 'failed' };
    }
    let body: unknown;
    try {
      body = text === null ? null : JSON.parse(text);
    } catch {
      body = null;
    }
    const answer = parseEmbedPolicyAnswer(body);
    if (answer?.inquiryId !== inquiryId) {
      return { kind: 'refused' };
    }
    return {
      kind: 'policy',
      policy: {
        frameAncestors: answer.frameAncestors,
        templateId: answer.templateId,
        environmentId: answer.environmentId,
      },
    };
  };

  const lookup = async (inquiryId: string): Promise<readonly string[]> => {
    if (!isInquiryId(inquiryId)) {
      return [];
    }
    const cached = policies.get(inquiryId);
    if (cached !== undefined) {
      return cached.frameAncestors;
    }
    if (refusals.get(inquiryId) !== undefined) {
      return [];
    }
    let pending = inFlight.get(inquiryId);
    if (pending === undefined) {
      pending = ask(inquiryId).finally(() => inFlight.delete(inquiryId));
      inFlight.set(inquiryId, pending);
    }
    const result = await pending;
    if (result.kind === 'policy') {
      policies.set(inquiryId, result.policy);
      return result.policy.frameAncestors;
    }
    if (result.kind === 'refused') {
      refusals.set(inquiryId, true);
    }
    return [];
  };

  return Object.assign(lookup, {
    invalidate(scope: { readonly templateId?: string; readonly environmentId?: string }): void {
      policies.deleteWhere(
        (policy) =>
          policy.templateId === scope.templateId || policy.environmentId === scope.environmentId,
      );
    },
  });
}

export interface FlowRequestListenerOptions {
  readonly config: FlowServerConfig;
  readonly lookup: (inquiryId: string) => Promise<readonly string[]>;
  readonly limiter: TokenBucketLimiter;
  readonly log: (line: AccessLogLine) => void;
}

/** C157.1: the extensions `dist/` serves, and only these. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};
const HTML = 'text/html; charset=utf-8';
/** Vite's hashed output: never changes, so cached for a year. */
const IMMUTABLE = 'public, max-age=31536000, immutable';

/** The path's segments, decoded, or `null` for a path that could leave `dist/` or is malformed. */
function pathSegments(rawUrl: string): string[] | null {
  const path = rawUrl.split(/[?#]/, 1)[0] ?? '';
  if (!path.startsWith('/') || path.includes('\\')) {
    return null;
  }
  const segments: string[] = [];
  const raw = path.slice(1).split('/');
  for (const [index, part] of raw.entries()) {
    let segment: string;
    try {
      segment = decodeURIComponent(part);
    } catch {
      return null;
    }
    const last = index === raw.length - 1;
    if (
      (segment === '' && !last) ||
      segment === '.' ||
      segment === '..' ||
      /[/\\\0]/.test(segment)
    ) {
      return null;
    }
    if (segment !== '') {
      segments.push(segment);
    }
  }
  return segments;
}

/**
 * C157.1: the request listener. Each request is GET or HEAD; its path is decoded segment by segment
 * and refused (400) when it could leave `dist/`; the embed entry checks the id, then the client's
 * bucket, then looks the policy up; files are served with their headers, documents never stored.
 */
export function createFlowRequestListener(
  options: FlowRequestListenerOptions,
): (req: IncomingMessage, res: ServerResponse) => void {
  const { config } = options;
  let distRoot: Promise<string> | undefined;
  const root = (): Promise<string> => (distRoot ??= realpath(config.distDir));

  /** The real path of `segments` inside `dist/` when it is a regular file there, else `null`. */
  const fileOf = async (segments: readonly string[]): Promise<string | null> => {
    const base = await root();
    try {
      const real = await realpath(resolve(base, ...segments));
      if (!real.startsWith(`${base}${sep}`) || !(await stat(real)).isFile()) {
        return null;
      }
      return real;
    } catch {
      return null;
    }
  };

  /** A response the client stopped reading (closed or reset), as opposed to a failure here. */
  const isClientGone = (error: NodeJS.ErrnoException): boolean =>
    error.code === 'ERR_STREAM_PREMATURE_CLOSE' ||
    error.code === 'ECONNRESET' ||
    error.code === 'EPIPE';

  const answer = (
    req: IncomingMessage,
    res: ServerResponse,
    entry: FlowEntry,
    status: number,
    headers: Record<string, string>,
    body: string | Buffer,
  ): void => {
    res.writeHead(status, { ...headers, 'Content-Length': String(Buffer.byteLength(body)) });
    res.end(req.method === 'HEAD' ? undefined : body);
    options.log({ entry, status });
  };

  const plain = (
    req: IncomingMessage,
    res: ServerResponse,
    entry: FlowEntry,
    status: number,
    text: string,
    extra: Record<string, string> = {},
  ): void => {
    answer(
      req,
      res,
      entry,
      status,
      {
        ...baseHeaders(config.hstsMaxAge),
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
        ...extra,
      },
      `${text}\n`,
    );
  };

  const document = async (
    req: IncomingMessage,
    res: ServerResponse,
    entry: 'hosted' | 'preview' | 'embed',
    headers: Record<string, string>,
  ): Promise<void> => {
    const file = await fileOf([entry === 'preview' ? 'preview.html' : 'index.html']);
    if (file === null) {
      plain(req, res, 'not-found', 404, 'Not found');
      return;
    }
    let html = await readFile(file, 'utf8');
    if (entry === 'preview' && config.consoleOrigin !== null) {
      // C156.2: the preview's message checks read the one origin its frame-ancestors allows.
      const meta = `<meta name="${PREVIEW_CONSOLE_ORIGIN_META}" content="${config.consoleOrigin}">`;
      html = html.replace(/<head>/i, (head) => `${head}${meta}`);
    }
    answer(req, res, entry, 200, { ...headers, 'Content-Type': HTML }, html);
  };

  const file = async (
    req: IncomingMessage,
    res: ServerResponse,
    segments: readonly string[],
  ): Promise<void> => {
    const extension = extname(segments.at(-1) ?? '').toLowerCase();
    const licence = segments[0] === 'licenses' && extension !== '.html';
    const type = licence ? 'text/plain; charset=utf-8' : CONTENT_TYPES[extension];
    const path = type === undefined || extension === '.html' ? null : await fileOf(segments);
    if (type === undefined || path === null) {
      plain(req, res, 'not-found', 404, 'Not found');
      return;
    }
    // Opened before any header is sent (review R005): a file that cannot be opened (gone, refused,
    // no descriptor left) is the handler's 500, and the length is the opened file's own.
    const handle = await open(path, 'r');
    let size: number;
    try {
      size = (await handle.stat()).size;
    } catch (error) {
      await handle.close();
      throw error;
    }
    const headers = {
      ...baseHeaders(config.hstsMaxAge),
      'Content-Type': type,
      'Content-Length': String(size),
      'Cache-Control': segments[0] === 'assets' ? IMMUTABLE : 'no-cache',
    };
    res.writeHead(200, headers);
    options.log({ entry: 'asset', status: 200 });
    if (req.method === 'HEAD') {
      await handle.close();
      res.end();
      return;
    }
    // `pipeline` destroys the read stream, and so closes the file, when the client goes away, and
    // makes a read error a cut answer and one log line, never an unhandled `error` event.
    // (Node passes `undefined`, not `null`, when the whole file was sent.)
    pipeline(
      createReadStream(path, { fd: handle }),
      res,
      (error?: NodeJS.ErrnoException | null) => {
        if (error !== undefined && error !== null && !isClientGone(error)) {
          options.log({ entry: 'error', status: 500 });
        }
      },
    );
  };

  const embed = async (
    req: IncomingMessage,
    res: ServerResponse,
    inquiryId: string | undefined,
  ): Promise<void> => {
    // The id first: a malformed one makes no lookup and is not counted (reviews P05, P10).
    if (inquiryId === undefined || !isInquiryId(inquiryId)) {
      plain(req, res, 'not-found', 404, 'Not found');
      return;
    }
    const client = clientAddress(
      req.socket.remoteAddress,
      req.headers['x-forwarded-for'],
      config.trustedProxyHops,
    );
    if (!options.limiter.take(client)) {
      plain(req, res, 'rate-limited', 429, 'Too many requests', {
        'Retry-After': String(options.limiter.retryAfterSeconds(client)),
      });
      return;
    }
    const origins = await options.lookup(inquiryId);
    await document(req, res, 'embed', embedHeaders(config, origins));
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      plain(req, res, 'refused', 405, 'Method not allowed', { Allow: 'GET, HEAD' });
      return;
    }
    const segments = pathSegments(req.url ?? '');
    if (segments === null) {
      plain(req, res, 'refused', 400, 'Bad request');
      return;
    }
    const [first, second] = segments;
    if (segments.length === 1 && `/${String(first)}` === FLOW_RUNTIME_CONFIG_PATH) {
      // C257.1 (Phase 11, Workflow 11C): the API base URL for a bundle built without one.
      answer(
        req,
        res,
        'config',
        200,
        {
          ...baseHeaders(config.hstsMaxAge),
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json',
        },
        JSON.stringify({ 'api-url': config.apiBaseUrl ?? '' }),
      );
      return;
    }
    if (first === 'embed' && segments.length <= 2) {
      await embed(req, res, second);
      return;
    }
    if (first === 'embed') {
      plain(req, res, 'not-found', 404, 'Not found');
      return;
    }
    if (segments.length === 1 && (first === 'preview' || first === 'preview.html')) {
      await document(req, res, 'preview', previewHeaders(config));
      return;
    }
    const last = segments.at(-1) ?? '';
    if (first === 'licenses') {
      await file(req, res, segments);
      return;
    }
    if (
      segments.length === 0 ||
      (segments.length === 1 && first === 'index.html') ||
      !last.includes('.')
    ) {
      await document(req, res, 'hosted', hostedHeaders(config));
      return;
    }
    await file(req, res, segments);
  };

  return (req, res) => {
    handle(req, res).catch(() => {
      if (res.headersSent) {
        res.destroy();
        options.log({ entry: 'error', status: 500 });
        return;
      }
      plain(req, res, 'error', 500, 'Internal error');
    });
  };
}

export interface RunningFlowServer {
  readonly server: Server;
  /** `http://<hostname>:<port>` of the listening socket. */
  readonly url: string;
  close(): Promise<void>;
}

export interface StartFlowServerOptions {
  readonly config: FlowServerConfig;
  readonly hostname: string;
  /** 0: any free port. */
  readonly port: number;
  readonly fetch?: typeof fetch;
  /** The clock of the limits and caches, in milliseconds. */
  readonly now?: () => number;
  readonly log?: (line: AccessLogLine) => void;
}

/** Starts listening; the lookup is made only when the configuration holds a token. */
export async function startFlowServer(options: StartFlowServerOptions): Promise<RunningFlowServer> {
  const now = options.now ?? Date.now;
  const lookupConfig = options.config.lookup;
  const lookup =
    lookupConfig === null
      ? () => Promise.resolve([])
      : createEmbedPolicyLookup({
          apiUrl: lookupConfig.apiUrl,
          token: lookupConfig.token,
          fetch: options.fetch ?? fetch,
          now,
        });
  const limiter = new TokenBucketLimiter({
    capacity: FLOW_SERVER_LIMITS.embedRequestsPerMinute,
    refillPerSecond: FLOW_SERVER_LIMITS.embedRequestsPerMinute / 60,
    maxClients: FLOW_SERVER_LIMITS.rateLimitClients,
    now,
  });
  const server = createServer(
    createFlowRequestListener({
      config: options.config,
      lookup,
      limiter,
      log: options.log ?? (() => undefined),
    }),
  );
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(options.port, options.hostname, () => {
      server.off('error', fail);
      done();
    });
  });
  const { address, port } = server.address() as AddressInfo;
  const host = address.includes(':') ? `[${address}]` : address;
  return {
    server,
    url: `http://${host}:${String(port)}`,
    close: () =>
      new Promise<void>((done, fail) => {
        server.close((error) => {
          if (error === undefined) {
            done();
          } else {
            fail(error);
          }
        });
        server.closeAllConnections();
      }),
  };
}

const USAGE = `Usage: node --conditions=@openverify/source apps/flow/server.ts [--hostname <h>] [--port <p>] [--dist <dir>] [--help]

Serves the built flow (apps/flow/dist, or --dist) with its response headers (C157):
  /             the hosted flow: ${buildContentSecurityPolicy({ apiOrigin: null })}; frame-ancestors 'none'
  /preview      the console's preview (connect-src 'none'; framed by the console only)
  /embed/<id>   the embedded flow, framed by the inquiry's embed policy (at most ${String(
    MAX_ORIGIN_ENTRIES,
  )} embed origins), else by nothing

Environment: OPENVERIFY_FLOW_API_URL (else VITE_OPENVERIFY_API_URL; served as /config.json),
OPENVERIFY_DASHBOARD_PUBLIC_URL, OPENVERIFY_FLOW_SERVER_TOKEN
(or OPENVERIFY_FLOW_SERVER_TOKEN_FILE), OPENVERIFY_FLOW_SERVER_API_URL,
OPENVERIFY_FLOW_SERVER_TRUSTED_PROXY_HOPS (see .env.example).
Defaults: --hostname 127.0.0.1 --port 4173.
`;

async function main(): Promise<void> {
  const args = parseFlowServerArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }
  // C249.2 (Phase 11, Workflow 11C): the token may come from OPENVERIFY_FLOW_SERVER_TOKEN_FILE.
  const secrets = resolveSecretFiles(process.env, ['OPENVERIFY_FLOW_SERVER_TOKEN'], {
    readFile: (path) => readFileSync(path, 'utf8'),
    mode: (path) => statSync(path).mode,
  });
  if (secrets.issues.length > 0) {
    throw new FlowServerConfigError(secrets.issues);
  }
  for (const warning of secrets.warnings) {
    process.stdout.write(`${JSON.stringify(warning)}\n`);
  }
  const config = readFlowServerConfig(secrets.env, resolve(args.dist ?? join(DIR, 'dist')));
  if (config.lookup === null) {
    console.warn(
      'OPENVERIFY_FLOW_SERVER_TOKEN is not set: every /embed/ page answers frame-ancestors none.',
    );
  }
  const running = await startFlowServer({
    config,
    hostname: args.hostname,
    port: args.port,
    log: (line) => {
      process.stdout.write(`${JSON.stringify(line)}\n`);
    },
  });
  console.log(`OpenVerify flow server listening on ${running.url}`);
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void running.close().finally(() => process.exit(0));
    });
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    const message =
      error instanceof FlowServerConfigError || error instanceof Error
        ? error.message
        : 'The flow server could not start.';
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
