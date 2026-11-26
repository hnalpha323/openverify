import type { ConsentRecordResource, Provenance } from '@openverify/contracts';
import type { Permission } from '@openverify/core';
import type { ReactNode } from 'react';
import { classifyApiError } from '../../lib/api/errors';
import { VERIFICATION_TYPE_LABELS } from '../../lib/labels';
import { DataTable } from '../data-table';
import { listConsentRecords } from './connect-api';
import { withdrawConsentRecordAction } from './consent-actions';
import { ConsentRecordsList } from './consent-records';
import { ClonedMarker, ProvenanceBanner } from './provenance';

/** A verification of a cloned inquiry, as the page's own read served it. */
export interface ClonedVerificationRow {
  readonly id: string;
  /** The resource type, such as `verification/government-id`. */
  readonly type: string;
  readonly status: string;
}

export interface ObjectConnectSectionProps {
  /** The inquiry, account or transaction whose page this is. */
  readonly subjectId: string;
  readonly permissions: ReadonlySet<Permission>;
  /** C235.1: the object's provenance, when the page's read serves one (inquiries). */
  readonly provenance?: Provenance | undefined;
  /** The verifications the page's read included (a cloned inquiry's are all copies, C234.3). */
  readonly verifications?: readonly ClonedVerificationRow[] | undefined;
}

type Records =
  | { readonly kind: 'shown'; readonly records: readonly ConsentRecordResource[] }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'none' };

/**
 * The object's consent records, when the operator may read them. The one 404 means Connect is off
 * (C231.10), so there is nothing to show; a 403 is said in the section, which keeps the banner.
 */
async function recordsOf(
  subjectId: string,
  permissions: ReadonlySet<Permission>,
): Promise<Records> {
  if (!permissions.has('connect-share-tokens:read')) {
    return { kind: 'none' };
  }
  try {
    const records = await listConsentRecords(subjectId);
    return records.length === 0 ? { kind: 'none' } : { kind: 'shown', records };
  } catch (error) {
    const kind = classifyApiError(error);
    if (kind === 'not-found') {
      return { kind: 'none' };
    }
    if (kind === 'forbidden') {
      return { kind: 'forbidden' };
    }
    throw error;
  }
}

const OBJECT_WORDS: Readonly<Record<string, string>> = {
  inq: 'inquiry',
  acc: 'account',
  txn: 'transaction',
};

const TYPE_WORDS: Readonly<Record<string, string | undefined>> = VERIFICATION_TYPE_LABELS;
const typeWords = (type: string) => TYPE_WORDS[type] ?? type;
const statusWords = (status: string) =>
  status.charAt(0).toUpperCase() + status.slice(1).replaceAll('_', ' ');

/**
 * C242.3, C242.4: the Connect slot of an inquiry, account or transaction page. A cloned or filled
 * object's banner names the token and the source organization, and every verification of a cloned
 * inquiry carries the Cloned marker, for anyone who may read the object (C242.6: the console never
 * shows a cloned result without its marker); the object's consent records follow, both sides, with
 * Connect's read. `null` when there is nothing to show, so the page leaves the section out.
 */
export async function ObjectConnectSection({
  subjectId,
  permissions,
  provenance,
  verifications = [],
}: ObjectConnectSectionProps): Promise<ReactNode> {
  const records = await recordsOf(subjectId, permissions);
  const cloned = provenance?.kind === 'connect-clone';
  const withdrawnAt = provenance?.['consent-withdrawn-at'];
  if (provenance === undefined && records.kind === 'none') {
    return null;
  }
  const objectWord = OBJECT_WORDS[subjectId.slice(0, subjectId.indexOf('_'))] ?? 'object';
  return (
    <div className="flex flex-col gap-4">
      {provenance !== undefined && (
        <ProvenanceBanner provenance={provenance} objectWord={objectWord} />
      )}
      {cloned && verifications.length > 0 && (
        <DataTable
          caption="Cloned verifications"
          rows={verifications}
          getRowKey={(row) => row.id}
          emptyMessage="No verification was cloned."
          columns={[
            {
              id: 'verification',
              header: 'Verification',
              rowHeader: true,
              cell: (row) => <span className="font-mono text-xs">{row.id}</span>,
            },
            { id: 'type', header: 'Type', cell: (row) => typeWords(row.type) },
            {
              id: 'status',
              header: 'Status at the source',
              cell: (row) => statusWords(row.status),
            },
            {
              id: 'marker',
              header: 'Provenance',
              cell: () => <ClonedMarker withdrawnAt={withdrawnAt} />,
            },
          ]}
        />
      )}
      {records.kind === 'forbidden' && (
        <p className="text-sm text-ink-muted">
          You do not have access to this object’s consent records.
        </p>
      )}
      {records.kind === 'shown' && (
        <ConsentRecordsList
          records={records.records}
          canWithdraw={permissions.has('connect-share-tokens:write')}
          withdraw={withdrawConsentRecordAction}
        />
      )}
    </div>
  );
}
