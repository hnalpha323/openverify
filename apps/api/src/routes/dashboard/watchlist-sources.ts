/**
 * C72.3, C76 (Phase 6): `GET /api/v1/dashboard/watchlist-sources` (`watchlists:read`), the console's
 * read-only sources page: each source (enabled, configured, keyed by this version, a pending
 * re-screen, last check, last applied sync, publication time, SHA-256, `origin`, entry and name
 * counts, staleness, the last error), the sandbox lists labelled, the templates whose pinned lists
 * hold a disabled source or leave out an enabled one (named, with their type), the asking
 * environment's own scheduled media runs per day beside the GDELT install budget with one flag for
 * the install above 80% of it (never the other tenants' total, owner decision 18), the GDELT
 * citation, whether this process holds the matcher data (owner decision 17), and the attribution
 * lines. List data is public; the page names no
 * screened subject. The schema and scope are frozen (Workflow 6A Stage 1b, `foundation-6`);
 * `api-watchlists` owns this file.
 *
 * "Configured" is read from the row's last error (`source_not_configured`): the API never holds
 * the EU token or the Wikidata contact, which only the worker and the CLIs read. "Keyed by this
 * version" compares the row's `keys_version` with this process's matcher data, which the apps
 * image carries for the API and the worker alike.
 *
 * C254.2 (Workflow 11B, ingestion-11b's borrowed edit): each source also serves whether it opts in
 * to conditional requests, its last validation and how it was made (`http-304`, the publisher's
 * statement, or `sha256`, the platform's comparison) and its last full verification
 * (`servedSourceValidation`, `watchlists/conditional-records.ts`). The validators themselves are
 * never served.
 */
import {
  GDELT_INSTALL_BUDGET,
  WATCHLIST_SOURCE_ERROR_CODES,
  dashboardWatchlistSourcesSchema,
  type DashboardWatchlistSources,
} from '@openverify/contracts';
import { REPORT_REGISTRY, isReportType } from '@openverify/core';
import {
  countWatchlistSourceContents,
  listPendingRescreenSyncs,
  listRecentWatchlistSyncs,
  listReportTemplateSourceLists,
  listWatchlistSourceStates,
  scheduledMediaRunLoad,
  type EnvironmentKind,
  type ReportTemplateSourceList,
  type WatchlistSourceState,
  type WatchlistSync,
} from '@openverify/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { problemResponses } from '../../plugins/openapi.js';
import { GDELT_CITATION } from '../../providers/adverse-media/index.js';
import {
  listSourceCheckRecords,
  servedSourceValidation,
  type SourceCheckRecord,
} from '../../watchlists/conditional-records.js';
import { isWatchlistSourceStale } from '../../watchlists/freshness.js';
import { watchlistManifest, type WatchlistManifest } from '../../watchlists/manifest.js';
import { loadMatcherData } from '../../watchlists/matcher-data.js';
import type { AdminRouteContext } from './admin-context.js';
import { requireOperator } from './authenticate.js';
import { DASHBOARD_TAG, USER_SESSION_SECURITY } from './openapi.js';

/** What the sources page is built from. */
export interface WatchlistSourcesInput {
  manifest: WatchlistManifest;
  states: readonly WatchlistSourceState[];
  counts: ReadonlyMap<string, { entries: number; names: number }>;
  syncs: readonly WatchlistSync[];
  pendingRescreens: ReadonlySet<string>;
  /** This process's matcher data: loaded or not, and its `keysVersion()` (`null` without it). */
  matcher: { loaded: boolean; keysVersion: string | null };
  /** The asking environment's and the install's scheduled media runs per day (C81.2). */
  mediaRuns: { environment: number; install: number };
  templates: readonly ReportTemplateSourceList[];
  environmentKind: EnvironmentKind;
  now: Date;
  /** C254.2: each source row's check columns (absent: nothing known yet). */
  checks?: ReadonlyMap<string, SourceCheckRecord> | undefined;
}

/** The newest syncs the page lists. */
export const RECENT_SYNC_LIMIT = 20;

type SourceErrorCode = (typeof WATCHLIST_SOURCE_ERROR_CODES)[number];
const ERROR_CODES: ReadonlySet<string> = new Set(WATCHLIST_SOURCE_ERROR_CODES);
const isSourceErrorCode = (code: string | null): code is SourceErrorCode =>
  code !== null && ERROR_CODES.has(code);

const iso = (value: Date | null | undefined): string | null => value?.toISOString() ?? null;

