/**
 * C92, C108: the read-only network sources page, from `GET /api/v1/dashboard/network-sources`
 * alone (`settings:read`), mirroring the watchlist sources page. Each source with whether it is
 * enabled, imported only, sandbox-only and stale; its last check and last applied sync with the
 * publication time, SHA-256 and origin; its last refusal (the last error code and failed checks,
 * in words); its attribution with the link-back, and its terms note. Then the recent syncs with
 * their outcomes in words, and the pinned ASN seeds with their commit and counts.
 *
 * Network data is public: the page names no session, address or subject. Every state is a text
 * badge, so nothing is conveyed by colour alone; tables have headers and captions; times are UTC.
 * The operator syncs with `network:sync`, never from the console.
 */
import type { DashboardNetworkSources } from '@openverify/contracts';
import { networkErrorCodeText, networkSyncOutcomeText } from '../../lib/network-words';
import { DataTable, type Column } from '../data-table';
import { Detail } from '../detail';
import { PageSection } from '../lifecycle/page-section';
import { LINK_CLASS } from '../link-styles';
import { Badge } from '../status-badge';
import { Timestamp } from '../timestamp';

type Source = DashboardNetworkSources['sources'][number];
type Sync = DashboardNetworkSources['recent-syncs'][number];
type Seeds = DashboardNetworkSources['asn-seeds'];

export interface NetworkSourcesViewProps {
  readonly sources: DashboardNetworkSources;
}

const NUMBER = new Intl.NumberFormat('en');
const code = (value: string) => <code className="font-mono text-xs break-all">{value}</code>;
const muted = (words: string) => <span className="text-ink-muted">{words}</span>;
const time = (value: string | null, absent: string) =>
  value === null ? muted(absent) : <Timestamp value={value} />;

const ORIGIN_WORDS: Readonly<Record<'publisher' | 'import', string>> = {
  publisher: 'From the publisher',
  import: 'An import, not the publisher’s download',
};

const ACTOR_LABELS: Readonly<Record<Sync['actor'], string>> = {
  cli: 'CLI',
  job: 'Job',
  seed: 'Seed',
};

const OVERRIDE_WORDS: Readonly<Record<Sync['overrides'][number], string>> = {
  'allow-mass-removal': 'Allow mass removal',
  'allow-mass-addition': 'Allow mass addition',
  'accept-older-publication': 'Accept an older publication',
};

const SEED_STATUS_WORDS: Readonly<Record<Seeds['status'], string>> = {
  loaded: 'Loaded',
  missing: 'Missing: the VPN and hosting flags read not evaluated until the seeds are fetched',
  unexpected: 'Unexpected: the files do not match their pinned digests, so they are not used',
};

function staleness(source: Source) {
  if (source['sandbox-only']) {
    return <Badge status="fresh" label="Never stale (sandbox data)" tone="neutral" />;
  }
  if (source.stale === null) {
    return <Badge status="unchecked" label="Never checked" tone="neutral" />;
  }
  const limit = source['stale-after-hours'];
  return source.stale ? (
    <Badge
      status="stale"
      label={`Stale: older than ${limit === null ? 'its limit' : `${NUMBER.format(limit)} hours`}`}
      tone="danger"
    />
  ) : (
    <Badge status="fresh" label="Fresh" tone="neutral" />
  );
}

const SOURCE_COLUMNS: readonly Column<Source>[] = [
  {
    id: 'source',
    header: 'Source',
    rowHeader: true,
    cell: (source) => (
      <span className="flex flex-col items-start gap-0.5">
        {code(source.id)}
        <span className="text-xs text-ink-muted">{source.publisher}</span>
        <span className="text-xs text-ink-muted">Role: {source.role}</span>
        {source['sandbox-only'] && <Badge status="sandbox-only" label="Sandbox" tone="neutral" />}
      </span>
    ),
  },
  {
    id: 'state',
    header: 'State',
    cell: (source) => (
      <span className="flex flex-col items-start gap-1">
        {source.enabled ? (
          <Badge status="enabled" label="Enabled" tone="success" />
        ) : (
          <Badge status="disabled" label="Disabled" tone="neutral" />
        )}
        {source['import-only'] && (
          <Badge status="import-only" label="Imported only" tone="neutral" />
        )}
        {staleness(source)}
        {source['refresh-interval-hours'] !== null && (
          <span className="text-xs text-ink-muted">
            Checked every {NUMBER.format(source['refresh-interval-hours'])} hours
          </span>
        )}
      </span>
    ),
  },
  {
    id: 'checked',
    header: 'Last check (UTC)',
    cell: (source) => time(source['last-checked-at'], 'Never'),
  },
  {
    id: 'applied',
    header: 'Last applied sync',
    cell: (source) =>
      source['last-sync-id'] === null || source['last-applied-at'] === null ? (
        muted('Never applied')
      ) : (
        <span className="flex flex-col">
          <span>Sync {source['last-sync-id']}</span>
          <Timestamp value={source['last-applied-at']} />
        </span>
      ),
  },
  {
    id: 'published',
    header: 'Published (UTC)',
    cell: (source) => time(source['published-at'], 'Not known'),
  },
  {
    id: 'sha',
    header: 'SHA-256',
    cell: (source) => (source.sha256 === null ? muted('None') : code(source.sha256)),
  },
  {
    id: 'origin',
    header: 'Origin',
    cell: (source) => (source.origin === null ? muted('None') : ORIGIN_WORDS[source.origin]),
  },
  {
    id: 'refusal',
    header: 'Last refusal',
    cell: (source) => {
      const error = source['last-error-code'];
      const failures = source['check-failures'];
      if (error === null && failures === 0) {
        return muted('None');
      }
      return (
        <span className="flex flex-col">
          {error !== null && <span>{networkErrorCodeText(error)}</span>}
          {failures > 0 && (
            <span className="text-xs text-ink-muted">
              {NUMBER.format(failures)} failed {failures === 1 ? 'check' : 'checks'}
              {source['last-failed-at'] !== null && (
                <>
                  , the last <Timestamp value={source['last-failed-at']} /> UTC
                </>
              )}
            </span>
          )}
        </span>
      );
    },
  },
  {
    id: 'attribution',
    header: 'Attribution and terms',
    cell: (source) => (
      <span className="flex flex-col gap-1">
        {source['link-back'] === null ? (
          <span>{source.attribution}</span>
        ) : (
          <a href={source['link-back']} className={LINK_CLASS} rel="noopener noreferrer">
            {source.attribution}
          </a>
        )}
        <span className="text-xs text-ink-muted">{source.terms.note}</span>
        {source.terms.url !== null && (
          <a href={source.terms.url} className={LINK_CLASS} rel="noopener noreferrer">
            Terms
          </a>
        )}
      </span>
    ),
  },
];

