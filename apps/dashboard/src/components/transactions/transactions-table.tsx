import type { TransactionResource } from '@openverify/contracts';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { DataTable } from '../data-table';
import { TagList } from '../lifecycle/tag-list';
import { LINK_CLASS } from '../link-styles';
import { EmptyValue } from '../masked-value';
import { Timestamp } from '../timestamp';

/**
 * Transactions in a table (C105, C108): id, type, status, reference, tags and creation. No field
 * value is shown here, masked or not.
 */
export function TransactionsTable({
  caption,
  transactions,
  typeNames,
  emptyMessage,
}: {
  readonly caption: string;
  readonly transactions: readonly TransactionResource[];
  /** The names of the types the operator can read, by id. */
  readonly typeNames?: ReadonlyMap<string, string>;
  readonly emptyMessage: ReactNode;
}) {
  return (
    <DataTable
      caption={caption}
      captionHidden
      rows={transactions}
      getRowKey={(transaction) => transaction.id}
      emptyMessage={emptyMessage}
      columns={[
        {
          id: 'id',
          header: 'Transaction',
          rowHeader: true,
          cell: (transaction) => (
            <Link href={`/transactions/${transaction.id}`} className={LINK_CLASS}>
              {transaction.id}
            </Link>
          ),
        },
        ...(typeNames === undefined
          ? []
          : [
              {
                id: 'type',
                header: 'Type',
                cell: (transaction: TransactionResource) => {
                  const typeId = transaction.relationships['transaction-type'].data.id;
                  return (
                    <Link href={`/transaction-types/${typeId}`} className={LINK_CLASS}>
                      {typeNames.get(typeId) ?? typeId}
                    </Link>
                  );
                },
              },
            ]),
        { id: 'status', header: 'Status', cell: (transaction) => transaction.attributes.status },
        {
          id: 'reference',
          header: 'Reference',
          cell: (transaction) => transaction.attributes['reference-id'] ?? <EmptyValue />,
        },
        {
          id: 'tags',
          header: 'Tags',
          cell: (transaction) => <TagList tags={transaction.attributes.tags} />,
        },
        {
          id: 'created',
          header: 'Created (UTC)',
          cell: (transaction) => <Timestamp value={transaction.attributes['created-at']} />,
        },
      ]}
    />
  );
}
