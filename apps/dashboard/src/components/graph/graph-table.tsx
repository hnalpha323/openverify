'use client';

import { Button } from '@openverify/ui';
import Link from 'next/link';
import { useState } from 'react';
import { DataTable, type Column } from '../data-table';
import { LINK_CLASS } from '../link-styles';
import {
  accountRows,
  valueRows,
  type AccountRow,
  type ExplorerGraph,
  type ValueRow,
} from './explorer-model';
import { graphKindLabel } from './graph-words';
import { UnmaskButton, type UnmaskAction } from './unmask-button';

export interface GraphTableProps {
  readonly graph: ExplorerGraph;
  /** The selected account ids, shared with the canvas. */
  readonly selected: ReadonlySet<string>;
  readonly onSelectionChange: (next: ReadonlySet<string>) => void;
  readonly piiView: boolean;
  readonly unmask: UnmaskAction;
  /** Expands around an account (an explicit action); absent when no template allows it. */
  readonly onExpand?: (accountId: string) => void;
  /** The account an expansion is running around, whose button waits. */
  readonly expanding?: string | null;
  /**
   * Owner decision 20 after Workflow 7B: expands a shared value (an explicit action); absent
   * without `graph:write`. `whyNot` names what a row lacks (a person kind without `pii:view`).
   */
  readonly valueExpansion?: {
    readonly onExpand: (row: ValueRow) => void;
    readonly whyNot: (row: ValueRow) => string | null;
  };
}

// WCAG 2.5.8 (R009): 24 by 24 px, as the shared Checkbox (D4).
const CHECKBOX =
  'size-6 rounded border-control accent-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

/**
 * R009: the rows each table shows at once, the console's list page size. A result can hold up to
 * 2,000 nodes; one long table is hard to move through by screen reader, and slow to render.
 */
export const GRAPH_TABLE_PAGE_SIZE = 25;

/** One page of `rows`, and the controls that move between pages, named by `noun`. */
function usePaged<Row>(rows: readonly Row[], noun: string, label: string) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / GRAPH_TABLE_PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const start = current * GRAPH_TABLE_PAGE_SIZE;
  const shown = rows.slice(start, start + GRAPH_TABLE_PAGE_SIZE);
  const controls =
    rows.length <= GRAPH_TABLE_PAGE_SIZE ? null : (
      <nav aria-label={`${noun} pages`} className="flex flex-wrap items-center gap-2 text-sm">
        <Button
          variant="secondary"
          disabled={current === 0}
          onClick={() => {
            setPage(current - 1);
          }}
        >
          {`Previous ${label}`}
        </Button>
        <Button
          variant="secondary"
          disabled={current === pages - 1}
          onClick={() => {
            setPage(current + 1);
          }}
        >
          {`Next ${label}`}
        </Button>
        <p aria-live="polite">{`${noun} ${String(start + 1)} to ${String(start + shown.length)} of ${String(rows.length)}`}</p>
      </nav>
    );
  return { shown, controls };
}

function AccountLink({ id }: { readonly id: string }) {
  return (
    // WCAG 2.5.8: each link of a list is a 24 px tall target.
    <Link
      href={`/accounts/${id}`}
      className={`${LINK_CLASS} inline-flex min-h-6 items-center font-mono text-xs`}
    >
      {id}
    </Link>
  );
}

function AccountList({ ids }: { readonly ids: readonly string[] }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {ids.map((id) => (
        <li key={id}>
          <AccountLink id={id} />
        </li>
      ))}
    </ul>
  );
}

/**
 * The table view of a graph result (C108): always available, and the default for keyboard and
 * screen-reader users. Accounts are selected with checkboxes (the selection the canvas shares and
 * bulk actions act on); shared values are named by kind in words, their values hidden until an
 * explicit, audited unmask (P17) offered only with `pii:view`. An account is expanded around with
 * the template; a shared value through its own node route on the stored result it came from
 * (owner decision 20 after Workflow 7B, built in Workflow 9B), each only when pressed. Each table
 * shows 25 rows a page (R009); selecting every account still takes the whole result.
 */
