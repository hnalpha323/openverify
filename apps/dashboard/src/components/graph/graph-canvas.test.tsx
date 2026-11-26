import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import cytoscape, { type Core, type CytoscapeOptions } from 'cytoscape';
import fcose from 'cytoscape-fcose';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { GRAPH_IDS as IDS, NODE_IDS, graphQuery } from '../../testing/graph-fixtures';
import { graphOfResult, mergeGraphs, type ExplorerGraph } from './explorer-model';
import { GraphCanvas, type CanvasLibrary } from './graph-canvas';

const BASE = graphOfResult(graphQuery());
const EXPANDED = mergeGraphs(
  BASE,
  graphOfResult(
    graphQuery({
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
    }),
  ),
).graph;

/**
 * The real Cytoscape.js and fCoSE, run headless: jsdom has no canvas. The options the component
 * gave are recorded, and the instance kept for the test to read.
 */
function headlessLibrary() {
  const made: { options: CytoscapeOptions; cy: Core }[] = [];
  const factory = ((options: CytoscapeOptions = {}) => {
    // Headless: no container and no renderer, which the options record for the test.
    const rest: CytoscapeOptions & { renderer?: unknown } = { ...options };
    delete rest.container;
    delete rest.renderer;
    const cy = cytoscape({ ...rest, headless: true, styleEnabled: true });
    made.push({ options, cy });
    return cy;
  }) as unknown as CanvasLibrary['cytoscape'];
  Object.assign(factory, { use: cytoscape.use.bind(cytoscape) });
  const load = vi.fn(() => Promise.resolve({ cytoscape: factory, fcose }));
  return { load, made };
}

