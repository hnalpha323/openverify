/**
 * C71.2, C86: the resolved configuration of a report template version, as the API serves it:
 * every key in words beside its key, its value and its default. Every default is provisional
 * (C71.2), so each says so with its source. A server component: it holds no state.
 */
import type { ReportType } from '@openverify/core';
import { DataTable, type Column } from '../data-table';
import { Badge } from '../status-badge';
import { resolvedConfigRows, type ResolvedConfigRow } from './config-words';

export interface ResolvedConfigProps {
  readonly type: ReportType;
  /** The configuration as the API serves it: every key resolved. */
  readonly config: Readonly<Record<string, unknown>>;
  readonly caption?: string;
}

const COLUMNS: readonly Column<ResolvedConfigRow>[] = [
  {
    id: 'setting',
    header: 'Setting',
    rowHeader: true,
    cell: (row) => (
      <span className="flex flex-col gap-0.5">
        <span>{row.label}</span>
        <code className="font-mono text-xs text-ink-muted">{row.key}</code>
      </span>
    ),
  },
  {
    id: 'value',
    header: 'Value',
    cell: (row) => (
      <span className="flex flex-col gap-0.5">
        <span className="break-words">{row.value}</span>
        {row.meaning !== '' && <span className="text-xs text-ink-muted">{row.meaning}</span>}
      </span>
    ),
  },
  {
    id: 'default',
    header: 'Default',
    cell: (row) => {
      if (row.defaultValue === null) {
        return (
          <span className="text-ink-muted">
            {row.key === 'search-lists' ? 'Pinned when the version is saved' : 'None'}
          </span>
        );
      }
      return (
        <span className="flex flex-col items-start gap-0.5">
          {row.isDefault ? (
            <Badge status="default" label="Default" tone="neutral" />
          ) : (
            <span>{row.defaultValue}</span>
          )}
          {row.basis === 'provisional' && (
            <span className="text-xs text-ink-muted">Provisional: {row.source}</span>
          )}
        </span>
      );
    },
  },
];

export function ResolvedConfig({
  type,
  config,
  caption = 'Resolved configuration',
}: ResolvedConfigProps) {
  return (
    <DataTable
      caption={caption}
      columns={COLUMNS}
      rows={resolvedConfigRows(type, config)}
      getRowKey={(row) => row.key}
      emptyMessage="This version sets nothing."
    />
  );
}
