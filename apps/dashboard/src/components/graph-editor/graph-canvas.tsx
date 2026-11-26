'use client';

/**
 * The shared canvas (C141.1, C141.3, C141.5, C155.1): `@xyflow/react` drawing whatever document an
 * adapter describes. It renders on the client only, once hydrated, and its stylesheets come through
 * the bundler, so the server sends no inline style a nonce style-src would refuse. Custom memoised
 * nodes draw a 3:1 focus ring and 24 px handles, each handle titled for the pointer (a name would be
 * an ARIA attribute on the library's generic div, which axe refuses; the keyboard connects through
 * the outline); each node is named as the outline names it, with its problems as a badge it is
 * described by, and its mark against another version as an icon and a word. A connection goes
 * through the adapter's port rules, the outline's "Connect to" list (`isValidConnection`); a moved
 * node writes only the layout member; nothing is deleted from the canvas, only through the outline's
 * confirmed delete. The library's strings are the adapter's, from the typed catalog (C155.9), and
 * its "React Flow" attribution stays (decision 73).
 */
import '@xyflow/react/dist/base.css';
import './graph-canvas.css';
import {
  Controls,
  Handle,
  Position as Side,
  ReactFlow,
  type Edge,
  type IsValidConnection,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import { memo, useId, useMemo, useState, useSyncExternalStore } from 'react';
import { GRAPH_EDITOR_COPY } from '../../lib/copy/graph-editor';
import type {
  DiffMark,
  GraphAdapter,
  GraphAdapterTypes,
  GraphIssue,
  GraphNodeView,
  GraphPath,
  GraphPosition,
} from './graph-adapter';
import { graphChangesOf, graphConnectionOf } from './graph-changes';
import { NODE_HEIGHT, NODE_WIDTH } from './layout';

export interface GraphCanvasProps<T extends GraphAdapterTypes> {
  readonly adapter: GraphAdapter<T>;
  readonly document: T['document'];
  readonly issues: readonly GraphIssue[];
  readonly marks: Readonly<Record<string, DiffMark>>;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  /** `undefined` read-only. A connection made on the canvas, or a node moved (one gesture). */
  readonly onEdit?: (edited: T['edit'], message: string, gesture?: string) => void;
  /** A run's path, drawn over the read-only canvas (C141.6, C156.6). */
  readonly path?: GraphPath;
}

type NodeData = Omit<GraphNodeView, 'id' | 'position'> & {
  readonly [member: string]: unknown;
  readonly issuesId: string;
};
type GraphNodeType = Node<NodeData, 'step'>;

const copy = GRAPH_EDITOR_COPY.canvas;

/** One node: its name, its badges, a way in (but the start) and a handle per port. */
const StepNode = memo(function StepNode({ data }: NodeProps<GraphNodeType>) {
  const mark = data.mark === null ? null : copy.marks[data.mark];
  return (
    <div className="wf-node">
      {!data.start && (
        <Handle
          type="target"
          position={Side.Top}
          id="in"
          className="wf-handle"
          title={copy.into(data.label)}
        />
      )}
      <p className="wf-node-label">{data.label}</p>
      {(data.issues.length > 0 || mark !== null || data.status !== null) && (
        <p className="wf-node-badges">
          {data.status !== null && (
            <span className="wf-badge">
              <span aria-hidden="true">{data.status.icon} </span>
              {data.status.word}
            </span>
          )}
          {data.issues.length > 0 && (
            <span className="wf-badge">
              <span aria-hidden="true">⚠ </span>
              {copy.errors(data.issues.length)}
            </span>
          )}
          {mark !== null && (
            <span className="wf-badge">
              <span aria-hidden="true">{mark.icon} </span>
              {mark.word}
            </span>
          )}
        </p>
      )}
      {data.issues.length > 0 && (
        <ul id={data.issuesId} className="sr-only">
          {data.issues.map((issue, index) => (
            <li key={`${String(index)}-${issue}`}>{issue}</li>
          ))}
        </ul>
      )}
      {data.ports.map((port, index) => (
        <Handle
          key={port.port}
          type="source"
          position={Side.Bottom}
          id={port.port}
          className="wf-handle"
          title={copy.portOf(port.label, data.label)}
          style={{ left: `${String(((index + 1) / (data.ports.length + 1)) * 100)}%` }}
        />
      ))}
    </div>
  );
});

const NODE_TYPES = { step: StepNode };

const noSubscription = () => () => undefined;

/**
 * True once hydrated in a browser that can measure the canvas (it needs `ResizeObserver`): the
 * canvas never renders on the server, and where it cannot draw, the outline still lists every node.
 */
function useCanvasReady(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => typeof ResizeObserver === 'function',
    () => false,
  );
}