export function GraphTable({
  graph,
  selected,
  onSelectionChange,
  piiView,
  unmask,
  onExpand,
  expanding = null,
  valueExpansion,
}: GraphTableProps) {
  const accounts = accountRows(graph);
  const values = valueRows(graph);
  const allSelected = accounts.length > 0 && accounts.every((row) => selected.has(row.id));
  const accountPage = usePaged(accounts, 'Accounts', 'accounts');
  const valuePage = usePaged(values, 'Shared values', 'shared values');

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    onSelectionChange(next);
  };

  const accountColumns: Column<AccountRow>[] = [
    {
      id: 'select',
      header: 'Select',
      cell: (row) => (
        <input
          type="checkbox"
          className={CHECKBOX}
          aria-label={`Select ${row.id}`}
          checked={selected.has(row.id)}
          onChange={() => {
            toggle(row.id);
          }}
        />
      ),
    },
    {
      id: 'account',
      header: 'Account',
      rowHeader: true,
      cell: (row) => <AccountLink id={row.id} />,
    },
    {
      id: 'kinds',
      header: 'Linked through',
      cell: (row) =>
        row.kinds.length === 0 ? (
          <span className="text-ink-muted">No shared value in this result</span>
        ) : (
          row.kinds.map(graphKindLabel).join(', ')
        ),
    },
    {
      id: 'linked',
      header: 'Shares values with',
      cell: (row) =>
        row.linked.length === 0 ? (
          <span className="text-ink-muted">No other account</span>
        ) : (
          <AccountList ids={row.linked} />
        ),
    },
    ...(onExpand === undefined
      ? []
      : [
          {
            id: 'actions',
            header: 'Actions',
            cell: (row: AccountRow) => (
              <Button
                variant="secondary"
                disabled={expanding !== null}
                aria-label={`Expand around ${row.id}`}
                onClick={() => {
                  onExpand(row.id);
                }}
              >
                {expanding === row.id ? 'Expanding…' : 'Expand'}
              </Button>
            ),
          },
        ]),
  ];

  const valueColumns: Column<ValueRow>[] = [
    { id: 'kind', header: 'Kind', rowHeader: true, cell: (row) => graphKindLabel(row.type) },
    {
      id: 'node',
      header: 'Node',
      cell: (row) => <code className="font-mono text-xs">{row.id}</code>,
    },
    {
      id: 'value',
      header: 'Value',
      cell: (row) =>
        piiView ? (
          <UnmaskButton queryId={row.queryId} nodeId={row.id} type={row.type} unmask={unmask} />
        ) : (
          <span className="text-ink-muted">Hidden value</span>
        ),
    },
    { id: 'holders', header: 'Held by', cell: (row) => <AccountList ids={row.holders} /> },
    ...(valueExpansion === undefined
      ? []
      : [
          {
            id: 'actions',
            header: 'Actions',
            cell: (row: ValueRow) => {
              const whyNot = valueExpansion.whyNot(row);
              return whyNot !== null ? (
                <span className="text-sm text-ink-muted">{whyNot}</span>
              ) : (
                <Button
                  variant="secondary"
                  disabled={expanding !== null}
                  aria-label={`Expand ${row.id}`}
                  onClick={() => {
                    valueExpansion.onExpand(row);
                  }}
                >
                  {expanding === row.id ? 'Expanding…' : 'Expand'}
                </Button>
              );
            },
          },
        ]),
  ];

  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className={CHECKBOX}
          checked={allSelected}
          disabled={accounts.length === 0}
          onChange={() => {
            onSelectionChange(allSelected ? new Set() : new Set(accounts.map((row) => row.id)));
          }}
        />
        Select every account in this result
      </label>
      <DataTable
        caption="Accounts in this result"
        columns={accountColumns}
        rows={accountPage.shown}
        getRowKey={(row) => row.id}
        emptyMessage="No account in this result."
      />
      {accountPage.controls}
      <DataTable
        caption="Shared values"
        columns={valueColumns}
        rows={valuePage.shown}
        getRowKey={(row) => row.id}
        emptyMessage="No shared value in this result."
      />
      {valuePage.controls}
      {!piiView && (
        <p className="text-sm text-ink-muted">
          Values are never sent with a result. Unmasking one needs the pii:view permission, and each
          unmask is recorded in the audit log.
        </p>
      )}
    </div>
  );
}
