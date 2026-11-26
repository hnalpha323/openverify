/**
 * C72.3, C76, C81.2, C86: the read-only watchlist sources page, from
 * `GET /api/v1/dashboard/watchlist-sources` alone. Each source with its kind, whether it is
 * enabled, its state as a report selecting it meets it, its last error, entry and name counts;
 * the last applied sync of each with its provenance (times, `origin`, SHA-256, override); the
 * templates whose pinned lists differ from what is enabled, by name and type (C76.4, owner
 * decision 17); this environment's own scheduled adverse-media runs against the install's GDELT
 * budget, with the API's flag for the install above 80% of it and the API's GDELT citation (C81.2,
 * owner decisions 17 and 18: never another tenant's figure); whether the API holds the matcher
 * data; the recent syncs; the attribution lines. The page holds no list value and no screened
 * subject: counts, times, digests, names of this environment's templates and codes only.
 *
 * Every state is a text badge with its meaning beside it, so nothing is conveyed by colour alone;
 * tables have headers and captions; times are UTC.
 */
import type { DashboardWatchlistSources } from '@openverify/contracts';
import { toReportResourceType } from '@openverify/core';
import Link from 'next/link';
import { REPORT_TYPE_LABELS } from '../../lib/labels';
import { DataTable, type Column } from '../data-table';
import { Detail } from '../detail';
import { PageSection } from '../lifecycle/page-section';
import { LINK_CLASS } from '../link-styles';
import { Badge } from '../status-badge';
import { Timestamp } from '../timestamp';
import {
  SOURCE_ERROR_WORDS,
  SOURCE_KIND_LABELS,
  SOURCE_ORIGIN_WORDS,
  SYNC_ACTOR_LABELS,
  SYNC_OUTCOME_WORDS,
  SYNC_OVERRIDE_WORDS,
  formatShare,
  mediaBudget,
  sourceStates,
  type SourceState as SourceStateWords,
  type WatchlistSourceStatus,
} from './source-words';

type WatchlistSync = DashboardWatchlistSources['recent-syncs'][number];
type TemplateWarning = DashboardWatchlistSources['template-warnings'][number];

export interface WatchlistSourcesViewProps {
  readonly sources: DashboardWatchlistSources;
  /** Whether the principal holds `report-templates:read`, so a template id can link its page. */
  readonly canReadTemplates: boolean;
  /** The session's environment: a sandbox list is never screened in production (P13). */
  readonly environmentKind?: 'sandbox' | 'production';
}

const NUMBER = new Intl.NumberFormat('en');
const code = (value: string) => <code className="font-mono text-xs break-all">{value}</code>;
const muted = (words: string) => <span className="text-ink-muted">{words}</span>;
const time = (value: string | null, absent: string) =>
  value === null ? muted(absent) : <Timestamp value={value} />;
const ids = (values: readonly string[]) =>
  values.length === 0 ? muted('None') : code(values.join(', '));

/** The source column: its id, publisher and, for a sandbox list, a label saying so. */
function SourceName({ source }: { readonly source: WatchlistSourceStatus }) {
  return (
    <span className="flex flex-col items-start gap-0.5">
      {code(source.id)}
      <span className="text-xs text-ink-muted">{source.publisher}</span>
      {source['sandbox-only'] && (
        <Badge status="sandbox-only" label="Sandbox list" tone="neutral" />
      )}
    </span>
  );
}

/** C254.2: a 304 is the publisher's statement; a digest comparison is the platform's proof. */
const VALIDATED_BY_WORDS = {
  'http-304': 'Not modified, the publisher’s 304',
  sha256: 'Downloaded, SHA-256 compared',
} as const;

function SourceValidation({ source }: { readonly source: WatchlistSourceStatus }) {
  const by = source['validated-by'] ?? null;
  return (
    <span className="flex flex-col items-start gap-0.5">
      {time(source['last-validated-at'] ?? null, 'Never')}
      {by !== null && <span className="text-xs text-ink-muted">{VALIDATED_BY_WORDS[by]}</span>}
      {source.conditional !== true && (
        <span className="text-xs text-ink-muted">Every check downloads</span>
      )}
    </span>
  );
}

