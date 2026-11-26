/**
 * Synthetic API documents for the report configuration pages (Workflow 6B, C86): report templates
 * and their versions, and the watchlist sources page. Every id is a made-up ULID, every digest is
 * the SHA-256 of a made-up seed, and no list value appears: the sources page carries counts,
 * times, digests and codes only. Each builder parses its result with the contract schema, so a
 * fixture that drifts from the contract fails where it is built.
 */
import { createHash } from 'node:crypto';
import {
  buildReportTemplateResource,
  buildReportTemplateVersionResource,
  dashboardWatchlistSourcesSchema,
  type DashboardWatchlistSources,
  type ReportTemplateResource,
  type ReportTemplateVersionResource,
} from '@openverify/contracts';
import type { ReportType } from '@openverify/core';

export const REPORT_CONFIG_IDS = {
  template: 'rptp_01JB0000000000000000000001',
  otherTemplate: 'rptp_01JB0000000000000000000002',
  mediaTemplate: 'rptp_01JB0000000000000000000003',
  version: 'rptpv_01JB0000000000000000000001',
  draft: 'rptpv_01JB0000000000000000000002',
  superseded: 'rptpv_01JB0000000000000000000003',
} as const;

const IDS = REPORT_CONFIG_IDS;
export const RT0 = '2026-10-27T09:00:00.000Z';
export const RT1 = '2026-10-28T10:30:00.000Z';
export const RT2 = '2026-10-28T11:45:00.000Z';

/** A synthetic SHA-256: the digest of a seed, never of any real file. */
export function syntheticSha256(seed: string): string {
  return createHash('sha256').update(`openverify/dashboard-fixtures/${seed}`).digest('hex');
}

/** A keys version in the format the matcher writes, over a synthetic digest (owner decision 17). */
export const KEYS_VERSION = `names-2;identifiers-1;crypto-1;groups-${syntheticSha256('variant-groups')}`;

export const TEMPLATE_NAME = 'Synthetic monitored watchlist';

/**
 * What the seeded sandbox watchlist template stores (C71.3): recurring every 30 days, the sandbox
 * list pinned, every other key at its default.
 */
export const WATCHLIST_CONFIG: Readonly<Record<string, unknown>> = Object.freeze({
  'recurrence-interval-days': 30,
  'search-lists': ['openverify-sandbox'],
});

export interface TemplateOptions {
  readonly id?: string;
  readonly name?: string;
  readonly type?: ReportType;
  readonly status?: 'active' | 'archived';
  readonly versionId?: string;
  readonly versionNumber?: number;
  readonly config?: Readonly<Record<string, unknown>>;
}

/** A report template with its published version (`GET /report-templates/:id`). */
export function reportTemplate({
  id = IDS.template,
  name = TEMPLATE_NAME,
  type = 'watchlist',
  status = 'active',
  versionId = IDS.version,
  versionNumber = 1,
  config = WATCHLIST_CONFIG,
}: TemplateOptions = {}): ReportTemplateResource {
  return buildReportTemplateResource({
    id,
    name,
    reportType: type,
    status,
    createdAt: new Date(RT0),
    updatedAt: new Date(RT1),
    currentVersion: {
      id: versionId,
      versionNumber,
      config,
      createdAt: new Date(RT0),
      publishedAt: new Date(RT0),
    },
  });
}

export interface VersionOptions {
  readonly id?: string;
  readonly templateId?: string;
  readonly type?: ReportType;
  readonly status?: 'draft' | 'published' | 'superseded';
  readonly versionNumber?: number;
  readonly config?: Readonly<Record<string, unknown>>;
}

