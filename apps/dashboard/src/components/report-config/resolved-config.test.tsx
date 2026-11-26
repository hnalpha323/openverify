import { resolveReportTemplateConfig } from '@openverify/contracts';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WATCHLIST_CONFIG } from '../../testing/report-config-fixtures';
import { ResolvedConfig } from './resolved-config';

function rowOf(name: string): HTMLElement {
  const table = screen.getByRole('table', { name: 'Resolved configuration' });
  const row = within(table)
    .getByRole('rowheader', { name: new RegExp(`^${name}`) })
    .closest('tr');
  if (row === null) {
    throw new Error(`no row ${name}`);
  }
  return row;
}

/** The value and default cells of a row (its setting is the row header). */
function cells(row: HTMLElement): readonly [HTMLElement, HTMLElement] {
  const [value, fallback] = within(row).getAllByRole('cell');
  if (value === undefined || fallback === undefined) {
    throw new Error('a row has a value and a default');
  }
  return [value, fallback];
}

describe('ResolvedConfig (C71.2, C86)', () => {
  it('lists every resolved key in words beside its key, value and default', () => {
    render(
      <ResolvedConfig
        type="watchlist"
        config={resolveReportTemplateConfig('watchlist', WATCHLIST_CONFIG)}
      />,
    );

    const table = screen.getByRole('table', { name: 'Resolved configuration' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Setting', 'Value', 'Default']);
    const recurrence = rowOf('Recurrence');
    expect(recurrence).toHaveTextContent('recurrence-interval-days');
    expect(cells(recurrence)[0]).toHaveTextContent('Every 30 days');
    expect(cells(recurrence)[1]).toHaveTextContent('Runs once');
    expect(within(cells(recurrence)[1]).queryByText('Default')).toBeNull();

    const age = rowOf('Maximum list age');
    expect(cells(age)[0]).toHaveTextContent('48 hours');
    expect(within(cells(age)[1]).getByText('Default')).toHaveAttribute('data-status', 'default');
    expect(cells(age)[1]).toHaveTextContent('Provisional');
    expect(cells(age)[1]).toHaveTextContent('C71.2');

    expect(cells(rowOf('Lists searched'))[1]).toHaveTextContent('Pinned when the version is saved');
  });

  it('can be named for the version it shows', () => {
    render(
      <ResolvedConfig
        type="phone-number"
        caption="Configuration of version 3"
        config={resolveReportTemplateConfig('phone-number', {})}
      />,
    );

    expect(screen.getByRole('table', { name: 'Configuration of version 3' })).toBeVisible();
  });
});
