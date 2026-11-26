import type { ConsentRecordResource } from '@openverify/contracts';
import { useId } from 'react';
import { Detail } from '../detail';
import { EmptyValue } from '../masked-value';
import { Badge } from '../status-badge';
import { Timestamp } from '../timestamp';
import type { ConnectAction } from './connection-actions';
import {
  CONNECT_SIDE_WORDS,
  CONSENT_METHOD_WORDS,
  CONSENT_STATUS_TONES,
  CONSENT_STATUS_WORDS,
  CONSENT_WITHDRAWAL_REASON_WORDS,
  CONSENT_WITHDRAWN_VIA_WORDS,
  categoryList,
} from './connect-words';
import { WithdrawConsentButton } from './withdraw-consent-button';

export interface ConsentRecordsListProps {
  readonly records: readonly ConsentRecordResource[];
  /** `connect-share-tokens:write`: an active record may be withdrawn. */
  readonly canWithdraw: boolean;
  readonly withdraw: ConnectAction;
}

const code = (value: string) => <span className="font-mono text-xs break-all">{value}</span>;

/** One record, as an article named by its side and id. */
function ConsentRecordCard({
  record,
  canWithdraw,
  withdraw,
}: {
  readonly record: ConsentRecordResource;
  readonly canWithdraw: boolean;
  readonly withdraw: ConnectAction;
}) {
  const headingId = useId();
  const { attributes } = record;
  const evidence = attributes.evidence;
  const withdrawnAt = attributes['withdrawn-at'];
  const via = attributes['withdrawn-via'];
  const reason = attributes['withdrawal-reason'];
  const body = attributes['text-body'];
  return (
    <article
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 id={headingId} className="text-base font-semibold">
          {CONNECT_SIDE_WORDS[attributes.side]}{' '}
          <span className="font-mono text-xs font-normal text-ink-muted">{record.id}</span>
        </h3>
        {canWithdraw && attributes.status === 'active' && (
          <WithdrawConsentButton
            recordId={record.id}
            recipientName={attributes['recipient-name']}
            action={withdraw}
          />
        )}
      </div>
      {attributes.outcome === 'declined' && (
        <p className="text-sm">
          The person declined this share in the flow. A decline is recorded so that nothing
          overrides it; no token or redemption can cite it.
        </p>
      )}
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Detail term="Status">
          <Badge
            status={attributes.status}
            label={CONSENT_STATUS_WORDS[attributes.status]}
            tone={CONSENT_STATUS_TONES[attributes.status]}
          />
        </Detail>
        <Detail term="Method">{CONSENT_METHOD_WORDS[attributes.method]}</Detail>
        <Detail term="Recipient">{attributes['recipient-name']}</Detail>
        <Detail term="Categories">{categoryList(attributes['data-categories'])}</Detail>
        <Detail term="Explicit biometric consent">
          {attributes['explicit-biometric'] ? 'Yes' : 'No'}
        </Detail>
        <Detail term="Text digest (SHA-256)">{code(attributes.text.sha256)}</Detail>
        {attributes['biometric-text-sha256'] !== null && (
          <Detail term="Biometric text digest">{code(attributes['biometric-text-sha256'])}</Detail>
        )}
        <Detail term="Text language">{attributes.text.locale}</Detail>
        {evidence !== null && 'session-id' in evidence && (
          <Detail term="Flow session">{code(evidence['session-id'])}</Detail>
        )}
        {evidence !== null && 'attested-at' in evidence && (
          <Detail term="Attested (UTC)">
            <Timestamp value={evidence['attested-at']} />
          </Detail>
        )}
        {attributes['evidence-reference'] !== null && (
          <Detail term="Evidence reference">{attributes['evidence-reference']}</Detail>
        )}
        {attributes['ip-address'] !== null && (
          <Detail term="Address">{attributes['ip-address']}</Detail>
        )}
        {attributes['user-agent'] !== null && (
          <Detail term="User agent">{attributes['user-agent']}</Detail>
        )}
        <Detail term="Expires (UTC)">
          <Timestamp value={attributes['expires-at']} />
        </Detail>
        <Detail term="Withdrawn">
          {withdrawnAt === null ? (
            <EmptyValue />
          ) : (
            <>
              <Timestamp value={withdrawnAt} /> UTC.
              {via === null ? '' : ` ${CONSENT_WITHDRAWN_VIA_WORDS[via]}.`}
              {reason === null ? '' : ` ${CONSENT_WITHDRAWAL_REASON_WORDS[reason]}.`}
            </>
          )}
        </Detail>
      </dl>
      {body !== null && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">The stored text</summary>
          <p className="mt-2 whitespace-pre-wrap">{body}</p>
        </details>
      )}
    </article>
  );
}

/**
 * C242.3: an object's consent records, both sides. A `flow` record is witnessed only in what the
 * platform saw (the text served by its digest and an affirmative act in that session); an attested
 * one is the operator's statement, shown as not witnessed (C236.9). The stored text and the evidence
 * appear only as the API served them, which is only with `pii:view`.
 */
export function ConsentRecordsList({ records, canWithdraw, withdraw }: ConsentRecordsListProps) {
  if (records.length === 0) {
    return <p className="text-sm text-ink-muted">No consent record names this object.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {records.map((record) => (
        <ConsentRecordCard
          key={record.id}
          record={record}
          canWithdraw={canWithdraw}
          withdraw={withdraw}
        />
      ))}
    </div>
  );
}
