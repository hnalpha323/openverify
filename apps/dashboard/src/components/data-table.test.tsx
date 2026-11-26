import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DataTable, type Column } from './data-table';

interface Fruit {
  readonly name: string;
  readonly colour: string;
}

const FRUIT: readonly Fruit[] = [
  { name: 'Apple', colour: 'Red' },
  { name: 'Banana', colour: 'Yellow' },
];

const COLUMNS: readonly Column<Fruit>[] = [
  { id: 'name', header: 'Name', cell: (fruit) => fruit.name, rowHeader: true },
  { id: 'colour', header: 'Colour', cell: (fruit) => fruit.colour },
];

function renderTable(rows: readonly Fruit[] = FRUIT, captionHidden?: boolean) {
  return render(
    <DataTable
      caption="Fruit"
      columns={COLUMNS}
      rows={rows}
      getRowKey={(fruit) => fruit.name}
      emptyMessage="No fruit yet."
      {...(captionHidden === undefined ? {} : { captionHidden })}
    />,
  );
}

function rowAt(index: number): HTMLElement {
  const row = screen.getAllByRole('row')[index];
  if (row === undefined) throw new Error(`No row at index ${String(index)}`);
  return row;
}

describe('DataTable', () => {
  it('is a table named by its caption', () => {
    renderTable();

    expect(screen.getByRole('table', { name: 'Fruit' })).toBeVisible();
  });

  it('renders a column header per column', () => {
    renderTable();

    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Name',
      'Colour',
    ]);
  });

  it('renders a row per item, with cells from the column renderers', () => {
    renderTable();

    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(within(rowAt(1)).getByRole('rowheader')).toHaveTextContent('Apple');
    expect(within(rowAt(1)).getByRole('cell')).toHaveTextContent('Red');
    expect(within(rowAt(2)).getByRole('rowheader')).toHaveTextContent('Banana');
    expect(within(rowAt(2)).getByRole('cell')).toHaveTextContent('Yellow');
  });

  it('shows the empty message across every column when there are no rows', () => {
    renderTable([]);
    const cell = screen.getByRole('cell');

    expect(cell).toHaveTextContent('No fruit yet.');
    expect(cell).toHaveAttribute('colspan', '2');
  });

  it('can hide the caption visually while it still names the table', () => {
    renderTable(FRUIT, true);

    expect(screen.getByText('Fruit')).toHaveClass('sr-only');
    expect(screen.getByRole('table', { name: 'Fruit' })).toBeInTheDocument();
  });

  it('wraps the table in a named, keyboard-focusable scroll region', () => {
    renderTable();

    expect(screen.getByRole('region', { name: 'Fruit' })).toHaveAttribute('tabindex', '0');
  });

  it('types columns against the row type', () => {
    const typed: Column<Fruit> = {
      id: 'bad',
      header: 'Bad',
      // @ts-expect-error `weight` is not a Fruit property, so typecheck fails without this line.
      cell: (fruit) => String(fruit.weight),
    };

    expect(typed.id).toBe('bad');
  });
});
