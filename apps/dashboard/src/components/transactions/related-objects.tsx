import type { TransactionResource } from '@openverify/contracts';
import Link from 'next/link';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { VERIFICATION_TYPE_LABELS } from '../../lib/labels';
import { ConfirmActionButton } from '../confirm-action-button';
import { DataTable } from '../data-table';
import { LINK_CLASS } from '../link-styles';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;
type RelatedObject = TransactionResource['relationships']['related-objects']['data'][number];

/** Where the console shows an object, when it has a page for it. */
function hrefOf(object: RelatedObject): string | undefined {
  if (object.type === 'account') {
    return `/accounts/${object.id}`;
  }
  if (object.type === 'inquiry') {
    return `/inquiries/${object.id}`;
  }
  if (object.type.startsWith('report/')) {
    return `/reports/${object.id}`;
  }
  return undefined;
}

function kindOf(object: RelatedObject): string {
  if (object.type === 'account') {
    return 'Account';
  }
  if (object.type === 'inquiry') {
    return 'Inquiry';
  }
  if (object.type.startsWith('report/')) {
    return 'Report';
  }
  const label = (VERIFICATION_TYPE_LABELS as Readonly<Record<string, string>>)[object.type];
  return `${label ?? 'A'} verification`;
}

/**
 * A transaction's related objects (C105.1): the account its `reference-id` named on create, which
 * `remove-objects` cannot take, and the inquiries, reports and verifications attached with
 * `add-objects`, which can be detached. A relation is not a related object: `add-relation` writes
 * no row here, and `TransactionRelations` lists them.
 */
export function RelatedObjects({
  transaction,
  detach,
}: {
  readonly transaction: TransactionResource;
  /** With `transactions:write` on an unredacted transaction. */
  readonly detach?: Action | undefined;
}) {
  return (
    <DataTable
      caption="Related objects"
      captionHidden
      rows={transaction.relationships['related-objects'].data}
      getRowKey={(object) => object.id}
      emptyMessage="No object is related to this transaction."
      columns={[
        {
          id: 'id',
          header: 'Object',
          rowHeader: true,
          cell: (object) => {
            const href = hrefOf(object);
            return href === undefined ? (
              object.id
            ) : (
              <Link href={href} className={LINK_CLASS}>
                {object.id}
              </Link>
            );
          },
        },
        { id: 'kind', header: 'Kind', cell: kindOf },
        ...(detach === undefined
          ? []
          : [
              {
                id: 'actions',
                header: <span className="sr-only">Actions</span>,
                cell: (object: RelatedObject) =>
                  object.type === 'account' ? null : (
                    <ConfirmActionButton
                      label="Detach"
                      accessibleLabel={`Detach ${object.id}`}
                      variant="secondary"
                      title="Detach this object?"
                      description="The object stays as it is; it is no longer related to this transaction."
                      confirmLabel="Detach"
                      pendingLabel="Detaching…"
                      action={detach}
                      fields={{ 'transaction-id': transaction.id, 'object-id': object.id }}
                      successMessage="Detached the object."
                    />
                  ),
              },
            ]),
      ]}
    />
  );
}
