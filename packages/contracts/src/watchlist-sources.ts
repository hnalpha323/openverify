/**
 * Watchlist sources as the console reads them (plan C72.3, C73.3, C76, C81.2): the dashboard
 * `GET /api/v1/dashboard/watchlist-sources` answer (`watchlists:read`) and the vocabulary of
 * syncs. List data itself never reaches it: counts, times, digests and codes only.
 */
import { reportTypeSchema } from '@openverify/core';
import { z } from 'zod';
import { idSchema } from './ids.js';
import { timestampSchema } from './json-api.js';
import { watchlistSourceIdSchema } from './report-template-config.js';
import { reportTemplateNameSchema } from './report-templates.js';

/** C73.3: how a sync, an import or a re-key ended. */
export const WATCHLIST_SYNC_OUTCOMES = [
  'applied',
  'unchanged',
  'rekeyed',
  'busy',
  'refused_rollback',
  'refused_future',
  'refused_mass_removal',
  'refused_schema',
  'refused_size',
  'refused_matcher_data',
  'error',
] as const;

/** C73.3: who ran it. */
export const WATCHLIST_SYNC_ACTORS = ['cli', 'job', 'seed'] as const;

/** C76.2 (P08): where the data came from; an import is never cited as the publisher's. */
export const WATCHLIST_ORIGINS = ['publisher', 'import'] as const;

/** C76.2: the audited overrides of the CLI. */
export const WATCHLIST_SYNC_OVERRIDES = [
  'allow-mass-removal',
  'accept-older-publication',
  'allow-normalised',
] as const;

/** C74.4 (V05): whether a sync's re-screen still has to run. */
export const WATCHLIST_RESCREEN_STATES = ['none', 'pending', 'done'] as const;

/** C76.2, C76.4: a source's last error, codes only. */
export const WATCHLIST_SOURCE_ERROR_CODES = [
  'source_not_configured',
  'download_failed',
  'download_too_large',
  'content_type_refused',
  'redirect_refused',
  'timeout',
  'parse_failed',
  'refused_rollback',
  'refused_future',
  'refused_mass_removal',
  'refused_schema',
  'refused_size',
  'refused_matcher_data',
] as const;

/** C81.2 (V09): GDELT's install-wide budget (one request per 5 s), warned above 80% (C86). */
export const GDELT_INSTALL_BUDGET = Object.freeze({ requestsPerDay: 17280, warnAboveShare: 0.8 });

const sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'must be a lower-case SHA-256');
const syncId = z.string().min(1).max(64);
const count = z.int().min(0);

/**
 * C254.2 (Phase 11, Workflow 11B Stage 1a (D)): how a source's last check was validated: `http-304`,
 * the publisher answered "not modified" to `If-None-Match` or `If-Modified-Since` and nothing was
 * downloaded (the publisher's statement); `sha256`, the file was downloaded and its digest compared
 * (the platform's own proof, run at least every `watchlist-full-check-hours`).
 */
export const WATCHLIST_VALIDATED_BY = Object.freeze(['http-304', 'sha256'] as const);

/** C72.3: one source on the sources page. */
export const watchlistSourceStatusSchema = z.strictObject({
  id: watchlistSourceIdSchema,
  publisher: z.string().min(1).max(200),
  kind: z.enum(['sanctions', 'pep']),
  /** From the manifest less `OPENVERIFY_WATCHLIST_SOURCES_DISABLED` (C76.4). */
  enabled: z.boolean(),
  /** Synthetic and never stale (V03). */
  'sandbox-only': z.boolean(),
  /** False while a token or User-Agent is missing (`source_not_configured`). */
  configured: z.boolean(),
  /** Keyed by the worker's `keysVersion()`; false needs `watchlists:rekey` (C78.3). */
  'keys-current': z.boolean(),
  'last-checked-at': timestampSchema.nullable(),
  'last-applied-at': timestampSchema.nullable(),
  'last-published-at': timestampSchema.nullable(),
  'last-sha256': sha256.nullable(),
  'last-origin': z.enum(WATCHLIST_ORIGINS).nullable(),
  'last-sync-id': syncId.nullable(),
  'last-error-code': z.enum(WATCHLIST_SOURCE_ERROR_CODES).nullable(),
  'entry-count': count,
  'name-count': count,
  /** C76.3: no successful check within the source's stale limit. */
  stale: z.boolean(),
  /** `null` for a sandbox list, which is never refreshed. */
  'refresh-interval-hours': z.int().min(1).nullable(),
  'stale-after-hours': z.int().min(1).nullable(),
  'rescreen-pending': z.boolean(),
  /** C76.7: the line shown with every result that used the source. */
  attribution: z.string().min(1).max(500),
  /** The terms note an operator reads before enabling the source (the UN list). */
  terms: z.string().min(1).max(1000).nullable(),
  /**
   * C254.2 (Workflow 11B): the manifest's `conditional`, and the source's last validation, how it was
   * made, and its last full download and digest comparison. Optional, so earlier answers parse.
   */
  conditional: z.boolean().optional(),
  'last-validated-at': timestampSchema.nullable().optional(),
  'validated-by': z.enum(WATCHLIST_VALIDATED_BY).nullable().optional(),
  'last-full-check-at': timestampSchema.nullable().optional(),
});

