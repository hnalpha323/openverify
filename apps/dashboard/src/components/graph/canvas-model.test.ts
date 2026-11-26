import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import { describe, expect, it } from 'vitest';
import { GRAPH_IDS as IDS, NODE_IDS, graphQuery, SHARED_EMAIL } from '../../testing/graph-fixtures';
import {
  CANVAS_OPTIONS,
  INITIAL_LAYOUT,
  asLayout,
  canvasStyle,
  elementsOf,
  layoutAdded,
} from './canvas-model';
import { graphOfResult, mergeGraphs } from './explorer-model';
import { GRAPH_NODE_STYLES } from './graph-words';

cytoscape.use(fcose);

const BASE = graphOfResult(graphQuery());

describe('the canvas model (C108)', () => {
  it('draws on the canvas renderer with WebGL off and lays out with fCoSE, never animating', () => {
    expect(CANVAS_OPTIONS).toMatchObject({ webgl: false, renderer: { name: 'canvas' } });
    expect(INITIAL_LAYOUT).toMatchObject({ name: 'fcose', animate: false });
  });

  it('labels nodes by kind and by account id only: no value ever reaches the canvas', () => {
    const elements = elementsOf(BASE);
    const nodes = elements.filter((element) => element.group === 'nodes');
    expect(nodes).toHaveLength(5);
    expect(nodes[0]?.data).toEqual({
      id: IDS.accountA,
      type: 'account',
      label: `Account ${IDS.accountA.slice(-6)}`,
      queryId: IDS.query,
    });
    expect(nodes[1]?.data).toMatchObject({
      id: NODE_IDS.email,
      type: 'email_address',
      label: 'Email address (confirmed)',
    });
    expect(nodes[1]?.selectable).toBe(false);
    const edges = elements.filter((element) => element.group === 'edges');
    expect(edges).toHaveLength(4);
    expect(edges[0]?.data).toMatchObject({
      source: IDS.accountA,
      target: NODE_IDS.email,
      kind: 'email_address',
    });
    expect(JSON.stringify(elements)).not.toContain(SHARED_EMAIL);
  });

  it('gives each node type its shape and colour, and marks a selection by a thick outline as well as colour', () => {
    const style = canvasStyle();
    const email = style.find((rule) => rule.selector === 'node[type = "email_address"]');
    expect(email?.style).toMatchObject({
      shape: GRAPH_NODE_STYLES.email_address.shape,
      'background-color': GRAPH_NODE_STYLES.email_address.colour,
    });
    const selected = style.find((rule) => rule.selector === 'node:selected');
    expect(selected?.style).toMatchObject({ 'border-width': 4, 'border-style': 'double' });
  });

  it('adds an expansion without moving any node already laid out', () => {
    const cy = cytoscape({ headless: true, styleEnabled: true, elements: elementsOf(BASE) });
    cy.layout(asLayout({ ...INITIAL_LAYOUT, randomize: true })).run();
    const before = new Map(cy.nodes().map((node) => [node.id(), { ...node.position() }]));

    const expansion = graphOfResult(
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
    );
    const merged = mergeGraphs(BASE, expansion);
    const added = layoutAdded(cy, BASE, merged.graph);

    expect(added).toEqual([NODE_IDS.expandedEmail, IDS.accountD]);
    for (const [id, position] of before) {
      expect(cy.getElementById(id).position()).toEqual(position);
    }
    const anchor = cy.getElementById(IDS.accountC).position();
    for (const id of added) {
      const position = cy.getElementById(id).position();
      expect(Number.isFinite(position.x) && Number.isFinite(position.y)).toBe(true);
      expect(position).not.toEqual(anchor);
    }
    expect(cy.nodes().map((node) => node.locked())).not.toContain(true);
    expect(cy.edges()).toHaveLength(6);
  });
});
