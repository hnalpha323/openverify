/**
 * C108, C92.4, C92.8 (Workflow 7A, `api-network`): `GET /api/v1/dashboard/network-sources`
 * (`settings:read`), the console's read-only network sources page, mirroring the watchlist sources
 * page: each manifest source with whether it is enabled (and by default), sandbox-only or
 * import-only, its last check, last applied sync, publication time, SHA-256 and `origin`, whether
 * it is stale (C92.4, from the last successful check), its last error or refusal and failed
 * checks, its attribution line, link-back and terms note; the newest syncs; and the pinned hosting
 * and VPN ASN seeds this process holds, with their commits and counts. Network data is public: the
 * page names no session, address or subject.
 *
 * Registered in `admin.ts` beside the watchlist sources page; its schema,
 * `dashboardNetworkSourcesSchema`, lives in `@openverify/contracts` (integration-7a).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  listNetworkSourceStates,
  listRecentNetworkSyncs,
  type NetworkSourceState,
  type NetworkSync,
} from '@openverify/db';
import { dashboardNetworkSourcesSchema, type DashboardNetworkSources } from '@openverify/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import { defaultAsnDataPaths, loadAsnData, type AsnData } from '../../network/asn-data.js';
import { networkManifest, type NetworkManifest } from '../../network/manifest.js';
import type { AdminRouteContext } from './admin-context.js';
import { requireOperator } from './authenticate.js';
import { DASHBOARD_TAG, USER_SESSION_SECURITY } from './openapi.js';

// The document's schema is the contracts' (moved there by integration-7a with the route's
// registration); re-exported for the tests beside this file.
export { dashboardNetworkSourcesSchema, type DashboardNetworkSources };

/** What the page is built from. */
export interface NetworkSourcesInput {
  manifest: NetworkManifest;
  states: readonly NetworkSourceState[];
  syncs: readonly NetworkSync[];
  asn: AsnData;
  /** The pinned seeds' commits and digests, from `data/manifest.json`. */
  seeds: readonly { name: string; commit: string | null; sha256: string }[];
  now: Date;
}

/** The newest syncs the page lists. */
export const RECENT_NETWORK_SYNC_LIMIT = 20;

const HOUR_MS = 3_600_000;
const iso = (value: Date | null) => value?.toISOString() ?? null;

/** C108: the sources page, from what the database, the manifest and the data files hold. */
export function networkSourcesDocument(input: NetworkSourcesInput): DashboardNetworkSources {
  const states = new Map(input.states.map((row) => [row.id, row]));
  return {
    sources: input.manifest.sources.map((source) => {
      const row = states.get(source.id);
      const checkedAt = row?.lastCheckedAt ?? null;
      const enabled = row?.enabled ?? false;
      const stale = source.sandbox_only
        ? false
        : !enabled || checkedAt === null || source.stale_after_hours === null
          ? null
          : input.now.getTime() - checkedAt.getTime() > source.stale_after_hours * HOUR_MS;
      return {
        id: source.id,
        publisher: source.publisher,
        role: source.role,
        enabled,
        'enabled-by-default': source.enabled_by_default,
        'sandbox-only': source.sandbox_only,
        'import-only': source.urls.length === 0 && source.url_template === null,
        'last-sync-id': row?.lastSyncId == null ? null : String(row.lastSyncId),
        'last-checked-at': iso(checkedAt),
        'last-applied-at': iso(row?.lastAppliedAt ?? null),
        'published-at': iso(row?.lastPublishedAt ?? null),
        sha256: row?.lastSha256 ?? null,
        origin: row?.lastOrigin ?? null,
        stale,
        'stale-after-hours': source.stale_after_hours,
        'refresh-interval-hours': source.refresh_interval_hours,
        'last-error-code': row?.lastErrorCode ?? null,
        'check-failures': row?.checkFailures ?? 0,
        'last-failed-at': iso(row?.lastFailedAt ?? null),
        attribution: source.attribution,
        'link-back': source.link_back,
        terms: { note: source.terms.note, url: source.terms.url },
      };
    }),
    'recent-syncs': input.syncs.map((sync) => ({
      id: String(sync.id),
      'source-id': sync.sourceId,
      'started-at': sync.startedAt.toISOString(),
      'finished-at': iso(sync.finishedAt),
      outcome: sync.outcome,
      'error-code': sync.errorCode,
      'published-at': iso(sync.publishedAt),
      sha256: sync.sha256,
      'snapshot-bytes': sync.snapshotBytes,
      'entry-count': sync.entryCount,
      actor: sync.actor,
      origin: sync.origin,
      overrides: [...sync.overrides],
    })),
    'asn-seeds': {
      status: input.asn.status,
      files: input.asn.status === 'loaded' ? [] : [...input.asn.files],
      'hosting-asns': input.asn.status === 'loaded' ? input.asn.counts.hosting : null,
      'vpn-asns': input.asn.status === 'loaded' ? input.asn.counts.vpn : null,
      seeds: [...input.seeds],
    },
  };
}

const SEED_NAMES: ReadonlySet<string> = new Set([
  'x4bnet_datacenter_asns',
  'x4bnet_vpn_asns',
  'bad_asn_list',
]);
const seedManifestSchema = z.object({
  data: z.array(z.object({ name: z.string(), url: z.string(), sha256: z.string() })),
});

/** The pinned seeds' commits (in their URLs) and digests, from `data/manifest.json`. */
function pinnedSeeds(): NetworkSourcesInput['seeds'] {
  const { dataDirectory } = defaultAsnDataPaths();
  const manifest = seedManifestSchema.parse(
    JSON.parse(readFileSync(join(dataDirectory, 'manifest.json'), 'utf8')),
  );
  return manifest.data
    .filter((entry) => SEED_NAMES.has(entry.name))
    .map((entry) => ({
      name: entry.name,
      commit: /\b[0-9a-f]{40}\b/.exec(entry.url)?.[0] ?? null,
      sha256: entry.sha256,
    }));
}

export const networkSourceRoutes: FastifyPluginAsyncZod<AdminRouteContext> = (app, context) => {
  app.get(
    '/network-sources',
    {
      config: { scopes: ['settings:read'] },
      schema: {
        summary: 'Get the network sources',
        description:
          'C92, C108: the install-wide network sources and their syncs, staleness, attribution ' +
          'and terms, and the pinned ASN seeds. Public data: names no session or address.',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        response: { 200: dashboardNetworkSourcesSchema, ...problemResponses(401, 403) },
      },
    },
    async (request) => {
      requireOperator(request);
      const [states, syncs] = await Promise.all([
        listNetworkSourceStates(context.db),
        listRecentNetworkSyncs(context.db, RECENT_NETWORK_SYNC_LIMIT),
      ]);
      return networkSourcesDocument({
        manifest: networkManifest(),
        states,
        syncs,
        asn: loadAsnData(),
        seeds: pinnedSeeds(),
        now: context.clock.now(),
      });
    },
  );
  return Promise.resolve();
};
