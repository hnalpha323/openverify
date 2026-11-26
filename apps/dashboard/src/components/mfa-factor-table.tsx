import type { MfaFactorKind } from '@openverify/contracts';
import type { ActionResult, ActionState } from '../lib/action-state';
import type { FactorSummary } from '../lib/mfa-enrolment';
import { ConfirmActionButton } from './confirm-action-button';
import { DataTable, type Column } from './data-table';
import { Timestamp } from './timestamp';

const KINDS: Record<MfaFactorKind, string> = {
  totp: 'Authenticator app',
  webauthn: 'Security key',
};

const labelOf = (factor: FactorSummary) => factor.name ?? KINDS[factor.kind];

export interface MfaFactorTableProps {
  readonly factors: readonly FactorSummary[];
  readonly remove: (state: ActionState, formData: FormData) => Promise<ActionResult>;
  /** False for a session that may not remove factors (2B F002). */
  readonly canRemove: boolean;
}

/** The operator's second factors, each removable after a confirmation. */
export function MfaFactorTable({ factors, remove, canRemove }: MfaFactorTableProps) {
  const activeCount = factors.filter((factor) => factor.status === 'active').length;
  const columns: Column<FactorSummary>[] = [
    { id: 'name', header: 'Name', rowHeader: true, cell: labelOf },
    { id: 'kind', header: 'Type', cell: (factor) => KINDS[factor.kind] },
    {
      id: 'status',
      header: 'Status',
      cell: (factor) => (factor.status === 'active' ? 'Active' : 'Waiting for a code'),
    },
    {
      id: 'added',
      header: 'Added (UTC)',
      cell: (factor) => <Timestamp value={factor.createdAt} />,
    },
    {
      id: 'used',
      header: 'Last used (UTC)',
      cell: (factor) =>
        factor.lastUsedAt === null ? 'Never' : <Timestamp value={factor.lastUsedAt} />,
    },
  ];
  if (canRemove) {
    columns.push({
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      cell: (factor) => (
        <ConfirmActionButton
          label={`Remove ${labelOf(factor)}`}
          variant="secondary"
          title={`Remove ${labelOf(factor)}?`}
          description={
            factor.status === 'active' && activeCount === 1
              ? 'It is your last second factor: your recovery codes stop working too.'
              : 'You can no longer sign in with it.'
          }
          confirmLabel="Remove factor"
          pendingLabel="Removing…"
          action={remove}
          fields={{ 'factor-id': factor.id }}
          successMessage="The factor was removed."
        />
      ),
    });
  }
  return (
    <DataTable
      caption="Second factors"
      columns={columns}
      rows={factors}
      getRowKey={(factor) => factor.id}
      emptyMessage="No second factor yet."
    />
  );
}
