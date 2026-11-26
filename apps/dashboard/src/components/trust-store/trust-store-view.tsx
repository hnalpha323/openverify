/**
 * C62.10, C66: the read-only chip trust store, from `GET /api/v1/dashboard/trust-anchors` alone:
 * whether a production environment can publish an NFC step; each source with whether it is
 * enabled, its last accepted sync, the list's signing time and SHA-256, the anchors it lists and
 * its latest attempt in words; the usable anchors per country; the withdrawn anchors; each CRL's
 * freshness; the sandbox anchors, labelled sandbox-only; and whether the worker refreshes the
 * store and whether ICAO PKD CRLs are fetched, as the API reports them (Workflow 5C review K13).
 * Nothing in it is personal data (a CSCA belongs to an issuing state).
 *
 * Every status is a text badge, so nothing is conveyed by colour alone; tables have headers and
 * captions; timestamps are UTC.
 */
import type {
  DashboardTrustAnchors,
  SandboxTrustAnchor,
  TrustAnchorCountry,
  TrustAnchorSourceStatus,
  TrustCrlStatus,
  WithdrawnTrustAnchor,
} from '@openverify/contracts';
import { wordsFor } from '../../lib/document-words';
import { SANDBOX_ANCHOR_NOTE } from '../../lib/government-id-nfc-words';
import { DataTable, type Column } from '../data-table';
import { Detail } from '../detail';
import { PageSection } from '../lifecycle/page-section';
import { Badge, type BadgeTone } from '../status-badge';
import { Timestamp } from '../timestamp';
import {
  CRL_FRESHNESS_LABELS,
  SYNC_OUTCOME_LABELS,
  SYNC_REASON_WORDS,
  TRUST_SOURCE_LABELS,
  TRUST_STORE_SETTING_WORDS,
  countryName,
  type TrustCrlFreshness,
  type TrustSyncOutcome,
} from './trust-store-words';

const code = (value: string) => <code className="font-mono text-xs break-all">{value}</code>;
const muted = (words: string) => <span className="text-ink-muted">{words}</span>;
const time = (value: string | null, absent: string) =>
  value === null ? muted(absent) : <Timestamp value={value} />;

const SYNC_TONES: Readonly<Record<TrustSyncOutcome, BadgeTone>> = Object.freeze({
  accepted: 'success',
  refused: 'danger',
  failed: 'attention',
});

const FRESHNESS_TONES: Readonly<Record<TrustCrlFreshness, BadgeTone>> = Object.freeze({
  current: 'success',
  expired: 'attention',
});

/** A country by name, with its code for the reader who knows it. */
function Country({ code: country }: { readonly code: string }) {
  return (
    <span className="flex flex-col">
      <span>{countryName(country)}</span>
      <code className="font-mono text-xs text-ink-muted">{country}</code>
    </span>
  );
}

function LatestSync({ source }: { readonly source: TrustAnchorSourceStatus }) {
  const sync = source['last-sync'];
  if (sync === null) {
    return muted('Never synced');
  }
  return (
    <span className="flex flex-col items-start gap-1">
      <Badge
        status={sync.outcome}
        label={SYNC_OUTCOME_LABELS[sync.outcome]}
        tone={SYNC_TONES[sync.outcome]}
      />
      {sync.reason !== null && (
        <span className="text-xs">
          {wordsFor(SYNC_REASON_WORDS, sync.reason) ?? code(sync.reason)}
        </span>
      )}
      <span className="text-xs text-ink-muted">
        {`${String(sync['anchors-seen'])} seen, ${String(sync['anchors-withdrawn'])} withdrawn, ${String(sync['crls-updated'])} CRLs updated`}
      </span>
      <span className="text-xs text-ink-muted">
        <Timestamp value={sync['created-at']} /> UTC
      </span>
    </span>
  );
}

