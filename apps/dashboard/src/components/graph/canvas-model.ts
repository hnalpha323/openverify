/**
 * The canvas's Cytoscape.js model (C108): Cytoscape.js 3.34.3 on its canvas renderer with WebGL
 * off (experimental, a preview), laid out by `cytoscape-fcose` 2.2.0 with `animate: false`.
 *
 * - Labels are masked: an account by the end of its id, a shared value by its kind in words; no
 *   value ever reaches the canvas (P17). Every node type has its own shape and colour, and a
 *   selected node is outlined thick and double as well as recoloured (WCAG 1.4.1, 1.4.11).
 * - Only accounts are selectable: they are what bulk actions act on and what expansions start
 *   from (owner decision 20 after Workflow 7B).
 * - Incremental expansion: `layoutAdded` adds what a merged result brings and lays out only the
 *   new nodes, with every node already shown locked in place.
 *
 * This module imports Cytoscape.js's types only; the library itself is loaded by the canvas
 * component with a dynamic import, so no other page's bundle carries it.
 */
import type {
  Core,
  Css,
  ElementDefinition,
  LayoutOptions,
  NodeSingular,
  StylesheetStyle,
} from 'cytoscape';
import type { ExplorerGraph, ExplorerNode } from './explorer-model';
import { GRAPH_NODE_STYLES, graphKindLabel, type GraphNodeType } from './graph-words';

/** `cytoscape-fcose`'s options, which Cytoscape.js's own types do not list. */
export interface FcoseLayoutOptions {
  readonly name: 'fcose';
  readonly animate: false;
  readonly randomize?: boolean;
  readonly fit?: boolean;
  readonly padding?: number;
  readonly quality?: 'draft' | 'default' | 'proof';
  readonly fixedNodeConstraint?: readonly {
    readonly nodeId: string;
    readonly position: { readonly x: number; readonly y: number };
  }[];
}

/** The rendering options: Cytoscape.js reads `renderer` and its hints from the top level too. */
export interface CanvasRenderingOptions {
  readonly webgl: false;
  readonly renderer: { readonly name: 'canvas'; readonly webgl: false };
}

export const CANVAS_OPTIONS: CanvasRenderingOptions = Object.freeze({
  webgl: false,
  renderer: Object.freeze({ name: 'canvas', webgl: false }),
});

export const INITIAL_LAYOUT: FcoseLayoutOptions = Object.freeze({
  name: 'fcose',
  animate: false,
  randomize: true,
  quality: 'default',
  fit: true,
  padding: 24,
});

/** Cytoscape.js's `layout()` takes an extension's options as they are. */
export function asLayout(options: FcoseLayoutOptions): LayoutOptions {
  return options;
}

/** A node's masked label. */
export function nodeLabel(node: Pick<ExplorerNode, 'id' | 'type'>): string {
  return node.type === 'account' ? `Account ${node.id.slice(-6)}` : graphKindLabel(node.type);
}

/** The result as Cytoscape.js elements. */
export function elementsOf(graph: ExplorerGraph): ElementDefinition[] {
  return [
    ...graph.nodes.map((node): ElementDefinition => ({
      group: 'nodes',
      data: { id: node.id, type: node.type, label: nodeLabel(node), queryId: node.queryId },
      selectable: node.type === 'account',
    })),
    ...graph.links.map((link): ElementDefinition => ({
      group: 'edges',
      data: {
        id: `${link.from}|${link.to}|${link.kind}`,
        source: link.from,
        target: link.to,
        kind: link.kind,
      },
    })),
  ];
}

/** The stylesheet: a shape and a colour per type, masked labels, a thick outline on selection. */
export function canvasStyle(): StylesheetStyle[] {
  const types = Object.keys(GRAPH_NODE_STYLES) as GraphNodeType[];
  return [
    {
      selector: 'node',
      style: {
        label: 'data(label)',
        'font-size': 10,
        color: '#1f2937',
        'text-valign': 'bottom',
        'text-margin-y': 4,
        width: 22,
        height: 22,
        'border-width': 1,
        'border-color': '#1f2937',
      },
    },
    ...types.map((type): StylesheetStyle => ({
      selector: `node[type = "${type}"]`,
      style: {
        shape: GRAPH_NODE_STYLES[type].shape as Css.NodeShape,
        'background-color': GRAPH_NODE_STYLES[type].colour,
      },
    })),
    {
      selector: 'node:selected',
      style: {
        'border-width': 4,
        'border-style': 'double',
        'border-color': '#111827',
        'background-color': '#facc15',
      },
    },
    {
      selector: 'edge',
      style: { width: 1.5, 'line-color': '#6b7280', 'curve-style': 'straight' },
    },
  ];
}

/** Where a new node starts: around a neighbour already shown, else around the origin. */
function startPosition(node: NodeSingular, shown: ReadonlySet<string>, index: number) {
  const anchor = node
    .neighborhood()
    .nodes()
    .map((other) => other)
    .find((other) => shown.has(other.id()));
  const centre = anchor === undefined ? { x: 0, y: 0 } : anchor.position();
  const angle = (index * 2 * Math.PI) / 12;
  const radius = 60 + 12 * Math.floor(index / 12);
  return { x: centre.x + radius * Math.cos(angle), y: centre.y + radius * Math.sin(angle) };
}

/**
 * Adds to `cy` what `after` holds beyond `before`, and lays out only the new nodes: every node
 * already shown is locked while fCoSE runs, so it keeps its place. Answers the new node ids.
 */
export function layoutAdded(cy: Core, before: ExplorerGraph, after: ExplorerGraph): string[] {
  const shown = new Set(before.nodes.map((node) => node.id));
  const known = new Set(cy.elements().map((element) => element.id()));
  const fresh = elementsOf(after).filter((element) => !known.has(String(element.data.id)));
  if (fresh.length === 0) {
    return [];
  }
  const old = cy.nodes();
  cy.add(fresh);
  const added = cy.nodes().filter((node) => !shown.has(node.id()));
  added.forEach((node, index) => {
    node.position(startPosition(node, shown, index));
  });
  const anchors = added.neighborhood('node').filter((node) => shown.has(node.id()));
  old.lock();
  try {
    added
      .union(added.connectedEdges())
      .union(anchors)
      .layout(
        asLayout({
          name: 'fcose',
          animate: false,
          randomize: false,
          fit: false,
          quality: 'default',
        }),
      )
      .run();
  } finally {
    old.unlock();
  }
  return added.map((node) => node.id());
}
