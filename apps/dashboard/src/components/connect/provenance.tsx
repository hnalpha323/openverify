import type { Provenance } from '@openverify/contracts';
import { Alert } from '@openverify/ui';
import Link from 'next/link';
import { LINK_CLASS } from '../link-styles';
import { Badge } from '../status-badge';
import { formatUtc } from '../timestamp';
import { listInWords } from './connect-words';
import { shareTokenHref } from './connect-paths';

function TokenLink({ id }: { readonly id: string }) {
  return (
    <Link href={shareTokenHref(id)} className={LINK_CLASS}>
      <span className="font-mono text-xs">{id}</span>
    </Link>
  );
}

/**
 * C242.4 (the public marker, connect R20): on every cloned verification and check. A cloned result
 * is the source's, never a check this organization ran; once the consent it rests on is withdrawn
 * (C237.6), the marker says so too.
 */
export function ClonedMarker({
  withdrawnAt,
}: {
  readonly withdrawnAt?: string | null | undefined;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge status="cloned" label="Cloned" tone="attention" />
      {withdrawnAt !== null && withdrawnAt !== undefined && (
        <Badge
          status="consent-withdrawn"
          label={`Consent withdrawn ${formatUtc(withdrawnAt)} UTC`}
          tone="neutral"
        />
      )}
    </span>
  );
}

/**
 * C242.4, C235.1: the banner on an object a redemption made or filled, naming the token and the
 * source organization (the source's object ids are never disclosed). A clone keeps the source's
 * statuses and checks, and none of them is a check this organization ran (C235.5).
 */
export function ProvenanceBanner({
  provenance,
  objectWord,
}: {
  readonly provenance: Provenance;
  /** "inquiry", "account" or "transaction". */
  readonly objectWord: string;
}) {
  const source = provenance['source-organization-name'];
  const withdrawnAt = provenance['consent-withdrawn-at'] ?? null;
  const withdrawn =
    withdrawnAt === null
      ? null
      : `The consent to receive this share was withdrawn on ${formatUtc(withdrawnAt)} UTC: from then on these copies no longer count toward your template.`;
  if (provenance.kind === 'connect-hydrate') {
    return (
      <Alert tone="info" title={`Fields filled from ${source}`}>
        <p>
          On {formatUtc(provenance['hydrated-at'])} UTC, share token{' '}
          <TokenLink id={provenance['share-token-id']} /> filled this {objectWord}’s{' '}
          {listInWords(provenance.fields, 'no field')}. The values are {source}’s, copied as they
          were then.
        </p>
        {withdrawn !== null && <p>{withdrawn}</p>}
      </Alert>
    );
  }
  return (
    <Alert tone="info" title={`Cloned from ${source}`}>
      <p>
        This {objectWord} is a copy made through share token{' '}
        <TokenLink id={provenance['share-token-id']} /> from {source}’s{' '}
        {provenance['source-environment-kind']} environment on {formatUtc(provenance['cloned-at'])}{' '}
        UTC, where its status was {provenance['source-status']}. Its verifications and checks keep
        the source’s statuses, tiers and stages; none is a check this organization ran, and they
        count only where your template accepts cloned results.
      </p>
      {withdrawn !== null && <p>{withdrawn}</p>}
    </Alert>
  );
}

/** C242.4, C235.4: on a decision that relied on a cloned result, with its token when known. */
export function ReliedOnClonedNote({ shareTokenId }: { readonly shareTokenId: string | null }) {
  return (
    <p className="text-sm">
      <Badge status="relied-on-cloned" label="Relied on a cloned result" tone="attention" />
      {shareTokenId !== null && (
        <>
          {' '}
          through share token <TokenLink id={shareTokenId} />
        </>
      )}
    </p>
  );
}
