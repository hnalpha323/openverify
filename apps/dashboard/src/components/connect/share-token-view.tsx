import { SHARE_TOKEN_PEEK_LIMIT, type ShareTokenResource } from '@openverify/contracts';
import { Alert } from '@openverify/ui';
import Link from 'next/link';
import type { DisplayProblem } from '../../lib/action-state';
import { DataTable } from '../data-table';
import { Detail } from '../detail';
import { PageSection } from '../lifecycle/page-section';
import { LINK_CLASS } from '../link-styles';
import { EmptyValue } from '../masked-value';
import { ENVIRONMENT_NAMES } from '../operators/settings-fields';
import { PageHeader } from '../page-header';
import { PageMain } from '../page-main';
import { Badge } from '../status-badge';
import { Timestamp } from '../timestamp';
import type { ConnectAction } from './connection-actions';
import {
  CONNECT_SETTINGS_PATH,
  SHARE_TOKENS_PATH,
  connectionHref,
  shareTokenHref,
} from './connect-paths';
import {
  CONSENT_METHOD_WORDS,
  SHARE_REDEEM_MODE_WORDS,
  SHARE_TOKEN_EXPIRY_WORDS,
  SHARE_TOKEN_FAILURE_WORDS,
  SHARE_TOKEN_STATUS_TONES,
  SHARE_TOKEN_STATUS_WORDS,
  categoryList,
  listInWords,
} from './connect-words';
import { PeekView } from './peek-view';
import { ExpireShareTokenButton, RedeemShareTokenForm } from './share-token-actions';

export interface ShareTokenAbilities {
  /** `connect-share-tokens:write`: the source expires. */
  readonly write: boolean;
  /** `connect-share-tokens:redeem`: the destination redeems. */
  readonly redeem: boolean;
  /** `connect-share-tokens:peek` and `pii:view`: the destination peeks (C233.1). */
  readonly peek: boolean;
}

/** What the peek answered, when the page asked for one. */
export type PeekOutcome =
  | { readonly kind: 'none' }
  | { readonly kind: 'shown'; readonly token: ShareTokenResource }
  | { readonly kind: 'refused'; readonly problem: DisplayProblem };

export interface ShareTokenViewProps {
  readonly token: ShareTokenResource;
  readonly abilities: ShareTokenAbilities;
  readonly peek: PeekOutcome;
  readonly actions: { readonly expire: ConnectAction; readonly redeem: ConnectAction };
}

/** The console page of an object a token names, by its id's prefix. */
const OBJECT_PATHS: Readonly<Record<string, string>> = {
  inq: '/inquiries',
  acc: '/accounts',
  txn: '/transactions',
  ver: '/verifications',
};

function ObjectLink({ id }: { readonly id: string }) {
  const base = OBJECT_PATHS[id.slice(0, id.indexOf('_'))];
  const text = <span className="font-mono text-xs">{id}</span>;
  return base === undefined ? (
    text
  ) : (
    <Link href={`${base}/${encodeURIComponent(id)}`} className={LINK_CLASS}>
      {text}
    </Link>
  );
}

interface HistoryRow {
  readonly event: string;
  readonly at: string;
  readonly why: string | null;
}

/** C232.6: the token's moves, from the times it records, oldest first. */
function historyOf(token: ShareTokenResource): HistoryRow[] {
  const { attributes } = token;
  const failure = attributes['failure-reason'];
  const expiry = attributes['expiry-reason'];
  const rows: (HistoryRow | null)[] = [
    { event: 'Created', at: attributes['created-at'], why: null },
    attributes['pending-at'] === null
      ? null
      : { event: 'Redemption started', at: attributes['pending-at'], why: null },
    attributes['redeemed-at'] === null
      ? null
      : { event: 'Redeemed', at: attributes['redeemed-at'], why: null },
    attributes['expired-at'] === null
      ? null
      : {
          event: 'Expired',
          at: attributes['expired-at'],
          why: expiry === null ? null : SHARE_TOKEN_EXPIRY_WORDS[expiry],
        },
    attributes['failed-at'] === null
      ? null
      : {
          event: 'Failed',
          at: attributes['failed-at'],
          why: failure === null ? null : SHARE_TOKEN_FAILURE_WORDS[failure],
        },
  ];
  return rows
    .filter((row): row is HistoryRow => row !== null)
    .sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
}

const peeked = (count: number) => `${String(count)} of ${String(SHARE_TOKEN_PEEK_LIMIT)} times`;

/** C242.2, C233: the destination's peek, asked for only by the operator's link. */
function PeekSection({
  token,
  abilities,
  peek,
}: Pick<ShareTokenViewProps, 'token' | 'abilities' | 'peek'>) {
  const sourceData = peek.kind === 'shown' ? peek.token.attributes['source-data'] : undefined;
  return (
    <PageSection
      id="share-token-peek"
      title="Peek"
      description="What the source holds at this moment, as the policy lets you see it. The source can change or redact it before you redeem, and a redemption copies what exists then."
    >
      {!abilities.peek ? (
        <p className="text-sm text-ink-muted">
          Peeking needs connect-share-tokens:peek and pii:view.
        </p>
      ) : peek.kind === 'refused' ? (
        <Alert tone="error" title={peek.problem.title}>
          {peek.problem.detail}
        </Alert>
      ) : peek.kind === 'shown' ? (
        sourceData === undefined ? (
          <p className="text-sm text-ink-muted">The source holds nothing the policy shares.</p>
        ) : (
          <PeekView sourceData={sourceData} />
        )
      ) : token.attributes.status === 'created' ? (
        <p className="text-sm">
          <Link href={`${shareTokenHref(token.id)}?peek=true`} className={LINK_CLASS}>
            Peek at the source data
          </Link>{' '}
          <span className="text-ink-muted">
            Each peek counts: a token is peeked at most {String(SHARE_TOKEN_PEEK_LIMIT)} times.
          </span>
        </p>
      ) : (
        <p className="text-sm text-ink-muted">Only a share token not redeemed yet can be peeked.</p>
      )}
    </PageSection>
  );
}

