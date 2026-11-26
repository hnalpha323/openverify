/**
 * C76.1: the committed source manifest, `watchlists/sources.json` at the repository (or image)
 * root. One entry per list source: its publisher and kind, the files the sync downloads, the one
 * host a redirect may go to, the content types and byte caps, the whole request's deadline, the
 * parser, the refresh and staleness intervals, whether it is enabled by default or sandbox-only,
 * the setting it needs before it can sync, its terms note and its attribution line. Live list
 * data never comes from git (ADR 0005): the manifest says where the operator's sync fetches it.
 * It names no change signal (owner decision 10 after Workflow 6B): every check downloads the
 * publication and compares its SHA-256, since a publisher signal that failed to move would mark a
 * changed list fresh. Owner: `api-watchlists` (Workflow 6A Stage 3), then `ingestion-6c`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WATCHLIST_SOURCE_KINDS } from '@openverify/core';
import { watchlistSourceIdSchema } from '@openverify/contracts';
import { z } from 'zod';

/** The manifest's format name. */
export const WATCHLIST_MANIFEST_FORMAT = 'openverify/watchlist-sources/v1';

/** C77.2: the parsers a source names. */
export const WATCHLIST_PARSERS = [
  'ofac-enhanced-xml',
  'eu-fsf-xml',
  'uk-sanctions-list-xml',
  'un-consolidated-xml',
  'wikidata-sparql',
  'normalised-json',
] as const;
export type WatchlistParserId = (typeof WATCHLIST_PARSERS)[number];

/** C76.4: the setting a source needs before it can sync; until it is set it is not configured. */
export const WATCHLIST_SOURCE_REQUIREMENTS = ['eu_fsf_token', 'wikidata_user_agent'] as const;
export type WatchlistSourceRequirement = (typeof WATCHLIST_SOURCE_REQUIREMENTS)[number];

/**
 * OFSI's Consolidated List closed on 2026-01-28 and is no longer updated; a client still pointing
 * at it screens against a frozen list, so no URL or redirect host may name it.
 */
const OFSI = /ofsi/i;
const notOfsi = (value: string) => !OFSI.test(value);
const OFSI_REFUSED = 'OFSI’s closed list is never a source (C76.1)';

const httpsUrl = z.url({ protocol: /^https$/ }).refine(notOfsi, OFSI_REFUSED);
const host = z
  .string()
  // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/)
  .refine(notOfsi, OFSI_REFUSED);

export const watchlistManifestSourceSchema = z.strictObject({
  id: watchlistSourceIdSchema,
  publisher: z.string().min(1).max(200),
  kind: z.enum(WATCHLIST_SOURCE_KINDS),
  /** The files the sync downloads, one per file; empty for a sandbox list (imported only). */
  urls: z.array(httpsUrl).max(4),
  /** The one exact host a redirect may go to (C85.1), or `null` for none. */
  redirect_host: host.nullable(),
  content_types: z.array(z.string().regex(/^[a-z]+\/[a-z0-9.+-]+$/)).max(8),
  max_bytes: z.strictObject({
    compressed: z.int().min(1),
    inflated: z.int().min(1),
  }),
  /** The whole request's deadline (C85.1, F18): per file, or per SPARQL query. */
  timeout_seconds: z.int().min(1).max(3600).nullable(),
  parser: z.enum(WATCHLIST_PARSERS),
  /** The single member of the downloaded ZIP, or `null` when the download is the file itself. */
  archive_member: z.string().min(1).max(100).nullable(),
  /** `null` for a sandbox list, which is never refreshed. */
  refresh_interval_hours: z.int().min(1).max(8760).nullable(),
  /** `null` for a sandbox list, which is never stale (C76.3, V03). */
  stale_after_hours: z.int().min(1).max(8760).nullable(),
  enabled_by_default: z.boolean(),
  sandbox_only: z.boolean(),
  requires: z.enum(WATCHLIST_SOURCE_REQUIREMENTS).nullable(),
  /** The note an operator reads, and where the terms are (none for our own sandbox lists). */
  terms: z.strictObject({ note: z.string().min(1).max(1000), url: httpsUrl.nullable() }),
  /** C76.7: the line shown with every result that used the source. */
  attribution: z.string().min(1).max(500),
  /**
   * C254.2 (Phase 11, Workflow 11B Stage 1a (D); decision 39): the source opts in to conditional
   * requests (`If-None-Match` / `If-Modified-Since`), only for a publisher that sends a strong `ETag`
   * or a `Last-Modified`; absent means false. A 304 records the check as `validated-by: http-304` and
   * downloads nothing; a full download and SHA-256 comparison still runs at least every
   * `watchlist-full-check-hours`. `ingestion-11b` sets it per source and builds the step.
   */
  conditional: z.boolean().optional(),
});
export type WatchlistManifestSource = z.infer<typeof watchlistManifestSourceSchema>;

export const watchlistManifestSchema = z.strictObject({
  $comment: z.string().optional(),
  format: z.literal(WATCHLIST_MANIFEST_FORMAT),
  sources: z
    .array(watchlistManifestSourceSchema)
    .max(64)
    .refine((sources) => new Set(sources.map(({ id }) => id)).size === sources.length, {
      message: 'a source id occurs twice',
    }),
});
export type WatchlistManifest = z.infer<typeof watchlistManifestSchema>;

/** The manifest's path: `watchlists/` at the repository (or image) root. */
export function defaultWatchlistManifestPath(): string {
  return join(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../../..'),
    'watchlists',
    'sources.json',
  );
}

/**
 * Reads and validates the manifest at `path`.
 * @throws {Error} when the file is missing or does not validate; the message names the path's
 *   field, never a value.
 */
export function loadWatchlistManifest(
  path: string = defaultWatchlistManifestPath(),
): WatchlistManifest {
  return watchlistManifestSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

let committed: WatchlistManifest | undefined;

/** The committed manifest, read once per process. */
export function watchlistManifest(): WatchlistManifest {
  committed ??= loadWatchlistManifest();
  return committed;
}

/** A manifest source by id, or `undefined` for an id the manifest does not know. */
export function manifestSource(
  id: string,
  manifest: WatchlistManifest = watchlistManifest(),
): WatchlistManifestSource | undefined {
  return manifest.sources.find((source) => source.id === id);
}
