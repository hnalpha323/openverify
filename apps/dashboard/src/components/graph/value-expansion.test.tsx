/**
 * Owner decision 20 after Workflow 7B: a shared value of a stored result has an explicit Expand,
 * pressed only by the operator (never on render or hover), whose new result is merged onto the
 * node; a person-identifying kind is offered only with `pii:view`; a refusal is said in words.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { GRAPH_IDS as IDS, NODE_IDS, graphQuery } from '../../testing/graph-fixtures';
import { later } from '../../testing/later';
import { ToastProvider } from '../toasts';
import { GraphExplorer, type GraphExplorerProps } from './graph-explorer';

vi.mock('./graph-canvas', () => ({ GraphCanvas: () => <p>Canvas</p> }));

type Expand = (
  state: ActionState<ReturnType<typeof graphQuery>>,
  formData: FormData,
) => Promise<ActionResult<ReturnType<typeof graphQuery>>>;

const EXPANDED = graphQuery({
  id: IDS.expansion,
  nodes: [
    { type: 'email_address', value: NODE_IDS.email },
    { type: 'account', value: IDS.accountD },
  ],
  links: [{ from: IDS.accountD, to: NODE_IDS.email, kind: 'email_address' }],
});

function show(expandNode: Expand | undefined, personExpand = true) {
  const actions: GraphExplorerProps['actions'] = {
    unmask: vi.fn(() => later({ ok: true as const, data: { value: null } })),
    bulk: vi.fn(() =>
      later({
        ok: true as const,
        data: { action: 'add-tag' as const, preview: true, selectedCount: 1, outcomes: [] },
      }),
    ),
    expand: vi.fn(() => later<ActionResult<typeof EXPANDED>>({ ok: true, data: EXPANDED })),
    ...(expandNode === undefined ? {} : { expandNode }),
  };
  render(
    <ToastProvider>
      <GraphExplorer
        query={graphQuery()}
        piiView={personExpand}
        personExpand={personExpand}
        expansionTemplateId={null}
        bulk={{ tags: false, lists: false, export: false }}
        actions={actions}
      />
    </ToastProvider>,
  );
}

const values = () => within(screen.getByRole('table', { name: 'Shared values' }));

describe('expanding a property node', () => {
  it('runs only when pressed, with the stored query and the node, and merges the new accounts in', async () => {
    const user = userEvent.setup();
    const expandNode = vi.fn<Expand>(() => later({ ok: true, data: EXPANDED }));
    show(expandNode);

    expect(expandNode).not.toHaveBeenCalled();
    await user.click(values().getByRole('button', { name: `Expand ${NODE_IDS.email}` }));

    expect(expandNode).toHaveBeenCalledTimes(1);
    const sent = expandNode.mock.calls[0]?.[1];
    expect(sent?.get('graph-query-id')).toBe(IDS.query);
    expect(sent?.get('node-id')).toBe(NODE_IDS.email);
    const accounts = within(screen.getByRole('table', { name: 'Accounts in this result' }));
    expect(
      await accounts.findByRole('rowheader', { name: new RegExp(IDS.accountD) }),
    ).toBeVisible();
    expect(screen.getByRole('list', { name: 'Expansions' })).toHaveTextContent(
      `Expanded ${NODE_IDS.email}: 1 node added.`,
    );
    // WCAG 2.5.3, as the full-stack axe check found: the link's name is its visible text.
    const open = screen.getByRole('link', { name: `Open ${IDS.expansion} in the explorer` });
    expect(open).not.toHaveAttribute('aria-label');
    expect(open).toHaveTextContent(`Open ${IDS.expansion} in the explorer`);
  });

  it('offers no expansion of a person-identifying value without pii:view, and says why', () => {
    show(vi.fn<Expand>(), false);

    expect(values().queryByRole('button', { name: `Expand ${NODE_IDS.email}` })).toBeNull();
    expect(values().getAllByText('Expanding this kind needs pii:view')[0]).toBeVisible();
  });

  it('offers nothing without graph:write', () => {
    show(undefined);

    expect(values().queryByRole('button', { name: /^Expand gn_/ })).toBeNull();
  });

  it('says a refusal in words', async () => {
    const user = userEvent.setup();
    show(
      vi.fn<Expand>(() =>
        later({
          ok: false,
          problem: { title: 'That node is no longer in the stored result.', status: 404 },
        }),
      ),
    );

    await user.click(values().getByRole('button', { name: `Expand ${NODE_IDS.email}` }));

    expect(await screen.findByText('That node is no longer in the stored result.')).toBeVisible();
  });
});

describe('the shared values table’s targets (WCAG 2.5.8)', () => {
  it('gives each account link of a Held by list a 24 px tall target, as the full-stack axe check found', () => {
    show(undefined);

    const links = values().getAllByRole('link');
    expect(links.length).toBeGreaterThan(1);
    for (const link of links) {
      expect(link).toHaveClass('min-h-6');
    }
  });
});
