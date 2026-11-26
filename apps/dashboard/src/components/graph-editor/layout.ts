/**
 * "Tidy up" (C141.3, editor note 2.2), for any graph: `@dagrejs/dagre` lays the nodes out top to
 * bottom on demand. Positions go only into a document's layout member, applied as one undoable
 * command; nothing re-lays the graph on an edit, so no node moves under the pointer.
 */
import dagre from '@dagrejs/dagre';
import type { GraphPosition } from './graph-adapter';

/** The size every node is laid out at, which the canvas draws it at too. */
export const NODE_WIDTH = 240;
export const NODE_HEIGHT = 80;

/**
 * Every node's top-left corner, top to bottom. Edges to an unknown node are left out; the caller
 * leaves out back-edges (a loop body's way back, a flow's "go back" connector).
 */
export function tidyGraph(
  nodeIds: readonly string[],
  edges: readonly { readonly from: string; readonly to: string }[],
): Record<string, GraphPosition> {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: 'TB', nodesep: 48, ranksep: 64, marginx: 16, marginy: 16 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const id of nodeIds) {
    graph.setNode(id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  const known = new Set(nodeIds);
  for (const edge of edges) {
    if (known.has(edge.from) && known.has(edge.to)) {
      graph.setEdge(edge.from, edge.to);
    }
  }
  dagre.layout(graph);
  return Object.fromEntries(
    nodeIds.map((id) => {
      const { x, y } = graph.node(id) as { readonly x: number; readonly y: number };
      return [id, { x: Math.round(x - NODE_WIDTH / 2), y: Math.round(y - NODE_HEIGHT / 2) }];
    }),
  );
}