/** A report template version (`GET /report-template-versions/:id`). */
export function reportTemplateVersion({
  id = IDS.version,
  templateId = IDS.template,
  type = 'watchlist',
  status = 'published',
  versionNumber = 1,
  config = WATCHLIST_CONFIG,
}: VersionOptions = {}): ReportTemplateVersionResource {
  return buildReportTemplateVersionResource({
    id,
    reportTemplateId: templateId,
    reportType: type,
    versionNumber,
    status,
    config,
    createdAt: new Date(status === 'draft' ? RT2 : RT0),
    publishedAt: status === 'draft' ? null : new Date(RT0),
  });
}

/** The template's draft version 2. */
export function reportDraft(options: Omit<VersionOptions, 'status'> = {}) {
  return reportTemplateVersion({ id: IDS.draft, versionNumber: 2, ...options, status: 'draft' });
}

/** `{ data }` around a resource. */
export const single = <T>(data: T) => ({ data });

/** `{ data, links }`: one page of a list. */
export const page = <T>(data: readonly T[], next: string | null = null) => ({
  data,
  links: { next },
});

type SourceStatus = DashboardWatchlistSources['sources'][number];
type WatchlistSync = DashboardWatchlistSources['recent-syncs'][number];

const fresh = (id: string, publisher: string, overrides: Partial<SourceStatus> = {}) =>
  ({
    id,
    publisher,
    kind: 'sanctions',
    enabled: true,
    'sandbox-only': false,
    configured: true,
    'keys-current': true,
    'last-checked-at': RT2,
    'last-applied-at': RT1,
    'last-published-at': RT0,
    'last-sha256': syntheticSha256(id),
    'last-origin': 'publisher',
    'last-sync-id': '41',
    'last-error-code': null,
    'entry-count': 120,
    'name-count': 340,
    stale: false,
    'refresh-interval-hours': 6,
    'stale-after-hours': 48,
    'rescreen-pending': false,
    attribution: `Synthetic attribution line of ${id}`,
    terms: null,
    ...overrides,
  }) satisfies SourceStatus;

const neverSynced = {
  'keys-current': false,
  'last-checked-at': null,
  'last-applied-at': null,
  'last-published-at': null,
  'last-sha256': null,
  'last-origin': null,
  'last-sync-id': null,
  'entry-count': 0,
  'name-count': 0,
} as const satisfies Partial<SourceStatus>;

/** One source in each state the page tells apart. */
export const SOURCE_STATES = {
  /** Checked within its limit, keyed by this version: screenable. */
  fresh: fresh('ofac-sdn', 'US Treasury OFAC'),
  /** Its last successful check is older than its stale limit. */
  stale: fresh('ofac-consolidated', 'US Treasury OFAC', {
    'last-checked-at': RT0,
    'last-sync-id': '7',
    stale: true,
    'last-error-code': 'download_failed',
  }),
  /** No EU token: enabled and selected, never synced. */
  notConfigured: fresh('eu-fsf', 'European Commission', {
    ...neverSynced,
    configured: false,
    'last-error-code': 'source_not_configured',
  }),
  /** Synced by another matcher version, with a re-screen still to run. */
  needsRekey: fresh('uk-sanctions-list', 'FCDO', {
    'keys-current': false,
    'rescreen-pending': true,
    'last-sync-id': '43',
    'last-origin': 'import',
  }),
  /** Disabled install-wide; its terms note is shown. */
  disabled: fresh('un-sc', 'United Nations Security Council', {
    ...neverSynced,
    enabled: false,
    'refresh-interval-hours': 24,
    'stale-after-hours': 72,
    terms: 'Synthetic terms note: personal, non-commercial use only.',
  }),
  /** Enabled and configured but never checked. */
  neverChecked: fresh('wikidata-pep', 'Wikidata', {
    ...neverSynced,
    kind: 'pep',
    'refresh-interval-hours': 168,
    'stale-after-hours': 192,
  }),
  /** The synthetic sandbox list: imported, never stale, never refreshed. */
  sandbox: fresh('openverify-sandbox', 'OpenVerify', {
    'sandbox-only': true,
    'last-origin': 'import',
    'last-sync-id': '2',
    'last-checked-at': RT0,
    'refresh-interval-hours': null,
    'stale-after-hours': null,
    'entry-count': 68,
    'name-count': 150,
  }),
} as const satisfies Record<string, SourceStatus>;