function SourceState({ states }: { readonly states: readonly SourceStateWords[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {states.map((state) => (
        <li key={state.key} className="flex flex-col items-start gap-0.5">
          <Badge status={state.key} label={state.label} tone={state.tone} />
          <span className="text-xs text-ink-muted">{state.detail}</span>
        </li>
      ))}
    </ul>
  );
}

function sourceColumns(
  statesOf: (source: WatchlistSourceStatus) => readonly SourceStateWords[],
): readonly Column<WatchlistSourceStatus>[] {
  return [
    {
      id: 'source',
      header: 'Source',
      rowHeader: true,
      cell: (source) => <SourceName source={source} />,
    },
    { id: 'kind', header: 'Kind', cell: (source) => SOURCE_KIND_LABELS[source.kind] },
    {
      id: 'enabled',
      header: 'Enabled',
      cell: (source) =>
        source.enabled ? (
          <Badge status="enabled" label="Enabled" tone="success" />
        ) : (
          <Badge status="disabled" label="Disabled" tone="neutral" />
        ),
    },
    { id: 'state', header: 'State', cell: (source) => <SourceState states={statesOf(source)} /> },
    {
      id: 'checked',
      header: 'Last check (UTC)',
      cell: (source) => time(source['last-checked-at'], 'Never'),
    },
    // C254.2 (Workflow 11B): how the last check was validated, and when the platform last proved
    // the list by downloading it and comparing its SHA-256 (the forced full check).
    {
      id: 'validated',
      header: 'Last validation (UTC)',
      cell: (source) => <SourceValidation source={source} />,
    },
    {
      id: 'full-check',
      header: 'Last full verification (UTC)',
      cell: (source) => time(source['last-full-check-at'] ?? null, 'Never'),
    },
    {
      id: 'entries',
      header: 'Entries',
      cell: (source) =>
        `${NUMBER.format(source['entry-count'])} entries, ${NUMBER.format(source['name-count'])} names`,
    },
    {
      id: 'error',
      header: 'Last error',
      cell: (source) => {
        const error = source['last-error-code'];
        return error === null ? muted('None') : SOURCE_ERROR_WORDS[error];
      },
    },
  ];
}

function provenanceColumns(
  syncs: ReadonlyMap<string, WatchlistSync>,
): readonly Column<WatchlistSourceStatus>[] {
  return [
    { id: 'source', header: 'Source', rowHeader: true, cell: (source) => code(source.id) },
    {
      id: 'sync',
      header: 'Sync',
      cell: (source) => {
        const id = source['last-sync-id'];
        return id === null || source['last-applied-at'] === null
          ? muted('Never applied')
          : code(id);
      },
    },
    {
      id: 'applied',
      header: 'Applied (UTC)',
      cell: (source) => time(source['last-applied-at'], 'Never'),
    },
    {
      id: 'published',
      header: 'Published (UTC)',
      cell: (source) => time(source['last-published-at'], 'Not known'),
    },
    {
      id: 'origin',
      header: 'Origin',
      cell: (source) => {
        const origin = source['last-origin'];
        if (origin === null) {
          return muted('None');
        }
        const words = SOURCE_ORIGIN_WORDS[origin];
        return (
          <span className="flex flex-col">
            <span>{words.label}</span>
            <span className="text-xs text-ink-muted">{words.meaning}</span>
          </span>
        );
      },
    },
    {
      id: 'sha',
      header: 'SHA-256',
      cell: (source) => {
        const sha = source['last-sha256'];
        return sha === null ? muted('None') : code(sha);
      },
    },
    {
      id: 'override',
      header: 'Override',
      cell: (source) => {
        const id = source['last-sync-id'];
        if (id === null || source['last-applied-at'] === null) {
          return muted('None');
        }
        const sync = syncs.get(id);
        if (sync === undefined) {
          return muted('Not among the recent syncs');
        }
        return sync.override === null ? muted('None') : SYNC_OVERRIDE_WORDS[sync.override];
      },
    },
  ];
}

/** Owner decision 17: each warned template by its name (linked for a reader), with its id. */
function warningColumns(canReadTemplates: boolean): readonly Column<TemplateWarning>[] {
  return [
    {
      id: 'template',
      header: 'Template',
      rowHeader: true,
      cell: (warning) => {
        const id = warning['report-template-id'];
        return (
          <span className="flex flex-col items-start gap-0.5">
            {canReadTemplates ? (
              <Link href={`/report-templates/${id}`} className={LINK_CLASS}>
                {warning.name}
              </Link>
            ) : (
              <span>{warning.name}</span>
            )}
            {code(id)}
          </span>
        );
      },
    },
    {
      id: 'type',
      header: 'Type',
      cell: (warning) => REPORT_TYPE_LABELS[toReportResourceType(warning['report-type'])],
    },
    {
      id: 'disabled',
      header: 'Pins disabled sources',
      cell: (warning) => ids(warning['disabled-sources']),
    },
    {
      id: 'omitted',
      header: 'Leaves out enabled sources',
      cell: (warning) => ids(warning['omitted-sources']),
    },
  ];
}

const SYNC_COLUMNS: readonly Column<WatchlistSync>[] = [
  { id: 'id', header: 'Sync', rowHeader: true, cell: (sync) => code(sync.id) },
  { id: 'source', header: 'Source', cell: (sync) => code(sync['source-id']) },
  {
    id: 'started',
    header: 'Started (UTC)',
    cell: (sync) => <Timestamp value={sync['started-at']} />,
  },
  {
    id: 'outcome',
    header: 'Outcome',
    cell: (sync) => {
      const words = SYNC_OUTCOME_WORDS[sync.outcome];
      return (
        <span className="flex flex-col items-start gap-0.5">
          <Badge status={sync.outcome} label={words.label} tone={words.tone} />
          <span className="text-xs text-ink-muted">{words.meaning}</span>
        </span>
      );
    },
  },
  {
    id: 'override',
    header: 'Override',
    cell: (sync) => (sync.override === null ? muted('None') : SYNC_OVERRIDE_WORDS[sync.override]),
  },
  { id: 'actor', header: 'Run by', cell: (sync) => SYNC_ACTOR_LABELS[sync.actor] },
  {
    id: 'origin',
    header: 'Origin',
    cell: (sync) => (sync.origin === null ? muted('None') : SOURCE_ORIGIN_WORDS[sync.origin].label),
  },
  {
    id: 'changes',
    header: 'Changes',
    cell: (sync) =>
      `${NUMBER.format(sync.added)} added, ${NUMBER.format(sync.changed)} changed, ${NUMBER.format(sync.removed)} removed`,
  },
  {
    id: 'published',
    header: 'Published (UTC)',
    cell: (sync) => time(sync['published-at'], 'Not known'),
  },
];

/**
 * C81.2, owner decisions 17 and 18 (R004): this environment's own scheduled media runs per day
 * against the install's GDELT budget, and, from the API's one flag, whether the install as a
 * whole is above 80% of it. No other tenant's figure is served, so none is shown. The citation is
 * the API's (`media.attribution`).
 */
function MediaBudgetLine({ media }: { readonly media: DashboardWatchlistSources['media'] }) {
  const budget = mediaBudget(media);
  return (
    <div className="flex flex-col items-start gap-2 text-sm">
      <p>
        {`${NUMBER.format(budget.runsPerDay)} scheduled adverse-media runs a day in this environment: ${formatShare(budget.share)} of the install’s GDELT budget of ${NUMBER.format(budget.budgetPerDay)} requests a day (one every 5 seconds), which every environment of the install shares.`}
      </p>
      {budget.warn && (
        <span className="flex flex-col items-start gap-1">
          <Badge
            status="over-budget-share"
            label="The install is above 80% of the budget"
            tone="attention"
          />
          <span className="text-ink-muted">
            Across every environment of the install, scheduled adverse-media runs take more than 80%
            of the GDELT budget: media runs may wait for it, and a run that waits 24 hours errors
            provider_error. Lower the recurrence of adverse-media templates or
            OPENVERIFY_REPORTS_MAX_MEDIA_RUNS_PER_DAY.
          </span>
        </span>
      )}
      <p className="text-ink-muted">{media.attribution}</p>
    </div>
  );
}

/** Owner decision 17: what the API process's own matcher data is. */
function MatcherData({ matcher }: { readonly matcher: DashboardWatchlistSources['matcher'] }) {
  const version = matcher['keys-version'];
  return matcher.loaded && version !== null ? (
    <span className="flex flex-col gap-0.5">
      <span>Loaded</span>
      {code(version)}
    </span>
  ) : (
    <span className="flex flex-col gap-0.5">
      <span>The API has no variant groups</span>
      <span className="text-xs text-ink-muted">
        So it cannot say which sources are keyed by this matcher version.
      </span>
    </span>
  );
}

/** The sources page as the API reports it (C72.3). */
export function WatchlistSourcesView({
  sources,
  canReadTemplates,
  environmentKind = 'sandbox',
}: WatchlistSourcesViewProps) {
  const all = sources.sources;
  const matcherLoaded = sources.matcher.loaded;
  const states = new Map(
    all.map((source) => [source.id, sourceStates(source, environmentKind, { matcherLoaded })]),
  );
  const statesOf = (source: WatchlistSourceStatus) => states.get(source.id) ?? [];
  const keysOf = (source: WatchlistSourceStatus) => statesOf(source).map((state) => state.key);
  // Screenable: fresh (or a sandbox list, in a sandbox environment) and keyed by this version.
  const screenable = all.filter((source) => {
    const keys = keysOf(source);
    return (
      !keys.includes('needs_rekey') &&
      keys.some((key) => key === 'fresh' || (key === 'sandbox' && environmentKind === 'sandbox'))
    );
  }).length;
  const attention = all.filter((source) =>
    keysOf(source).some((key) =>
      ['not_configured', 'never_checked', 'needs_rekey', 'stale'].includes(key),
    ),
  ).length;
  const syncs = new Map(sources['recent-syncs'].map((sync) => [sync.id, sync]));
  const terms = all.filter((source) => source.terms !== null);

  return (
    <>
      <PageSection
        id="watchlist-sources-summary"
        title="Summary"
        description="A report that selects a source that is disabled, not configured, never checked, stale or keyed by another matcher version errors (not screened) instead of answering no match."
      >
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Detail term="Enabled sources">
            {`${String(all.filter((source) => source.enabled).length)} of ${String(all.length)}`}
          </Detail>
          <Detail term="Screenable now">
            {matcherLoaded ? String(screenable) : 'Not known: the API has no variant groups'}
          </Detail>
          <Detail term="Need attention">{String(attention)}</Detail>
          <Detail term="Re-screens pending">
            {String(all.filter((source) => source['rescreen-pending']).length)}
          </Detail>
          <Detail term="Matcher data">
            <MatcherData matcher={sources.matcher} />
          </Detail>
        </dl>
      </PageSection>

      <PageSection
        id="watchlist-sources-sources"
        title="Sources"
        description="Install-wide. Freshness counts from the last successful check, never from the publisher’s last change. A sandbox list is screened in sandbox environments only."
      >
        <DataTable
          caption="Watchlist sources"
          captionHidden
          columns={sourceColumns(statesOf)}
          rows={all}
          getRowKey={(source) => source.id}
          emptyMessage="No source is in the manifest."
        />
      </PageSection>

      <PageSection
        id="watchlist-sources-provenance"
        title="Last applied sync per source"
        description="What every report that screened a source cites: the sync, its times, where the file came from and its SHA-256."
      >
        <DataTable
          caption="Last applied sync per source"
          captionHidden
          columns={provenanceColumns(syncs)}
          rows={all}
          getRowKey={(source) => source.id}
          emptyMessage="No source is in the manifest."
        />
      </PageSection>

      <PageSection
        id="watchlist-sources-templates"
        title="Templates to review"
        description="Templates of this environment. One that pins a disabled source makes its reports error list_unavailable naming it; one that leaves out an enabled source never screens it. Publish a new version to change a template’s lists."
      >
        {sources['template-warnings'].length === 0 ? (
          <p className="text-sm text-ink-muted">
            Every template pins exactly the enabled sources of its kind.
          </p>
        ) : (
          <DataTable
            caption="Templates whose pinned lists differ from the enabled sources"
            captionHidden
            columns={warningColumns(canReadTemplates)}
            rows={sources['template-warnings']}
            getRowKey={(warning) => warning['report-template-id']}
            emptyMessage="None."
          />
        )}
      </PageSection>

      <PageSection id="watchlist-sources-media" title="Adverse media budget">
        <MediaBudgetLine media={sources.media} />
      </PageSection>

      <PageSection
        id="watchlist-sources-syncs"
        title="Recent syncs"
        description="Every sync, import, refusal and override, newest first, as watchlist_syncs records them."
      >
        <DataTable
          caption="Recent syncs"
          captionHidden
          columns={SYNC_COLUMNS}
          rows={sources['recent-syncs']}
          getRowKey={(sync) => sync.id}
          emptyMessage="No sync has run yet."
        />
      </PageSection>

      <PageSection
        id="watchlist-sources-attribution"
        title="Attribution"
        description="The line shown with every result that used a source."
      >
        <ul className="flex flex-col gap-1 text-sm">
          {all.map((source) => (
            <li key={source.id}>
              {code(source.id)}: {source.attribution}
            </li>
          ))}
        </ul>
        {terms.length > 0 && (
          <ul
            aria-label="Terms of sources that ship disabled"
            className="flex flex-col gap-1 text-sm"
          >
            {terms.map((source) => (
              <li key={source.id}>
                {code(source.id)} terms: {source.terms}
              </li>
            ))}
          </ul>
        )}
      </PageSection>
    </>
  );
}
