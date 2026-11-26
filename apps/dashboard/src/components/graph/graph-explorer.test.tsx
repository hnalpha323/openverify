import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult } from '../../lib/action-state';
import { GRAPH_IDS as IDS, NODE_IDS, graphQuery } from '../../testing/graph-fixtures';
import { later } from '../../testing/later';
import { ToastProvider } from '../toasts';
import type { GraphCanvasProps } from './graph-canvas';
import { GraphExplorer, type GraphExplorerProps } from './graph-explorer';
import { GRAPH_PROBLEM_WORDS } from './graph-words';

vi.mock('./graph-canvas', () => ({
  /** A stand-in canvas: it shows what it draws and selects as a click on a node would. */
  GraphCanvas: ({ graph, selected, onSelectionChange }: GraphCanvasProps) => (
    <div>
      <p>Canvas of {graph.nodes.length} nodes</p>
      <p>Canvas selection: {[...selected].join(',')}</p>
      <button
        type="button"
        onClick={() => {
          onSelectionChange(new Set([IDS.accountC]));
        }}
      >
        Click account C on the canvas
      </button>
    </div>
  ),
}));

const EXPANSION = graphQuery({
  id: IDS.expansion,
  nodes: [
    { type: 'account', value: IDS.accountC },
    { type: 'email_address', value: NODE_IDS.expandedEmail },
    { type: 'account', value: IDS.accountD },
  ],
  links: [
    { from: IDS.accountC, to: NODE_IDS.expandedEmail, kind: 'email_address' },
    { from: IDS.accountD, to: NODE_IDS.expandedEmail, kind: 'email_address' },
  ],
});

function renderExplorer(props: Partial<GraphExplorerProps> = {}) {
  const actions: GraphExplorerProps['actions'] = {
    unmask: vi.fn(() => later({ ok: true as const, data: { value: null } })),
    bulk: vi.fn(() =>
      later({
        ok: true as const,
        data: { action: 'add-tag' as const, preview: true, selectedCount: 1, outcomes: [] },
      }),
    ),
    expand: vi.fn(() => later<ActionResult<typeof EXPANSION>>({ ok: true, data: EXPANSION })),
  };
  render(
    <ToastProvider>
      <GraphExplorer
        query={graphQuery()}
        piiView
        expansionTemplateId={IDS.template}
        bulk={{ tags: true, lists: false, export: false }}
        actions={actions}
        {...props}
      />
    </ToastProvider>,
  );
  return actions;
}

describe('the graph explorer (C108)', () => {
  it('opens on the table view, the default for keyboard and screen-reader users, with the canvas a press away', async () => {
    const user = userEvent.setup();
    renderExplorer();
    expect(screen.getByRole('button', { name: 'Table view' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('table', { name: 'Accounts in this result' })).toBeVisible();
    expect(screen.queryByText(/Canvas of/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Canvas view' }));
    expect(screen.getByRole('button', { name: 'Canvas view' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('Canvas of 5 nodes')).toBeVisible();
  });

  it('shares one selection between the views, and bulk actions act on it from either', async () => {
    const user = userEvent.setup();
    renderExplorer();
    await user.click(screen.getByRole('checkbox', { name: `Select ${IDS.accountA}` }));
    await user.click(screen.getByRole('button', { name: 'Canvas view' }));
    expect(screen.getByText(`Canvas selection: ${IDS.accountA}`)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Click account C on the canvas' }));
    expect(screen.getByRole('radio', { name: 'The selected accounts (1)' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Table view' }));
    expect(screen.getByRole('checkbox', { name: `Select ${IDS.accountC}` })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: `Select ${IDS.accountA}` })).not.toBeChecked();
  });

  it('expands around an account by running the template with account_id bound, merging the new result in place', async () => {
    const user = userEvent.setup();
    const actions = renderExplorer();
    await user.click(screen.getByRole('button', { name: `Expand around ${IDS.accountC}` }));
    const sent = vi.mocked(actions.expand).mock.calls[0]?.[1];
    expect(sent?.get('graph-query-template-id')).toBe(IDS.template);
    expect(sent?.get('account-id')).toBe(IDS.accountC);
    expect(
      await screen.findByText(`Expanded around ${IDS.accountC}: 2 nodes added.`),
    ).toBeVisible();
    const accounts = screen.getByRole('table', { name: 'Accounts in this result' });
    expect(within(accounts).getByRole('rowheader', { name: IDS.accountD })).toBeVisible();
    expect(
      screen.getByRole('link', { name: `Open ${IDS.expansion} in the explorer` }),
    ).toHaveAttribute('href', `/graph/${IDS.expansion}`);
  });

  it('says a refused expansion in words', async () => {
    const user = userEvent.setup();
    const actions = renderExplorer();
    vi.mocked(actions.expand).mockImplementationOnce(() =>
      later({
        ok: false as const,
        problem: { title: GRAPH_PROBLEM_WORDS.graph_sync_limited, code: 'graph_sync_limited' },
      }),
    );
    await user.click(screen.getByRole('button', { name: `Expand around ${IDS.accountA}` }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      GRAPH_PROBLEM_WORDS.graph_sync_limited,
    );
  });

  it('offers no expansion when no template binds account_id', () => {
    renderExplorer({ expansionTemplateId: null });
    expect(screen.queryByRole('button', { name: /^Expand around/ })).toBeNull();
    expect(screen.getByText(/has no account_id parameter/)).toBeVisible();
  });

  it('has no bulk actions panel without a stored result to act on', () => {
    renderExplorer({ query: graphQuery({ status: 'submitted' }) });
    expect(screen.queryByRole('combobox', { name: 'Action' })).toBeNull();
  });
});
