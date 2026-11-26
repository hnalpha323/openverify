import type { ListResource } from '@openverify/contracts';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { DataTable } from '../data-table';
import { LINK_CLASS } from '../link-styles';
import { Timestamp } from '../timestamp';
import { ListStatusBadge } from './list-badges';
import { LIST_KIND_LABELS, kindOfListType } from './list-words';

/** A count as the console writes numbers: with thousands separators. */
export const formatCount = (count: number) => count.toLocaleString('en-US');

/** The lists of the index (C108): name, type, status, item count, version and creation. */
export function ListsTable({
  lists,
  emptyMessage,
}: {
  readonly lists: readonly ListResource[];
  readonly emptyMessage: ReactNode;
}) {
  return (
    <DataTable
      caption="Lists"
      captionHidden
      rows={lists}
      getRowKey={(list) => list.id}
      emptyMessage={emptyMessage}
      columns={[
        {
          id: 'name',
          header: 'Name',
          rowHeader: true,
          cell: (list) => (
            <Link href={`/lists/${list.id}`} className={LINK_CLASS}>
              {list.attributes.name}
            </Link>
          ),
        },
        { id: 'type', header: 'Type', cell: (list) => LIST_KIND_LABELS[kindOfListType(list.type)] },
        {
          id: 'status',
          header: 'Status',
          cell: (list) => <ListStatusBadge status={list.attributes.status} />,
        },
        {
          id: 'items',
          header: 'Items',
          cell: (list) => formatCount(list.attributes['item-count']),
        },
        { id: 'version', header: 'Version', cell: (list) => `v${String(list.attributes.version)}` },
        {
          id: 'created',
          header: 'Created (UTC)',
          cell: (list) => <Timestamp value={list.attributes['created-at']} />,
        },
      ]}
    />
  );
}