/**
 * C242.2: one share token as the caller's side sees it (C232.3): the source sees its source object
 * and the consent record it cites; the destination sees neither, and after redemption the object the
 * redemption made or filled. Both see what the share carries and the source consent's method, so a
 * share resting on an attestation is never read as witnessed. The peek and the redemption are the
 * destination's; the expiry is the source's.
 */
export function ShareTokenView({ token, abilities, peek, actions }: ShareTokenViewProps) {
  const { attributes, relationships } = token;
  const outbound = attributes.direction === 'outbound';
  const consent = attributes['source-consent'];
  const summary = attributes['redeem-summary'];
  const mode = attributes['redeem-mode'];
  const source = relationships.source?.data;
  const destination = relationships.destination?.data;
  const consentRecord = relationships['consent-record']?.data;
  const connectionId = relationships.connection.data.id;
  const created = attributes.status === 'created';

  return (
    <PageMain className="gap-8">
      <PageHeader
        breadcrumbs={[
          { label: 'Connect', href: CONNECT_SETTINGS_PATH },
          { label: 'Share tokens', href: SHARE_TOKENS_PATH },
          { label: token.id },
        ]}
        title={
          <>
            Share token <span className="font-mono">{token.id}</span>
          </>
        }
        description={
          <Badge
            status={attributes.status}
            label={SHARE_TOKEN_STATUS_WORDS[attributes.status]}
            tone={SHARE_TOKEN_STATUS_TONES[attributes.status]}
          />
        }
        actions={
          outbound && created && abilities.write ? (
            <ExpireShareTokenButton tokenId={token.id} action={actions.expire} />
          ) : undefined
        }
      />

      <PageSection
        id="share-token-details"
        title="Details"
        description="A share token is a one-time permission to copy, bound to one recipient. It proves nothing about the person."
      >
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Detail term="Direction">
            {outbound ? 'Outbound: you share' : 'Inbound: you receive'}
          </Detail>
          <Detail term="Connection">
            <Link href={connectionHref(connectionId)} className={LINK_CLASS}>
              <span className="font-mono text-xs">{connectionId}</span>
            </Link>
          </Detail>
          {source !== undefined && (
            <Detail term="Source">
              <ObjectLink id={source.id} />
            </Detail>
          )}
          {consentRecord !== undefined && (
            <Detail term="Consent record">
              <span className="font-mono text-xs">{consentRecord.id}</span>
            </Detail>
          )}
          {destination !== undefined && (
            <Detail term="Destination">
              <ObjectLink id={destination.id} />
            </Detail>
          )}
          <Detail term="Environment">{ENVIRONMENT_NAMES[attributes['environment-kind']]}</Detail>
          <Detail term="Policy version">{`Version ${String(attributes['share-policy-version'])}`}</Detail>
          <Detail term="Carries">{categoryList(attributes['data-categories'])}</Detail>
          <Detail term="Consent">{CONSENT_METHOD_WORDS[consent.method]}</Detail>
          <Detail term="Consent covers">{categoryList(consent.categories)}</Detail>
          <Detail term="Explicit biometric consent">
            {consent['explicit-biometric'] ? 'Yes' : 'No'}
          </Detail>
          <Detail term="Consent text digest">
            <span className="font-mono text-xs break-all">{consent['text-sha256']}</span>
          </Detail>
          <Detail term="Peeked">{peeked(attributes['peek-count'])}</Detail>
          <Detail term="Redeemed as">
            {mode === null ? <EmptyValue /> : SHARE_REDEEM_MODE_WORDS[mode]}
          </Detail>
          <Detail term="Expires (UTC)">
            <Timestamp value={attributes['expires-at']} />
          </Detail>
        </dl>
      </PageSection>

      <DataTable
        caption="Status history"
        rows={historyOf(token)}
        getRowKey={(row) => row.event}
        emptyMessage="No change yet."
        columns={[
          { id: 'event', header: 'Event', rowHeader: true, cell: (row) => row.event },
          { id: 'at', header: 'When (UTC)', cell: (row) => <Timestamp value={row.at} /> },
          { id: 'why', header: 'Why', cell: (row) => row.why ?? <EmptyValue /> },
        ]}
      />

      {summary !== null && (
        <PageSection
          id="share-token-summary"
          title="What the redemption copied"
          description="Counts and field keys only, never a value."
        >
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Detail term="Verifications">{String(summary.verifications)}</Detail>
            <Detail term="Checks">{String(summary.checks)}</Detail>
            <Detail term="Files">{String(summary.files)}</Detail>
            <Detail term="Fields">{String(summary.fields)}</Detail>
            <Detail term="Dropped fields">{listInWords(summary['dropped-fields'], 'None')}</Detail>
            <Detail term="Under policy version">{`Version ${String(summary['policy-version'])}`}</Detail>
            <Detail term="Peeked before">{peeked(summary['peek-count'])}</Detail>
          </dl>
        </PageSection>
      )}

      {!outbound && <PeekSection token={token} abilities={abilities} peek={peek} />}

      {!outbound && created && abilities.redeem && (
        <PageSection
          id="share-token-redeem"
          title="Redeem"
          description="Copies the share into your environment once, under the policy version above. A cloned result never counts as a check you ran unless your template accepts cloned results."
        >
          <RedeemShareTokenForm
            tokenId={token.id}
            sourceType={attributes['source-type']}
            action={actions.redeem}
          />
        </PageSection>
      )}
    </PageMain>
  );
}
