import { useId, type ReactNode } from 'react';

export interface Column<Row> {
  /** Stable key for the column. */
  readonly id: string;
  readonly header: ReactNode;
  readonly cell: (row: Row) => ReactNode;
  /** Render this column's cells as row headers (`<th scope="row">`), e.g. an ID. */
  readonly rowHeader?: boolean;
}

export interface DataTableProps<Row> {
  /** Names the table (and its scroll region) for assistive tech. */
  readonly caption: ReactNode;
  /** Keep the caption for screen readers only, e.g. when a page heading already shows it. */
  readonly captionHidden?: boolean;
  readonly columns: readonly Column<Row>[];
  readonly rows: readonly Row[];
  readonly getRowKey: (row: Row) => string;
  readonly emptyMessage: ReactNode;
}

/** A semantic table whose columns are typed against the row type. Works in Server Components. */
export function DataTable<Row>({
  caption,
  captionHidden = false,
  columns,
  rows,
  getRowKey,
  emptyMessage,
}: DataTableProps<Row>) {
  const captionId = useId();

  return (
    // A named, focusable region lets keyboard users scroll a table wider than the screen.
    <div
      role="region"
      aria-labelledby={captionId}
      tabIndex={0}
      className="overflow-x-auto rounded-xl border border-line bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <table className="w-full border-collapse text-start text-sm">
        <caption
          id={captionId}
          className={
            captionHidden ? 'sr-only' : 'px-4 py-3 text-start text-base font-semibold text-ink'
          }
        >
          {caption}
        </caption>
        <thead className="bg-canvas">
          <tr>
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                className="px-4 py-3 text-start font-medium text-ink-muted"
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-ink-muted">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={getRowKey(row)}>
                {columns.map((column) =>
                  column.rowHeader ? (
                    <th key={column.id} scope="row" className="px-4 py-3 text-start font-normal">
                      {column.cell(row)}
                    </th>
                  ) : (
                    <td key={column.id} className="px-4 py-3">
                      {column.cell(row)}
                    </td>
                  ),
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
