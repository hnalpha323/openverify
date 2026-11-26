import type { AccountResource } from '@openverify/contracts';
import Link from 'next/link';
import { DataTable, type Column } from '../data-table';
import { LINK_CLASS } from '../link-styles';
import { EmptyValue } from '../masked-value';
import { Timestamp } from '../timestamp';
import { AccountStatusBadge } from './badges';
import { TagList } from './tag-list';

export interface AccountsTableProps {
  readonly accounts: readonly AccountResource[];
  /** Account type names by id. */
  readonly typeNames: ReadonlyMap<string, string>;
  readonly emptyMessage: string;
}

/** A list of accounts (C13), each linking to its page. */
export function AccountsTable({ accounts, typeNames, emptyMessage }: AccountsTableProps) {
  const columns: readonly Column<AccountResource>[] = [
    {
      id: 'id',
      header: 'Account ID',
      rowHeader: true,
      cell: (account) => (
        <Link href={`/accounts/${account.id}`} className={LINK_CLASS}>
          <code className="font-mono text-xs">{account.id}</code>
        </Link>
      ),
    },
    {
      id: 'reference',
      header: 'Reference ID',
      cell: (account) => account.attributes['reference-id'] ?? <EmptyValue />,
    },
    {
      id: 'type',
      header: 'Type',
      cell: (account) => {
        const id = account.relationships['account-type'].data.id;
        return typeNames.get(id) ?? <code className="font-mono text-xs">{id}</code>;
      },
    },
    {
      id: 'status',
      header: 'Status',
      cell: (account) => <AccountStatusBadge status={account.attributes.status} />,
    },
    { id: 'tags', header: 'Tags', cell: (account) => <TagList tags={account.attributes.tags} /> },
    {
      id: 'created',
      header: 'Created (UTC)',
      cell: (account) => <Timestamp value={account.attributes['created-at']} />,
    },
  ];
  return (
    <DataTable
      caption="Accounts"
      captionHidden
      columns={columns}
      rows={accounts}
      getRowKey={(account) => account.id}
      emptyMessage={emptyMessage}
    />
  );
}