const SOURCE_COLUMNS: readonly Column<TrustAnchorSourceStatus>[] = [
  {
    id: 'source',
    header: 'Source',
    rowHeader: true,
    cell: (source) => (
      <span className="flex flex-col">
        {code(source.id)}
        <span className="text-xs text-ink-muted">
          {wordsFor(TRUST_SOURCE_LABELS, source.id) ?? 'A source of the manifest'}
        </span>
      </span>
    ),
  },
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
  {
    id: 'synced',
    header: 'Last synced (UTC)',
    cell: (source) => time(source['last-synced-at'], 'Never'),
  },
  {
    id: 'signed',
    header: 'List signed (UTC)',
    cell: (source) => time(source['list-signing-time'], 'None'),
  },
  {
    id: 'sha',
    header: 'List SHA-256',
    cell: (source) => {
      const sha = source['list-sha256'];
      return sha === null ? muted('None') : code(sha);
    },
  },
  { id: 'anchors', header: 'Anchors listed', cell: (source) => String(source.anchors) },
  { id: 'latest', header: 'Latest sync', cell: (source) => <LatestSync source={source} /> },
];

const COUNTRY_COLUMNS: readonly Column<TrustAnchorCountry>[] = [
  {
    id: 'country',
    header: 'Country',
    rowHeader: true,
    cell: (row) => <Country code={row.country} />,
  },
  { id: 'anchors', header: 'Usable anchors', cell: (row) => String(row.anchors) },
  { id: 'links', header: 'Link certificates', cell: (row) => String(row['link-certificates']) },
  { id: 'withdrawn', header: 'Withdrawn anchors', cell: (row) => String(row['withdrawn-anchors']) },
  { id: 'expiry', header: 'Next expiry (UTC)', cell: (row) => time(row['next-expiry'], 'None') },
];

const WITHDRAWN_COLUMNS: readonly Column<WithdrawnTrustAnchor>[] = [
  { id: 'subject', header: 'Subject', rowHeader: true, cell: (row) => code(row['subject-dn']) },
  { id: 'country', header: 'Country', cell: (row) => <Country code={row.country} /> },
  { id: 'sha', header: 'SHA-256', cell: (row) => code(row.id) },
  {
    id: 'withdrawn',
    header: 'Withdrawn (UTC)',
    cell: (row) => time(row['withdrawn-at'], 'Its sources were disabled'),
  },
];

const CRL_COLUMNS: readonly Column<TrustCrlStatus>[] = [
  {
    id: 'country',
    header: 'Issuer country',
    rowHeader: true,
    cell: (row) => <Country code={row['issuer-country']} />,
  },
  { id: 'key', header: 'Issuer key ID', cell: (row) => code(row['issuer-key-id']) },
  {
    id: 'this',
    header: 'This update (UTC)',
    cell: (row) => <Timestamp value={row['this-update']} />,
  },
  {
    id: 'next',
    header: 'Next update (UTC)',
    cell: (row) => <Timestamp value={row['next-update']} />,
  },
  {
    id: 'fetched',
    header: 'Fetched (UTC)',
    cell: (row) => <Timestamp value={row['fetched-at']} />,
  },
  {
    id: 'freshness',
    header: 'Freshness',
    cell: (row) => (
      <Badge
        status={row.freshness}
        label={CRL_FRESHNESS_LABELS[row.freshness]}
        tone={FRESHNESS_TONES[row.freshness]}
      />
    ),
  },
];

const SANDBOX_COLUMNS: readonly Column<SandboxTrustAnchor>[] = [
  {
    id: 'country',
    header: 'Country',
    rowHeader: true,
    cell: (row) => <Country code={row.country} />,
  },
  { id: 'sha', header: 'SHA-256', cell: (row) => code(row.id) },
  {
    id: 'from',
    header: 'Valid from (UTC)',
    cell: (row) => <Timestamp value={row['not-before']} />,
  },
  {
    id: 'until',
    header: 'Valid until (UTC)',
    cell: (row) => <Timestamp value={row['not-after']} />,
  },
  {
    id: 'crl',
    header: 'CRL next update (UTC)',
    cell: (row) => time(row['crl-next-update'], 'No CRL'),
  },
];