function Harness({
  graph = BASE,
  load,
  onSelection,
}: {
  readonly graph?: ExplorerGraph;
  readonly load: () => Promise<CanvasLibrary>;
  readonly onSelection?: (next: ReadonlySet<string>) => void;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  return (
    <>
      <GraphCanvas
        graph={graph}
        selected={selected}
        onSelectionChange={(next) => {
          setSelected(next);
          onSelection?.(next);
        }}
        load={load}
      />
      <button
        type="button"
        onClick={() => {
          setSelected(new Set([IDS.accountB]));
        }}
      >
        Select B from the table
      </button>
    </>
  );
}

describe('the graph canvas (C108)', () => {
  it('loads Cytoscape.js only when it mounts, on the canvas renderer with WebGL off and fCoSE without animation', async () => {
    const { load, made } = headlessLibrary();
    render(<Harness load={load} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading the canvas…');
    await waitFor(() => {
      expect(made).toHaveLength(1);
    });
    expect(load).toHaveBeenCalledTimes(1);
    const [{ options, cy }] = made as [{ options: CytoscapeOptions; cy: Core }];
    expect(options.container).toBeInstanceOf(HTMLElement);
    expect(options).toMatchObject({ webgl: false, renderer: { name: 'canvas', webgl: false } });
    expect(options.layout).toMatchObject({ name: 'fcose', animate: false });
    expect(cy.nodes()).toHaveLength(5);
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('');
    });
  });

  it('names Cytoscape.js’s stylesheet before the library starts, so it inserts no inline style element (C170.1; Workflow 9C)', async () => {
    const { load, made } = headlessLibrary();
    let atStart: Element | null = null;
    const recording = vi.fn(async () => {
      const library = await load();
      const factory = ((options: CytoscapeOptions) => {
        atStart = document.getElementById('__________cytoscape_stylesheet');
        return library.cytoscape(options);
      }) as unknown as CanvasLibrary['cytoscape'];
      Object.assign(factory, { use: library.cytoscape.use.bind(library.cytoscape) });
      return { ...library, cytoscape: factory };
    });
    render(<Harness load={recording} />);
    await waitFor(() => {
      expect(made).toHaveLength(1);
    });

    // The console's style-src has a nonce and no 'unsafe-inline': the library skips its own
    // <style> when an element of that id exists, and the container is positioned by its class.
    expect(atStart).not.toBeNull();
    expect((atStart as Element | null)?.tagName).not.toBe('STYLE');
    expect(document.querySelectorAll('style')).toHaveLength(0);
    expect(screen.getByRole('img', { name: /^Graph of / })).toHaveClass('relative');
  });

  it('has a text alternative and a legend naming each kind’s shape (WCAG 1.1.1, 1.4.1)', async () => {
    const { load, made } = headlessLibrary();
    render(<Harness load={load} />);
    await waitFor(() => {
      expect(made).toHaveLength(1);
    });
    expect(
      screen.getByRole('img', {
        name: 'Graph of 3 accounts and 2 shared values. The table view lists the same result.',
      }),
    ).toBeVisible();
    const legend = screen.getByRole('list', { name: 'Legend' });
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Account: circle',
      'Email address (confirmed): diamond',
      'Phone number (unconfirmed): rounded triangle',
    ]);
  });

  it('shares the selection with the table: a node selected on the canvas, and a row selected in the table', async () => {
    const user = userEvent.setup();
    const { load, made } = headlessLibrary();
    const onSelection = vi.fn();
    render(<Harness load={load} onSelection={onSelection} />);
    await waitFor(() => {
      expect(made).toHaveLength(1);
    });
    const { cy } = made[0] as { cy: Core };
    act(() => {
      cy.getElementById(IDS.accountA).select();
    });
    expect(onSelection).toHaveBeenLastCalledWith(new Set([IDS.accountA]));
    await user.click(screen.getByRole('button', { name: 'Select B from the table' }));
    await waitFor(() => {
      expect(cy.getElementById(IDS.accountB).selected()).toBe(true);
    });
    expect(cy.getElementById(IDS.accountA).selected()).toBe(false);
  });

  it('adds an expansion to the drawing without moving the nodes already drawn', async () => {
    const { load, made } = headlessLibrary();
    const { rerender } = render(<Harness load={load} />);
    await waitFor(() => {
      expect(made).toHaveLength(1);
    });
    const { cy } = made[0] as { cy: Core };
    const before = new Map(cy.nodes().map((node) => [node.id(), { ...node.position() }]));
    rerender(<Harness load={load} graph={EXPANDED} />);
    await waitFor(() => {
      expect(cy.nodes()).toHaveLength(7);
    });
    for (const [id, position] of before) {
      expect(cy.getElementById(id).position()).toEqual(position);
    }
    expect(made).toHaveLength(1);
  });

  it('zooms and pans by buttons, so nothing needs a drag (WCAG 2.5.7)', async () => {
    const user = userEvent.setup();
    const { load, made } = headlessLibrary();
    render(<Harness load={load} />);
    await waitFor(() => {
      expect(made).toHaveLength(1);
    });
    const { cy } = made[0] as { cy: Core };
    const zoom = cy.zoom();
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(cy.zoom()).toBeGreaterThan(zoom);
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(cy.zoom()).toBeCloseTo(zoom);
    const pan = { ...cy.pan() };
    await user.click(screen.getByRole('button', { name: 'Pan right' }));
    expect(cy.pan().x).not.toBe(pan.x);
    for (const name of ['Pan left', 'Pan up', 'Pan down', 'Fit the graph']) {
      expect(screen.getByRole('button', { name })).toBeEnabled();
    }
  });

  it('says when the canvas cannot load, pointing to the table view', async () => {
    const load = vi.fn(() => Promise.reject(new Error('chunk failed')));
    render(<Harness load={load} />);
    expect(
      await screen.findByText(
        'The canvas could not be loaded. The table view shows the same result.',
      ),
    ).toBeVisible();
  });

  it('destroys the drawing when it leaves the page', async () => {
    const { load, made } = headlessLibrary();
    const { unmount } = render(<Harness load={load} />);
    await waitFor(() => {
      expect(made).toHaveLength(1);
    });
    unmount();
    expect((made[0] as { cy: Core }).cy.destroyed()).toBe(true);
  });
});
