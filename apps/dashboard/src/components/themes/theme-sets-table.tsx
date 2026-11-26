import type { ThemeSetResource } from '@openverify/contracts';
import Link from 'next/link';
import { THEMES_COPY } from '../../lib/copy/themes-copy';
import { DataTable, type Column } from '../data-table';
import { LINK_CLASS } from '../link-styles';
import { EmptyValue } from '../masked-value';
import { Timestamp } from '../timestamp';
import { DefaultSetBadge, ThemeSetStatusBadge } from './theme-set-badges';

const copy = THEMES_COPY.list;

const COLUMNS: readonly Column<ThemeSetResource>[] = [
  {
    id: 'name',
    header: copy.name,
    rowHeader: true,
    cell: (set) => (
      <Link href={`/theme-sets/${set.id}`} className={LINK_CLASS}>
        {set.attributes.name}
      </Link>
    ),
  },
  {
    id: 'status',
    header: copy.status,
    cell: (set) => <ThemeSetStatusBadge status={set.attributes.status} />,
  },
  { id: 'revision', header: copy.revision, cell: (set) => String(set.attributes.revision) },
  {
    id: 'default',
    header: copy.default,
    cell: (set) => (set.attributes['is-default'] ? <DefaultSetBadge /> : <EmptyValue />),
  },
  {
    id: 'updated',
    header: copy.updated,
    cell: (set) => <Timestamp value={set.attributes['updated-at']} />,
  },
];

/** The theme sets of one page, in the API's order (newest first). */
export function ThemeSetsTable({
  sets,
  emptyMessage,
}: {
  readonly sets: readonly ThemeSetResource[];
  readonly emptyMessage: string;
}) {
  return (
    <DataTable
      caption={copy.tableCaption}
      captionHidden
      columns={COLUMNS}
      rows={sets}
      getRowKey={(set) => set.id}
      emptyMessage={emptyMessage}
    />
  );
}
