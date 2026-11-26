import type { ExportResource } from '@openverify/contracts';
import { ANALYTICS_COPY } from '../../lib/copy/analytics';
import { DataTable } from '../data-table';
import { LINK_CLASS } from '../link-styles';
import { Timestamp, formatUtc } from '../timestamp';
import {
  exportHoldsWords,
  exportKeptWords,
  EXPORT_STATUS_WORDS,
  EXPORT_TYPE_WORDS,
} from './export-words';

export interface ExportListProps {
  readonly exports: readonly ExportResource[];
}

/**
 * The caller's exports, newest first (C166.6): beside each download, the filter's shape, the time
 * it was cut, its row count and whether personal data was included, all as the API recorded them.
 */
export function ExportList({ exports }: ExportListProps) {
  return (
    <DataTable
      caption={ANALYTICS_COPY.exports.listTitle}
      captionHidden
      rows={exports}
      getRowKey={(each) => each.id}
      emptyMessage={ANALYTICS_COPY.exports.empty}
      columns={[
        {
          id: 'id',
          header: 'Export',
          rowHeader: true,
          cell: (each) => <code className="font-mono text-xs">{each.id}</code>,
        },
        {
          id: 'type',
          header: 'Of',
          cell: (each) => EXPORT_TYPE_WORDS[each.attributes['object-type']],
        },
        {
          id: 'status',
          header: 'Status',
          cell: (each) => EXPORT_STATUS_WORDS[each.attributes.status],
        },
        { id: 'holds', header: 'Holds', cell: (each) => exportHoldsWords(each.attributes) },
        {
          id: 'personal',
          header: 'Personal data',
          cell: (each) =>
            each.attributes['include-personal-data']
              ? 'Includes personal data'
              : 'Personal data masked',
        },
        {
          id: 'cut',
          header: 'Cut (UTC)',
          cell: (each) => {
            const cut = each.attributes['cut-at'];
            return cut === null ? 'Not cut yet' : <Timestamp value={cut} />;
          },
        },
        { id: 'kept', header: 'Kept', cell: (each) => exportKeptWords(each.attributes, formatUtc) },
        {
          id: 'download',
          header: 'File',
          cell: (each) =>
            each.attributes.status === 'completed' ? (
              // A plain link: the route streams the file as a download (no client code).
              <a
                href={`/exports/${each.id}/download`}
                className={LINK_CLASS}
                aria-label={`Download ${each.id}`}
              >
                Download
              </a>
            ) : (
              ''
            ),
        },
      ]}
    />
  );
}