/** C72.3: the sources page, from what the database and the manifest hold. */
export function watchlistSourcesDocument(input: WatchlistSourcesInput): DashboardWatchlistSources {
  const states = new Map(input.states.map((state) => [state.id, state]));
  const sources = input.manifest.sources.map((source) => {
    const state = states.get(source.id);
    const counts = input.counts.get(source.id) ?? { entries: 0, names: 0 };
    const errorCode = state?.lastErrorCode ?? null;
    return {
      id: source.id,
      publisher: source.publisher,
      kind: source.kind,
      enabled: state?.enabled ?? false,
      'sandbox-only': source.sandbox_only,
      configured: errorCode !== 'source_not_configured',
      'keys-current':
        input.matcher.keysVersion !== null && state?.keysVersion === input.matcher.keysVersion,
      'last-checked-at': iso(state?.lastCheckedAt),
      'last-applied-at': iso(state?.lastAppliedAt),
      'last-published-at': iso(state?.lastPublishedAt),
      'last-sha256': state?.lastSha256 ?? null,
      'last-origin': state?.lastOrigin ?? null,
      'last-sync-id': state?.lastSyncId == null ? null : String(state.lastSyncId),
      'last-error-code': isSourceErrorCode(errorCode) ? errorCode : null,
      'entry-count': counts.entries,
      'name-count': counts.names,
      stale: isWatchlistSourceStale(source, state, input.now),
      'refresh-interval-hours': source.refresh_interval_hours,
      'stale-after-hours': source.stale_after_hours,
      'rescreen-pending': input.pendingRescreens.has(source.id),
      attribution: source.attribution,
      // C76.7: the terms an operator reads before enabling a source that ships disabled (UN).
      terms: source.enabled_by_default ? null : source.terms.note,
      // C254.2: the last validation and how it was made, and the last full verification.
      ...servedSourceValidation(source, state, input.checks?.get(source.id)),
    };
  });
  const enabled = (id: string) => states.get(id)?.enabled === true;
  const templateWarnings = input.templates.flatMap((template) => {
    const { reportType } = template;
    const kind = isReportType(reportType) ? REPORT_REGISTRY[reportType].sourceKind : null;
    if (!isReportType(reportType) || kind === null) {
      return [];
    }
    const pinned = new Set(template.searchLists);
    const disabled = [...pinned].filter((id) => !enabled(id)).sort();
    const omitted = input.manifest.sources
      .filter(
        (source) =>
          source.kind === kind &&
          enabled(source.id) &&
          !pinned.has(source.id) &&
          (input.environmentKind === 'sandbox' || !source.sandbox_only),
      )
      .map(({ id }) => id)
      .sort();
    return disabled.length === 0 && omitted.length === 0
      ? []
      : [
          {
            'report-template-id': template.reportTemplateId,
            name: template.name,
            'report-type': reportType,
            'disabled-sources': disabled,
            'omitted-sources': omitted,
          },
        ];
  });
  return {
    sources,
    'recent-syncs': input.syncs.map((sync) => ({
      id: String(sync.id),
      'source-id': sync.sourceId,
      'started-at': sync.startedAt.toISOString(),
      'finished-at': iso(sync.finishedAt),
      outcome: sync.outcome,
      'published-at': iso(sync.publishedAt),
      sha256: sync.sha256,
      'entry-count': sync.entryCount,
      added: sync.added,
      changed: sync.changed,
      removed: sync.removed,
      actor: sync.actor,
      origin: sync.origin,
      override: sync.override,
    })),
    // C81.2, owner decision 18 (R004): the environment's own runs; of the install, one flag.
    media: {
      'environment-scheduled-runs-per-day': input.mediaRuns.environment,
      'install-budget-per-day': GDELT_INSTALL_BUDGET.requestsPerDay,
      'warn-above-share': GDELT_INSTALL_BUDGET.warnAboveShare,
      'install-above-warn-share':
        input.mediaRuns.install >
        GDELT_INSTALL_BUDGET.requestsPerDay * GDELT_INSTALL_BUDGET.warnAboveShare,
      attribution: GDELT_CITATION,
    },
    matcher: {
      loaded: input.matcher.loaded,
      'keys-version': input.matcher.loaded ? input.matcher.keysVersion : null,
    },
    'template-warnings': templateWarnings,
  };
}

export const watchlistSourceRoutes: FastifyPluginAsyncZod<AdminRouteContext> = (app, context) => {
  app.get(
    '/watchlist-sources',
    {
      config: { scopes: ['watchlists:read'] },
      schema: {
        summary: 'Get the watchlist sources',
        description:
          'C72.3, C76, C86: the install-wide list sources and their syncs, the templates whose ' +
          'pinned lists differ from what is enabled, and the GDELT budget line. Holds no ' +
          'screened subject.',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        response: { 200: dashboardWatchlistSourcesSchema, ...problemResponses(401, 403) },
      },
    },
    async (request) => {
      const operator = requireOperator(request);
      const { db } = context;
      const [states, counts, syncs, pending, mediaRuns, templates, checks] = await Promise.all([
        listWatchlistSourceStates(db),
        countWatchlistSourceContents(db),
        listRecentWatchlistSyncs(db, RECENT_SYNC_LIMIT),
        listPendingRescreenSyncs(db, {
          enqueuedBefore: new Date('9999-12-31T00:00:00.000Z'),
          limit: 1000,
        }),
        scheduledMediaRunLoad(db, operator.environmentId),
        listReportTemplateSourceLists(db, operator.environmentId),
        listSourceCheckRecords(db),
      ]);
      const matcher = loadMatcherData();
      return watchlistSourcesDocument({
        manifest: watchlistManifest(),
        states,
        counts,
        syncs,
        pendingRescreens: new Set(pending.map(({ sourceId }) => sourceId)),
        matcher: {
          loaded: matcher.status === 'loaded',
          keysVersion: matcher.status === 'loaded' ? matcher.keysVersion : null,
        },
        mediaRuns: {
          environment: mediaRuns.environmentRunsPerDay,
          install: mediaRuns.installRunsPerDay,
        },
        templates,
        environmentKind: operator.environmentKind,
        now: context.clock.now(),
        checks,
      });
    },
  );
  return Promise.resolve();
};
