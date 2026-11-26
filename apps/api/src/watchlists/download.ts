/**
 * C76.2 step 3, C85.1: a list file downloaded through the streaming list client into the sync's
 * private file, with the source's content types, byte cap, deadline and its one allowed redirect
 * host, and the Wikidata Query Service client of C80.1. The EU token rides only in the request
 * URL: it is never logged, stored or put in an error. Owner: `api-watchlists`.
 */
import type { FileHandle } from 'node:fs/promises';
import type { SparqlRunner } from '@openverify/watchlist';
import type { WatchlistSettings } from '../config.js';
import { OutboundHttpError, type OutboundHttp, type OutboundStreamClient } from '../http/index.js';
import { streamToFile } from '../sync/runner.js';
import type { WatchlistManifestSource } from './manifest.js';

/** C76.2: a download failure, by the code the sources page shows (`WATCHLIST_SOURCE_ERROR_CODES`). */
export type WatchlistDownloadCode =
  | 'download_failed'
  | 'download_too_large'
  | 'content_type_refused'
  | 'redirect_refused'
  | 'timeout';

export class WatchlistDownloadError extends Error {
  override name = 'WatchlistDownloadError';
  readonly code: WatchlistDownloadCode;

  constructor(code: WatchlistDownloadCode) {
    super(`watchlist download failed (${code})`);
    this.code = code;
  }
}

/** The code of an outbound failure. */
export function downloadCodeOf(error: unknown): WatchlistDownloadCode {
  if (error instanceof WatchlistDownloadError) {
    return error.code;
  }
  if (error instanceof OutboundHttpError) {
    switch (error.code) {
      case 'too_large':
        return 'download_too_large';
      case 'content_type':
        return 'content_type_refused';
      case 'blocked':
        return 'redirect_refused';
      case 'timeout':
        return 'timeout';
      default:
        return 'download_failed';
    }
  }
  return 'download_failed';
}

/** The response headers a list download reads; OFAC's publication id among them. */
export const LIST_EXPOSED_HEADERS = ['etag', 'last-modified', 'x-amz-meta-publication-id'] as const;

/** The URL of a source's file, with the EU token when the source needs one. */
export function sourceDownloadUrl(
  source: WatchlistManifestSource,
  settings: WatchlistSettings,
): string {
  const [first] = source.urls;
  if (first === undefined) {
    throw new WatchlistDownloadError('download_failed');
  }
  if (source.requires !== 'eu_fsf_token') {
    return first;
  }
  const url = new URL(first);
  url.searchParams.set('token', settings.euFsfToken ?? '');
  return url.href;
}

function streamClientOf(http: OutboundHttp | undefined, source: WatchlistManifestSource) {
  if (http?.streamClient === undefined) {
    throw new WatchlistDownloadError('download_failed');
  }
  return http.streamClient({
    name: source.id,
    contentTypes: source.content_types,
    maxResponseBytes: source.max_bytes.compressed,
    timeoutMs: (source.timeout_seconds ?? 300) * 1000,
    exposeHeaders: [...LIST_EXPOSED_HEADERS],
    redirect:
      source.redirect_host === null ? undefined : { maxHops: 1, host: source.redirect_host },
  });
}

export interface DownloadedFile {
  sha256: string;
  bytes: number;
}

/**
 * C76.2 step 3: downloads the source's file into `handle` (the private file, opened `w+` with mode
 * 0600) and hashes it as it arrives.
 * @throws {WatchlistDownloadError} without a usable answer.
 */
export async function downloadSourceFile(
  source: WatchlistManifestSource,
  context: {
    outboundHttp: OutboundHttp | undefined;
    settings: WatchlistSettings;
    handle: FileHandle;
    /** C254.2: a conditional request's validators (`conditional.ts`); none by default. */
    headers?: Readonly<Record<string, string>> | undefined;
  },
): Promise<DownloadedFile> {
  try {
    const client = streamClientOf(context.outboundHttp, source);
    // C92.2: the sync runner's download, shared with the network sync.
    const response = await streamToFile(
      client,
      {
        method: 'GET',
        url: sourceDownloadUrl(source, context.settings),
        ...(context.headers === undefined || Object.keys(context.headers).length === 0
          ? {}
          : { headers: context.headers }),
      },
      context.handle,
    );
    if (response.status < 200 || response.status > 299) {
      throw new WatchlistDownloadError('download_failed');
    }
    return { sha256: response.sha256, bytes: response.bytes };
  } catch (error) {
    throw new WatchlistDownloadError(downloadCodeOf(error));
  }
}