const SYNC_COLUMNS: readonly Column<Sync>[] = [
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
    cell: (sync) => (
      <span className="flex flex-col">
        <span>{networkSyncOutcomeText(sync.outcome)}</span>
        {sync['error-code'] !== null && (
          <span className="text-xs text-ink-muted">{networkErrorCodeText(sync['error-code'])}</span>
        )}
      </span>
    ),
  },
  {
    id: 'published',
    header: 'Published (UTC)',
    cell: (sync) => time(sync['published-at'], 'Not known'),
  },
  {
    id: 'sha',
    header: 'SHA-256',
    cell: (sync) => (sync.sha256 === null ? muted('None') : code(sync.sha256)),
  },
  { id: 'entries', header: 'Entries', cell: (sync) => NUMBER.format(sync['entry-count']) },
  { id: 'actor', header: 'Run by', cell: (sync) => ACTOR_LABELS[sync.actor] },
  {
    id: 'origin',
    header: 'Origin',
    cell: (sync) => (sync.origin === null ? muted('None') : ORIGIN_WORDS[sync.origin]),
  },
  {
    id: 'overrides',
    header: 'Overrides',
    cell: (sync) =>
      sync.overrides.length === 0
        ? muted('None')
        : sync.overrides.map((override) => OVERRIDE_WORDS[override]).join(', '),
  },
];

function SeedsSection({ seeds }: { readonly seeds: Seeds }) {
  const count = (value: number | null, words: string) =>
    value === null ? muted('Not known') : `${NUMBER.format(value)} ${words}`;
  return (
    <PageSection
      id="network-asn-seeds"
      title="Pinned ASN seeds"
      description="The hosting and VPN network lists, pinned by commit and digest (C92.6). They answer only true or not evaluated: absence from them is never a no."
    >
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Detail term="Status">{SEED_STATUS_WORDS[seeds.status]}</Detail>
        <Detail term="Hosting">{count(seeds['hosting-asns'], 'hosting networks')}</Detail>
        <Detail term="VPN">{count(seeds['vpn-asns'], 'VPN networks')}</Detail>
      </dl>
      {seeds.seeds.length > 0 && (
        <ul aria-label="Seed files" className="flex flex-col gap-1 text-sm">
          {seeds.seeds.map((seed) => (
            <li key={seed.name} className="break-all">
              {code(seed.name)}: commit{' '}
              {seed.commit === null ? muted('not pinned') : code(seed.commit)}, SHA-256{' '}
              {code(seed.sha256)}
            </li>
          ))}
        </ul>
      )}
    </PageSection>
  );
}

export function NetworkSourcesView({ sources }: NetworkSourcesViewProps) {
  return (
    <>
      <PageSection id="network-sources" title="Sources">
        <DataTable
          caption="Network sources"
          captionHidden
          columns={SOURCE_COLUMNS}
          rows={sources.sources}
          getRowKey={(source) => source.id}
          emptyMessage="No network source is configured."
        />
      </PageSection>
      <PageSection id="network-recent-syncs" title="Recent syncs">
        {sources['recent-syncs'].length === 0 ? (
          <p className="text-sm text-ink-muted">No sync has run yet.</p>
        ) : (
          <DataTable
            caption="Recent syncs"
            captionHidden
            columns={SYNC_COLUMNS}
            rows={sources['recent-syncs']}
            getRowKey={(sync) => sync.id}
            emptyMessage="No sync has run yet."
          />
        )}
      </PageSection>
      <SeedsSection seeds={sources['asn-seeds']} />
    </>
  );
}