const sync = (overrides: Partial<WatchlistSync> & Pick<WatchlistSync, 'id' | 'source-id'>) =>
  ({
    'started-at': RT1,
    'finished-at': RT1,
    outcome: 'applied',
    'published-at': RT0,
    sha256: syntheticSha256(overrides['source-id']),
    'entry-count': 120,
    added: 3,
    changed: 1,
    removed: 0,
    actor: 'cli',
    origin: 'publisher',
    override: null,
    ...overrides,
  }) satisfies WatchlistSync;

/** The newest syncs: an applied one, a refusal, an audited override and a busy attempt. */
export const RECENT_SYNCS: readonly WatchlistSync[] = [
  sync({
    id: '44',
    'source-id': 'ofac-consolidated',
    outcome: 'refused_mass_removal',
    sha256: null,
    'entry-count': null,
    added: 0,
    changed: 0,
    removed: 0,
    'published-at': null,
    actor: 'job',
  }),
  sync({
    id: '43',
    'source-id': 'uk-sanctions-list',
    origin: 'import',
    override: 'accept-older-publication',
  }),
  sync({
    id: '42',
    'source-id': 'ofac-sdn',
    outcome: 'busy',
    sha256: null,
    'entry-count': null,
    added: 0,
    changed: 0,
    'published-at': null,
    'finished-at': null,
    origin: null,
  }),
  sync({ id: '41', 'source-id': 'ofac-sdn' }),
];

export interface SourcesOptions {
  readonly sources?: readonly SourceStatus[];
  readonly syncs?: readonly WatchlistSync[];
  /** The asking environment's own scheduled media runs per day (owner decision 18). */
  readonly scheduledRunsPerDay?: number;
  /**
   * Whether the install is above 80% of the GDELT budget; by default, whether this environment's
   * own runs are, since an environment's runs are part of the install's.
   */
  readonly installAboveWarnShare?: boolean;
  readonly matcher?: DashboardWatchlistSources['matcher'];
  readonly templateWarnings?: DashboardWatchlistSources['template-warnings'];
  /** `media.attribution`: the GDELT citation the API serves (owner decision 17). */
  readonly mediaAttribution?: string;
}

/** The citation the API's `gdelt-doc` adapter serves (`GDELT_CITATION`), as the API sends it. */
export const MEDIA_ATTRIBUTION =
  'Articles found through the GDELT Project (https://www.gdeltproject.org/): titles and links only.';

/** `GET /dashboard/watchlist-sources`. */
export function watchlistSources({
  sources = Object.values(SOURCE_STATES),
  syncs = RECENT_SYNCS,
  scheduledRunsPerDay = 12.5,
  installAboveWarnShare = scheduledRunsPerDay > 17280 * 0.8,
  matcher = { loaded: true, 'keys-version': KEYS_VERSION },
  templateWarnings = [
    {
      'report-template-id': IDS.template,
      name: 'Synthetic sanctions screening',
      'report-type': 'watchlist',
      'disabled-sources': ['un-sc'],
      'omitted-sources': ['eu-fsf', 'ofac-consolidated'],
    },
  ],
  mediaAttribution = MEDIA_ATTRIBUTION,
}: SourcesOptions = {}): DashboardWatchlistSources {
  return dashboardWatchlistSourcesSchema.parse({
    sources,
    'recent-syncs': syncs,
    media: {
      'environment-scheduled-runs-per-day': scheduledRunsPerDay,
      'install-budget-per-day': 17280,
      'warn-above-share': 0.8,
      'install-above-warn-share': installAboveWarnShare,
      attribution: mediaAttribution,
    },
    matcher,
    'template-warnings': templateWarnings,
  });
}