function Canvas<T extends GraphAdapterTypes>({
  adapter,
  document,
  issues,
  marks,
  selectedId,
  onSelect,
  onEdit,
  path,
}: GraphCanvasProps<T>) {
  const flowId = `wf-canvas-${useId().replaceAll(':', '')}`;
  const [dragging, setDragging] = useState<Readonly<Record<string, GraphPosition>>>({});
  const model = useMemo(
    () => adapter.viewOf(document, issues, marks, path),
    [adapter, document, issues, marks, path],
  );
  const labels = useMemo(() => new Map(model.nodes.map((node) => [node.id, node.label])), [model]);

  const nodes = model.nodes.map((node): GraphNodeType => {
    const issuesId = `${flowId}-issues-${node.id}`;
    const { id, position, ...data } = node;
    return {
      id,
      type: 'step',
      position: dragging[id] ?? position,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      data: { ...data, issuesId },
      selected: id === selectedId,
      deletable: false,
      ariaLabel: [
        node.label,
        ...(node.status === null ? [] : [node.status.word]),
        ...(node.issues.length === 0 ? [] : [copy.errors(node.issues.length)]),
      ].join(', '),
      ...(node.issues.length === 0
        ? {}
        : {
            domAttributes: {
              'aria-describedby': `react-flow__node-desc-${flowId} ${issuesId}`,
            },
          }),
    };
  });
  const edges = model.edges.map((edge): Edge => ({
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.sourceHandle,
    target: edge.target,
    targetHandle: edge.targetHandle,
    deletable: false,
    ...(edge.label === null ? {} : { label: edge.label }),
    ...(edge.taken ? { className: 'wf-edge-taken' } : {}),
    ariaLabel: copy.edge(
      edge.label ?? copy.next,
      labels.get(edge.source) ?? edge.source,
      labels.get(edge.target) ?? edge.target,
      path === undefined ? null : edge.taken,
    ),
  }));

  const onNodesChange = (changes: NodeChange<GraphNodeType>[]) => {
    const {
      select,
      dragging: moving,
      released,
      edits,
    } = graphChangesOf(adapter, document, changes, labels, onEdit !== undefined);
    for (const id of select) {
      onSelect(id);
    }
    if (Object.keys(moving).length > 0 || released.length > 0) {
      setDragging((previous) => ({
        ...Object.fromEntries(Object.entries(previous).filter(([id]) => !released.includes(id))),
        ...moving,
      }));
    }
    for (const edit of edits) {
      onEdit?.(edit.edited, edit.message, edit.gesture);
    }
  };

  const isValidConnection: IsValidConnection = (connection) =>
    adapter.isValidConnection(document, {
      source: connection.source,
      sourceHandle: connection.sourceHandle ?? null,
      target: connection.target,
    });

  return (
    <div className="wf-canvas">
      <ReactFlow<GraphNodeType>
        id={flowId}
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        ariaLabelConfig={adapter.ariaLabels}
        fitView
        minZoom={0.25}
        deleteKeyCode={null}
        nodesDraggable={onEdit !== undefined}
        nodesConnectable={onEdit !== undefined}
        isValidConnection={isValidConnection}
        onNodesChange={onNodesChange}
        onNodeClick={(_event, node) => {
          onSelect(node.id);
        }}
        onConnect={(connection) => {
          const edit = graphConnectionOf(
            adapter,
            document,
            {
              source: connection.source,
              sourceHandle: connection.sourceHandle ?? null,
              target: connection.target,
            },
            labels,
          );
          if (edit !== null) {
            onEdit?.(edit.edited, edit.message);
          }
        }}
      >
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

/** The canvas, rendered on the client only; the outline beside it lists every node. */
export function GraphCanvas<T extends GraphAdapterTypes>(props: GraphCanvasProps<T>) {
  return useCanvasReady() ? <Canvas {...props} /> : <p className="text-sm">{copy.waiting}</p>;
}
