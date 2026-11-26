import type { ImporterResource } from '@openverify/contracts';
import Link from 'next/link';
import { DataTable } from '../data-table';
import { LINK_CLASS } from '../link-styles';
import { Timestamp } from '../timestamp';
import { importerProgress } from './importer-progress';
import { ImporterStatusBadge } from './list-badges';
import { IMPORTER_MODE_LABELS } from './list-words';

/** A list's imports (C100.1, C108): status, counts and mode, each linking its page. */
export function ImportersTable({ importers }: { readonly importers: readonly ImporterResource[] }) {
  return (
    <DataTable
      caption="Imports"
      captionHidden
      rows={importers}
      getRowKey={(importer) => importer.id}
      emptyMessage="No file was imported into this list."
      columns={[
        {
          id: 'id',
          header: 'Import',
          rowHeader: true,
          cell: (importer) => (
            <Link href={`/lists/importers/${importer.id}`} className={LINK_CLASS}>
              {importer.id}
            </Link>
          ),
        },
        {
          id: 'status',
          header: 'Status',
          cell: (importer) => <ImporterStatusBadge status={importer.attributes.status} />,
        },
        {
          id: 'progress',
          header: 'Rows',
          cell: (importer) => importerProgress(importer.attributes),
        },
        {
          id: 'mode',
          header: 'Mode',
          cell: (importer) => IMPORTER_MODE_LABELS[importer.attributes.mode],
        },
        {
          id: 'created',
          header: 'Started (UTC)',
          cell: (importer) => <Timestamp value={importer.attributes['created-at']} />,
        },
      ]}
    />
  );
}
