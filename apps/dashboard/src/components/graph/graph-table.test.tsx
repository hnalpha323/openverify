import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { GRAPH_IDS as IDS, NODE_IDS, graphQuery } from '../../testing/graph-fixtures';
import { later } from '../../testing/later';
import { graphOfResult, type ExplorerGraph } from './explorer-model';
import { GraphTable } from './graph-table';
import type { UnmaskAction } from './unmask-button';

const GRAPH = graphOfResult(graphQuery());

const noUnmask: UnmaskAction = vi.fn(() =>
  later({ ok: false as const, problem: { title: 'unused' } }),
);

function Harness({
  piiView = true,
  unmask = noUnmask,
  onExpand,
  graph = GRAPH,
}: {
  readonly piiView?: boolean;
  readonly unmask?: UnmaskAction;
  readonly onExpand?: (id: string) => void;
  readonly graph?: ExplorerGraph;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  return (
    <>
      <GraphTable
        graph={graph}
        selected={selected}
        onSelectionChange={setSelected}
        piiView={piiView}
        unmask={unmask}
        {...(onExpand === undefined ? {} : { onExpand })}
      />
      <output aria-label="Selection">{[...selected].join(',')}</output>
    </>
  );
}

describe('the graph table view (C108)', () => {
  it('shows the accounts and the shared values in two tables with headers, kinds in words (WCAG 1.3.1)', () => {
    render(<Harness />);
    const accounts = screen.getByRole('table', { name: 'Accounts in this result' });
    expect(
      within(accounts)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Select', 'Account', 'Linked through', 'Shares values with']);
    const row = within(accounts).getByRole('rowheader', { name: IDS.accountB });
    expect(within(row).getByRole('link', { name: IDS.accountB })).toHaveAttribute(
      'href',
      `/accounts/${IDS.accountB}`,
    );
    expect(
      within(accounts).getByText('Email address (confirmed), Phone number (unconfirmed)'),
    ).toBeVisible();

    const values = screen.getByRole('table', { name: 'Shared values' });
    expect(
      within(values)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Kind', 'Node', 'Value', 'Held by']);
    expect(within(values).getByText(NODE_IDS.email)).toBeVisible();
    expect(within(values).getAllByText('Hidden value')).toHaveLength(2);
  });

  it('selects accounts by keyboard alone, one by one or all at once (WCAG 2.1.1)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const one = screen.getByRole('checkbox', { name: `Select ${IDS.accountA}` });
    one.focus();
    await user.keyboard(' ');
    expect(screen.getByRole('status', { name: 'Selection' })).toHaveTextContent(IDS.accountA);
    const all = screen.getByRole('checkbox', { name: 'Select every account in this result' });
    await user.click(all);
    expect(screen.getByLabelText('Selection')).toHaveTextContent(
      [IDS.accountA, IDS.accountB, IDS.accountC].join(','),
    );
    await user.click(all);
    expect(screen.getByLabelText('Selection')).toHaveTextContent('');
  });

  it('offers to unmask a value only with pii:view', () => {
    const { unmount } = render(<Harness piiView />);
    expect(
      screen.getByRole('button', {
        name: `Show the value of Email address (confirmed) ${NODE_IDS.email}`,
      }),
    ).toBeVisible();
    unmount();
    render(<Harness piiView={false} />);
    expect(screen.queryByRole('button', { name: /^Show the value/ })).toBeNull();
    expect(screen.getAllByText('Hidden value')).toHaveLength(2);
  });

  it('expands around an account by an explicit button, never around a shared value', async () => {
    const user = userEvent.setup();
    const onExpand = vi.fn();
    render(<Harness onExpand={onExpand} />);
    await user.click(screen.getByRole('button', { name: `Expand around ${IDS.accountC}` }));
    expect(onExpand).toHaveBeenCalledWith(IDS.accountC);
    const values = screen.getByRole('table', { name: 'Shared values' });
    expect(within(values).queryByRole('button', { name: /^Expand/ })).toBeNull();
  });
});

/** A synthetic result of `count` accounts, each holding one shared value with the next. */
function chainOf(count: number): ExplorerGraph {
  const query = 'gq_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z';
  const account = (index: number) => `acc_01JD${String(index).padStart(22, '0')}`;
  const value = (index: number) => `gn_${String(index).padStart(4, '0')}`;
  return {
    nodes: [
      ...Array.from({ length: count }, (_, index) => ({
        id: account(index),
        type: 'account' as const,
        queryId: query,
      })),
      ...Array.from({ length: count - 1 }, (_, index) => ({
        id: value(index),
        type: 'email_address' as const,
        queryId: query,
      })),
    ],
    links: Array.from({ length: count - 1 }, (_, index) => [
      { from: account(index), to: value(index), kind: 'email_address' as const, queryId: query },
      {
        from: account(index + 1),
        to: value(index),
        kind: 'email_address' as const,
        queryId: query,
      },
    ]).flat(),
  };
}

describe('a large graph result in the table view (R009)', () => {
  it('gives every select checkbox a 24 by 24 px target (WCAG 2.5.8)', () => {
    render(<Harness />);

    for (const box of screen.getAllByRole('checkbox')) {
      expect(box).toHaveClass('size-6');
      expect(box).not.toHaveClass('size-4');
    }
  });

  it('pages the accounts and the shared values 25 rows at a time, saying where it is', async () => {
    const user = userEvent.setup();
    render(<Harness graph={chainOf(30)} />);

    const accounts = screen.getByRole('table', { name: 'Accounts in this result' });
    expect(within(accounts).getAllByRole('rowheader')).toHaveLength(25);
    expect(screen.getByText('Accounts 1 to 25 of 30')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Next accounts' }));
    expect(within(accounts).getAllByRole('rowheader')).toHaveLength(5);
    expect(screen.getByText('Accounts 26 to 30 of 30')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Next accounts' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Previous accounts' }));
    expect(within(accounts).getAllByRole('rowheader')).toHaveLength(25);

    const values = screen.getByRole('table', { name: 'Shared values' });
    expect(within(values).getAllByRole('rowheader')).toHaveLength(25);
    expect(screen.getByText('Shared values 1 to 25 of 29')).toBeVisible();
  });

  it('still selects every account of the result, not only the page shown', async () => {
    const user = userEvent.setup();
    render(<Harness graph={chainOf(30)} />);

    await user.click(screen.getByRole('checkbox', { name: 'Select every account in this result' }));

    expect(screen.getByRole('status', { name: 'Selection' }).textContent.split(',')).toHaveLength(
      30,
    );
  });
});