/** C73.3: one row of the `watchlist_syncs` audit table. */
export const watchlistSyncSchema = z.strictObject({
  id: syncId,
  'source-id': watchlistSourceIdSchema,
  'started-at': timestampSchema,
  'finished-at': timestampSchema.nullable(),
  outcome: z.enum(WATCHLIST_SYNC_OUTCOMES),
  'published-at': timestampSchema.nullable(),
  sha256: sha256.nullable(),
  'entry-count': count.nullable(),
  added: count,
  changed: count,
  removed: count,
  actor: z.enum(WATCHLIST_SYNC_ACTORS),
  origin: z.enum(WATCHLIST_ORIGINS).nullable(),
  override: z.enum(WATCHLIST_SYNC_OVERRIDES).nullable(),
});

/** C72.3: `GET /api/v1/dashboard/watchlist-sources`. */
export const dashboardWatchlistSourcesSchema = z.strictObject({
  sources: z.array(watchlistSourceStatusSchema),
  'recent-syncs': z.array(watchlistSyncSchema),
  /**
   * C81.2 (V09), owner decisions 17 and 18 after 6B (R004): the asking environment's own
   * scheduled media runs per day beside the install's GDELT budget, and one flag saying whether
   * the whole install is above `warn-above-share` of it. The other tenants' total is never served.
   */
  media: z.strictObject({
    /** The sum of 1 / interval over the environment's recurring, unpaused, unredacted media reports. */
    'environment-scheduled-runs-per-day': z.number().min(0),
    'install-budget-per-day': z.int().min(1),
    'warn-above-share': z.number().min(0).max(1),
    /** Whether the install's scheduled media runs are above `warn-above-share` of the budget. */
    'install-above-warn-share': z.boolean(),
    /** C76.7, C81.4: the citation every `gdelt-doc` result carries (`GDELT_CITATION`). */
    attribution: z.string().min(1).max(500),
  }),
  /**
   * Owner decision 17: whether this API process holds the variant groups, and its `keysVersion()`
   * when it does, so the console can tell an API without the matcher data apart from a source
   * that needs a re-key.
   */
  matcher: z
    .strictObject({
      loaded: z.boolean(),
      'keys-version': z.string().min(1).max(500).nullable(),
    })
    .refine((matcher) => matcher.loaded === (matcher['keys-version'] !== null), {
      message: 'a keys version is served exactly when the matcher data is loaded',
      path: ['keys-version'],
    }),
  /** C76.4: templates whose pinned lists hold a disabled source or leave out an enabled one. */
  'template-warnings': z.array(
    z.strictObject({
      'report-template-id': idSchema('rptp'),
      /** Owner decision 17: the template's name and type, so the page needs no other read. */
      name: reportTemplateNameSchema,
      'report-type': reportTypeSchema,
      'disabled-sources': z.array(watchlistSourceIdSchema),
      'omitted-sources': z.array(watchlistSourceIdSchema),
    }),
  ),
});
export type DashboardWatchlistSources = z.infer<typeof dashboardWatchlistSourcesSchema>;

/**
 * C254.1 (Phase 11, Workflow 11B Stage 1a (D); Q10 granted 2026-11-21, Workflow 11G records-11g):
 * the frozen shape of the UN list's opt-in, which `ingestion-11b` built. An environment admin
 * (`settings:write` and `settings:privacy`, with Phase 9's step-up) opts the environment in with
 * `POST /api/v1/dashboard/watchlist-sources/:sourceId/opt-in` and an acknowledgement naming the terms
 * link the sources document serves (`terms.url` of `watchlists/sources.json`), and withdraws with
 * `DELETE` on the same path; each is audited (`WATCHLIST_OPT_IN_AUDIT_ACTIONS`, the user and time).
 * `OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED` is true by default since Q10's grant (ADR 0005's reading:
 * an environment admin may enable `un-sc` with an audited acknowledgement of the UN's terms); no
 * image bakes a value and no seed opts an environment in. An install that sets it false locks the
 * list: every opt-in answers 409 `watchlist_source_locked` and `un-sc` stays disabled, as Phase 6
 * left it.
 */
export const WATCHLIST_OPT_IN_SOURCES = Object.freeze(['un-sc'] as const);
export const WATCHLIST_UN_OPT_IN_SWITCH = Object.freeze({
  variable: 'OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED',
  default: true,
} as const);

export const watchlistOptInParamsSchema = z.strictObject({
  sourceId: z.enum(WATCHLIST_OPT_IN_SOURCES),
});

/** The acknowledgement: the terms link as served, and an explicit acceptance. */
export const watchlistOptInBodySchema = z.strictObject({
  acknowledgement: z.strictObject({
    'terms-url': z.url({ protocol: /^https$/ }).max(2048),
    accepted: z.literal(true),
  }),
});
export type WatchlistOptInBody = z.infer<typeof watchlistOptInBodySchema>;

/** The environment's recorded opt-in: which terms, when and by whom. */
export const watchlistOptInSchema = z.strictObject({
  'source-id': z.enum(WATCHLIST_OPT_IN_SOURCES),
  'terms-url': z.url({ protocol: /^https$/ }).max(2048),
  'accepted-at': timestampSchema,
  'accepted-by': idSchema('usr'),
});
export type WatchlistOptIn = z.infer<typeof watchlistOptInSchema>;

export const WATCHLIST_OPT_IN_AUDIT_ACTIONS = Object.freeze({
  accepted: 'watchlist-source.opt-in-accepted',
  withdrawn: 'watchlist-source.opt-in-withdrawn',
} as const);
