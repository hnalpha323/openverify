/**
 * C92.2 steps 3-4: a network source's download, through the C85.1 stream client as C92.2 amends it
 * (the network-source clients share it), into the sync's private file, under the source's content
 * types, byte cap, deadline and one allowed redirect host (none in the committed manifest); and
 * DB-IP's page digest, a SHA-1 of the decompressed file published on the same HTTPS page as the
 * download, which guards against corruption, not against a compromised publisher.
 *
 * A source with a URL template (`{yyyy-mm}`) is tried for the current UTC month, then the previous
 * one, since DB-IP keeps two months online; a 404 on both is `not_published`. The `Last-Modified`
 * answer header is kept as the exit list's fallback publication time (C92.2 step 6). Nothing here
 * logs; an error carries a code, never a URL. Owner: `api-network` (Workflow 7A Stage 3).
 */
import { createHash } from 'node:crypto';
import type { FileHandle } from 'node:fs/promises';
import { OutboundHttpError, type OutboundHttp, type OutboundStreamClient } from '../http/index.js';
import { STREAM_NO_CONTENT_TYPE } from '../http/stream.js';
import { streamToFile } from '../sync/runner.js';
import { NETWORK_CONTENT_TYPE_NONE, type NetworkManifestSource } from './manifest.js';

/** A download failure, by the code the sources page shows. */
export type NetworkDownloadCode =
  | 'download_failed'
  | 'download_too_large'
  | 'content_type_refused'
  | 'redirect_refused'
  | 'timeout'
  | 'not_published';

export class NetworkDownloadError extends Error {
  override name = 'NetworkDownloadError';
  readonly code: NetworkDownloadCode;

  constructor(code: NetworkDownloadCode) {
    super(`network download failed (${code})`);
    this.code = code;
  }
}

/** What the download wrote to the private file. */
export interface NetworkDownload {
  sha256: string;
  bytes: number;
  /** The `Last-Modified` the publisher sent, the exit list's fallback publication time. */
  lastModified: Date | null;
}

/** The answer headers a network download reads. */
export const NETWORK_EXPOSED_HEADERS = ['last-modified', 'etag'] as const;

/** The digest page's cap: a page, not a publication. */
export const DIGEST_PAGE_MAX_BYTES = 2 * 1024 * 1024;

function codeOf(error: unknown): NetworkDownloadCode {
  if (error instanceof NetworkDownloadError) {
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

const month = (at: Date) =>
  `${String(at.getUTCFullYear())}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;

/** The URLs a sync tries, in order (a template: this UTC month, then the previous one). */
export function networkSourceUrls(source: NetworkManifestSource, now: Date): string[] {
  if (source.url_template === null) {
    return [...source.urls];
  }
  const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return [now, previous].map((at) => (source.url_template ?? '').replace('{yyyy-mm}', month(at)));
}

function clientOf(
  http: OutboundHttp | undefined,
  options: Parameters<NonNullable<OutboundHttp['streamClient']>>[0],
): OutboundStreamClient {
  if (http?.streamClient === undefined) {
    throw new NetworkDownloadError('download_failed');
  }
  return http.streamClient(options);
}

function dateOf(header: string | undefined): Date | null {
  if (header === undefined) {
    return null;
  }
  const at = new Date(header);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * C92.2 step 3: downloads the source's file into `handle` (the private file, opened `w+` with
 * mode 0600), hashing it as it arrives.
 * @throws {NetworkDownloadError} without a usable answer.
 */
export async function downloadNetworkSource(
  source: NetworkManifestSource,
  context: { outboundHttp: OutboundHttp | undefined; handle: FileHandle; now: Date },
): Promise<NetworkDownload> {
  try {
    const client = clientOf(context.outboundHttp, {
      name: source.id,
      contentTypes: source.content_types.map((type) =>
        type === NETWORK_CONTENT_TYPE_NONE ? STREAM_NO_CONTENT_TYPE : type,
      ),
      maxResponseBytes: source.max_bytes.compressed,
      timeoutMs: (source.timeout_seconds ?? 300) * 1000,
      exposeHeaders: [...NETWORK_EXPOSED_HEADERS],
      redirect:
        source.redirect_host === null ? undefined : { maxHops: 1, host: source.redirect_host },
    });
    const urls = networkSourceUrls(source, context.now);
    for (const [index, url] of urls.entries()) {
      const answer = await streamToFile(client, { method: 'GET', url }, context.handle);
      if (answer.status >= 200 && answer.status <= 299) {
        return {
          sha256: answer.sha256,
          bytes: answer.bytes,
          lastModified: dateOf(answer.headers['last-modified']),
        };
      }
      const last = index === urls.length - 1;
      if (answer.status !== 404 || source.url_template === null) {
        throw new NetworkDownloadError('download_failed');
      }
      if (last) {
        throw new NetworkDownloadError('not_published');
      }
    }
    throw new NetworkDownloadError('download_failed');
  } catch (error) {
    throw new NetworkDownloadError(codeOf(error));
  }
}

/**
 * C92.2 step 4: whether the publisher's digest page names the SHA-1 of the decompressed file
 * (DB-IP prints it among other digests, so any 40-hex token that equals it counts). `true` for a
 * source without a digest page.
 * @throws {NetworkDownloadError} when the page cannot be read.
 */
export async function publisherDigestMatches(
  source: NetworkManifestSource,
  decompressed: Uint8Array,
  outboundHttp: OutboundHttp | undefined,
): Promise<boolean> {
  if (source.digest === null) {
    return true;
  }
  const chunks: Uint8Array[] = [];
  try {
    const client = clientOf(outboundHttp, {
      name: `${source.id}-digest`,
      contentTypes: ['text/html'],
      maxResponseBytes: DIGEST_PAGE_MAX_BYTES,
      timeoutMs: 60_000,
    });
    const answer = await client.stream(
      { method: 'GET', url: source.digest.page_url },
      {
        write(chunk) {
          chunks.push(chunk);
          return Promise.resolve();
        },
      },
    );
    if (answer.status < 200 || answer.status > 299) {
      throw new NetworkDownloadError('download_failed');
    }
  } catch (error) {
    throw new NetworkDownloadError(codeOf(error));
  }
  const expected = createHash('sha1').update(decompressed).digest('hex');
  const page = Buffer.concat(chunks).toString('latin1').toLowerCase();
  const tokens: readonly string[] = page.match(/\b[0-9a-f]{40}\b/g) ?? [];
  return tokens.includes(expected);
}