/** C80.1: the Wikidata Query Service client's settings. */
export interface SparqlRunnerOptions {
  outboundHttp: OutboundHttp | undefined;
  source: WatchlistManifestSource;
  /** `OPENVERIFY_WIKIDATA_SPARQL_URL`. */
  url: string;
  /** `OPENVERIFY_WIKIDATA_USER_AGENT`: the operator's own contact. */
  userAgent: string;
  sleep: (milliseconds: number) => Promise<void>;
  /** Retries of a 429, a 5xx or a timeout before the sync gives up (5, provisional). */
  maxRetries?: number;
}

/** C80.1: waits without a usable `Retry-After` (60 s, then doubling; provisional). */
export const SPARQL_BACKOFF_MS = 60_000;
/** The longest wait a `Retry-After` may ask for (15 minutes; provisional). */
export const SPARQL_MAX_WAIT_MS = 15 * 60_000;

function retryAfterMs(header: string | undefined, fallback: number): number {
  if (header === undefined) {
    return fallback;
  }
  const seconds = Number(header);
  const wait = Number.isFinite(seconds) ? seconds * 1000 : new Date(header).getTime() - Date.now();
  return Number.isFinite(wait) && wait > 0 ? Math.min(wait, SPARQL_MAX_WAIT_MS) : fallback;
}

/**
 * C80.1: the runner `buildPepRecords` asks through: one POST per query (`query=` form-encoded),
 * the operator's User-Agent, 75 s per query (the source's deadline), the answer capped, one query
 * in flight (the build awaits each), and a back-off on 429 that honours `Retry-After`.
 */
export function createSparqlRunner(options: SparqlRunnerOptions): SparqlRunner {
  const maxRetries = options.maxRetries ?? 5;
  let client: OutboundStreamClient | null = null;
  return async (query) => {
    if (options.outboundHttp?.streamClient === undefined) {
      throw new WatchlistDownloadError('download_failed');
    }
    client ??= options.outboundHttp.streamClient({
      name: options.source.id,
      contentTypes: options.source.content_types,
      maxResponseBytes: options.source.max_bytes.compressed,
      timeoutMs: (options.source.timeout_seconds ?? 75) * 1000,
      exposeHeaders: ['retry-after'],
    });
    for (let attempt = 0; ; attempt += 1) {
      const chunks: Uint8Array[] = [];
      let status: number;
      let retryAfter: string | undefined;
      try {
        const response = await client.stream(
          {
            method: 'POST',
            url: options.url,
            headers: {
              'content-type': 'application/x-www-form-urlencoded',
              accept: 'application/sparql-results+json',
              'user-agent': options.userAgent,
            },
            body: `query=${encodeURIComponent(query)}`,
          },
          {
            write(chunk) {
              chunks.push(chunk);
              return Promise.resolve();
            },
          },
        );
        status = response.status;
        retryAfter = response.headers['retry-after'];
      } catch (error) {
        if (!(error instanceof OutboundHttpError && error.retryable) || attempt >= maxRetries) {
          throw new WatchlistDownloadError(downloadCodeOf(error));
        }
        await options.sleep(SPARQL_BACKOFF_MS * 2 ** attempt);
        continue;
      }
      if (status >= 200 && status <= 299) {
        return Buffer.concat(chunks);
      }
      if ((status === 429 || status >= 500) && attempt < maxRetries) {
        await options.sleep(retryAfterMs(retryAfter, SPARQL_BACKOFF_MS * 2 ** attempt));
        continue;
      }
      throw new WatchlistDownloadError('download_failed');
    }
  };
}
