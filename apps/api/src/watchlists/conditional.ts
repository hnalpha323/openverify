/**
 * C254.2 (Phase 11, Workflow 11B; hardening H3, connect K9; decision 39; Phase 6 decision 10 after
 * 6B): the validator step of a watchlist sync, called by `syncWatchlistSource` (`sync.ts`,
 * `foundation-11b`'s hook) under the source's session lock, before a publisher's file is downloaded
 * (never for an import or the live SPARQL source). Built by `ingestion-11b` over
 * `conditional-policy.ts`.
 *
 * A source that does not opt in (`conditional` absent or false in `watchlists/sources.json`) is
 * untouched: the sync downloads its file and compares the SHA-256 at every check, as Phase 6 left it.
 *
 * For a source that opts in, the step makes the check's one request itself, through the same list
 * client as the download (the source's content types, byte cap, deadline and its one redirect):
 * - with `If-None-Match` and `If-Modified-Since` (the strong `ETag` and `Last-Modified` its last
 *   full verification kept) while that verification is younger than `watchlist-full-check-hours`;
 *   a 304 records `validated-by: http-304` with its time and answers `not-modified` (the sync records
 *   the check as `unchanged`, downloading nothing);
 * - otherwise, or when the publisher answers 200, the body is hashed as it arrives and discarded:
 *   the same SHA-256 as the applied file records a full verification (`validated-by: sha256`,
 *   `last_full_check_at`, the answer's validators) and answers `not-modified`; another SHA-256
 *   answers `download`, and the sync downloads and applies the file as today (ours: the hook runs
 *   before the download and has no step after it, so a changed list is fetched twice, once by each;
 *   its validators are kept only by a later check that finds it unchanged, so a 304 never stands for
 *   a file that was refused).
 * A 304 to a request that carried no validator, any other status, and every client failure are the
 * download's failures (`WatchlistDownloadError`), which the sync records as today.
 *
 * Honesty (C254.3): a 304 is the publisher's statement that its file is unchanged; the platform's
 * own proof remains the digest comparison, run at least every `watchlist-full-check-hours`
 * whatever the 304s say. Nothing here logs; no row holds a list value or the request's URL.
 */
import { createHash } from 'node:crypto';
import type { Db } from '@openverify/db';
import type { WatchlistSettings } from '../config.js';
import type { OutboundHttp } from '../http/index.js';
import { listValidatorsOf, planConditionalCheck } from './conditional-policy.js';
import {
  installWatchlistFullCheckHours,
  recordSourceValidation,
  sourceCheckRecord,
} from './conditional-records.js';
import {
  LIST_EXPOSED_HEADERS,
  WatchlistDownloadError,
  downloadCodeOf,
  sourceDownloadUrl,
} from './download.js';
import type { WatchlistManifestSource } from './manifest.js';

/** What the step reads. */
export interface ConditionalCheckContext {
  db: Db;
  source: WatchlistManifestSource;
  now: Date;
  settings: WatchlistSettings;
  outboundHttp: OutboundHttp | undefined;
}

export type ConditionalCheck =
  { kind: 'download'; headers: Readonly<Record<string, string>> } | { kind: 'not-modified' };

const DOWNLOAD: ConditionalCheck = { kind: 'download', headers: {} };
const NOT_MODIFIED: ConditionalCheck = { kind: 'not-modified' };

/** The check's one request, its body hashed and discarded. */
async function probe(
  context: ConditionalCheckContext,
  headers: Readonly<Record<string, string>>,
): Promise<{ status: number; sha256: string; headers: Record<string, string> }> {
  const { source } = context;
  try {
    const client = context.outboundHttp?.streamClient?.({
      name: source.id,
      contentTypes: source.content_types,
      maxResponseBytes: source.max_bytes.compressed,
      timeoutMs: (source.timeout_seconds ?? 300) * 1000,
      exposeHeaders: [...LIST_EXPOSED_HEADERS],
      redirect:
        source.redirect_host === null ? undefined : { maxHops: 1, host: source.redirect_host },
    });
    if (client === undefined) {
      throw new WatchlistDownloadError('download_failed');
    }
    const hash = createHash('sha256');
    const response = await client.stream(
      {
        method: 'GET',
        url: sourceDownloadUrl(source, context.settings),
        ...(Object.keys(headers).length === 0 ? {} : { headers }),
      },
      {
        write(chunk) {
          hash.update(chunk);
          return Promise.resolve();
        },
      },
    );
    return {
      status: response.status,
      sha256: hash.digest('hex'),
      headers: { ...response.headers },
    };
  } catch (error) {
    throw new WatchlistDownloadError(downloadCodeOf(error));
  }
}

/** C254.2: what this check of the source does (see the module). */
export async function checkSourceConditionally(
  context: ConditionalCheckContext,
): Promise<ConditionalCheck> {
  const { db, source, now } = context;
  if (source.conditional !== true) {
    return DOWNLOAD;
  }
  const record = await sourceCheckRecord(db, source.id);
  if (record === null) {
    return DOWNLOAD;
  }
  const plan = planConditionalCheck(
    {
      conditional: true,
      lastSha256: record.lastSha256,
      lastFullCheckAt: record.lastFullCheckAt,
      validators: record.validators,
    },
    now,
    await installWatchlistFullCheckHours(db),
  );
  const sent = plan.kind === 'conditional' ? plan.headers : {};
  const answer = await probe(context, sent);
  if (answer.status === 304) {
    if (plan.kind !== 'conditional') {
      throw new WatchlistDownloadError('download_failed');
    }
    await recordSourceValidation(db, source.id, now, null);
    return NOT_MODIFIED;
  }
  if (answer.status < 200 || answer.status > 299) {
    throw new WatchlistDownloadError('download_failed');
  }
  if (record.lastSha256 !== null && answer.sha256 === record.lastSha256) {
    await recordSourceValidation(db, source.id, now, listValidatorsOf(answer.headers));
    return NOT_MODIFIED;
  }
  return DOWNLOAD;
}