/** One install setting in words, with what it means (K13). */
function Setting({
  enabled,
  words,
}: {
  readonly enabled: boolean;
  readonly words: (typeof TRUST_STORE_SETTING_WORDS)[keyof typeof TRUST_STORE_SETTING_WORDS];
}) {
  return (
    <span className="flex flex-col gap-0.5">
      <span>{enabled ? words.on : words.off}</span>
      <span className="text-xs text-ink-muted">
        {enabled ? words.explanation.on : words.explanation.off}
      </span>
    </span>
  );
}

/** The chip trust store as the API reports it (C62.10). */
export function TrustStoreView({ store }: { readonly store: DashboardTrustAnchors }) {
  const production = store['has-production-anchor'];
  return (
    <>
      <PageSection id="trust-store-summary" title="Summary">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Detail term="Production anchor">
            <span className="flex flex-col gap-0.5">
              <span>{production ? 'Yes' : 'No'}</span>
              <span className="text-xs text-ink-muted">
                {production
                  ? 'A usable anchor that is not sandbox-only exists, so a production environment can publish an NFC step.'
                  : 'No usable anchor outside the sandbox: publishing an NFC step in a production environment answers provider_not_configured, unless the template accepts review without one.'}
              </span>
            </span>
          </Detail>
          <Detail term="Generated (UTC)">
            <Timestamp value={store['generated-at']} />
          </Detail>
          <Detail term="Store refresh">
            <Setting
              enabled={store.settings['refresh-enabled']}
              words={TRUST_STORE_SETTING_WORDS.refresh}
            />
          </Detail>
          <Detail term="ICAO PKD CRLs">
            <Setting
              enabled={store.settings['icao-crls-allowed']}
              words={TRUST_STORE_SETTING_WORDS.icaoCrls}
            />
          </Detail>
        </dl>
      </PageSection>

      <PageSection
        id="trust-store-sources"
        title="Sources"
        description="The master lists the operator syncs with trust-anchors:sync, each verified against its pinned root."
      >
        <DataTable
          caption="Trust anchor sources"
          captionHidden
          columns={SOURCE_COLUMNS}
          rows={store.sources}
          getRowKey={(source) => source.id}
          emptyMessage="No source has been recorded yet."
        />
      </PageSection>

      <PageSection
        id="trust-store-countries"
        title="Anchors per country"
        description="Usable anchors are listed now by an enabled source; sandbox-only anchors are left out."
      >
        <DataTable
          caption="Anchors per country"
          captionHidden
          columns={COUNTRY_COLUMNS}
          rows={store.countries}
          getRowKey={(row) => row.country}
          emptyMessage="No usable anchor."
        />
      </PageSection>

      <PageSection
        id="trust-store-withdrawn"
        title="Withdrawn anchors"
        description="No enabled source lists these any more: passive authentication answers trust_anchor_withdrawn, and the chip goes to review."
      >
        <DataTable
          caption="Withdrawn anchors"
          captionHidden
          columns={WITHDRAWN_COLUMNS}
          rows={store['withdrawn-anchors']}
          getRowKey={(row) => row.id}
          emptyMessage="No anchor has been withdrawn."
        />
      </PageSection>

      <PageSection
        id="trust-store-crls"
        title="Certificate revocation lists"
        description="A CRL is current while its next update is ahead; without a current one, revocation is undetermined and, under strict revocation, the chip goes to review."
      >
        <DataTable
          caption="Certificate revocation lists"
          captionHidden
          columns={CRL_COLUMNS}
          rows={store.crls}
          getRowKey={(row) => `${row['issuer-key-id']}:${row['this-update']}`}
          emptyMessage="No CRL is held."
        />
      </PageSection>

      <PageSection
        id="trust-store-sandbox"
        title="Sandbox anchors"
        description={SANDBOX_ANCHOR_NOTE}
      >
        <DataTable
          caption="Sandbox-only anchors"
          captionHidden
          columns={SANDBOX_COLUMNS}
          rows={store['sandbox-anchors']}
          getRowKey={(row) => row.id}
          emptyMessage="No sandbox anchor."
        />
      </PageSection>
    </>
  );
}
