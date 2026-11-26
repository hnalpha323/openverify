/**
 * A minimal adapter for the shared editor's own tests (C155.1): a line of named nodes, each with
 * one `next` port, which may lead to any other node except backwards. Every value is synthetic.
 */
import type {
  GraphAdapter,
  GraphAdapterTypes,
  GraphConnection,
  GraphPosition,
  ScopePath,
} from './graph-adapter';
import { issuesUnder, scopePathsSchema } from './graph-adapter';

export interface LineDocument {
  readonly nodes: readonly string[];
  readonly edges: readonly { readonly id: string; readonly from: string; readonly to: string }[];
  readonly layout: Readonly<Record<string, GraphPosition>>;
}

export interface LineEdit {
  readonly document: LineDocument;
  readonly select?: string;
}

export interface LineTypes extends GraphAdapterTypes {
  readonly document: LineDocument;
  readonly edit: LineEdit;
  readonly context: readonly ScopePath[];
  readonly diff: { readonly added: readonly string[] };
  readonly palette: { readonly id: string; readonly refusal: string | null };
}

const before = (document: LineDocument, a: string, b: string) =>
  document.nodes.indexOf(a) < document.nodes.indexOf(b);

const validConnection = (document: LineDocument, connection: GraphConnection) =>
  connection.sourceHandle === 'next' &&
  document.nodes.includes(connection.source) &&
  document.nodes.includes(connection.target) &&
  before(document, connection.source, connection.target);

export const LINE_ADAPTER: GraphAdapter<LineTypes> = {
  noun: 'line',
  ariaLabels: { 'controls.fitView.ariaLabel': 'Fit the line in view' },
  viewOf(document, issues, marks, path) {
    return {
      nodes: document.nodes.map((id, index) => ({
        id,
        position: document.layout[id] ?? { x: 0, y: index * 100 },
        label: `Node ${id}`,
        start: index === 0,
        ports: [{ port: 'next', label: 'Next' }],
        issues: issuesUnder(issues, `/nodes/${String(index)}`),
        mark: marks[id] ?? null,
        status: path?.statuses[id] === undefined ? null : { icon: '✓', word: 'Done' },
      })),
      edges: document.edges.map((edge) => ({
        id: edge.id,
        source: edge.from,
        sourceHandle: 'next',
        target: edge.to,
        targetHandle: 'in',
        label: null,
        taken: path?.taken.includes(edge.id) ?? false,
      })),
    };
  },
  portsOf: () => ['next'],
  portWords: (port) => (port === 'next' ? 'Next' : port),
  isValidConnection: validConnection,
  validTargets: (document, from, port) =>
    document.nodes.filter((to) =>
      validConnection(document, { source: from, sourceHandle: port, target: to }),
    ),
  connect(document, connection) {
    return validConnection(document, connection)
      ? {
          document: {
            ...document,
            edges: [
              ...document.edges.filter((edge) => edge.from !== connection.source),
              { id: `e-${connection.source}`, from: connection.source, to: connection.target },
            ],
          },
          select: connection.target,
        }
      : null;
  },
  place: (document, nodeId, position) => ({
    document: { ...document, layout: { ...document.layout, [nodeId]: position } },
    select: nodeId,
  }),
  problemNode(document, pointer) {
    const match = /^\/nodes\/(\d+)(?:\/|$)/.exec(pointer);
    return match === null ? null : (document.nodes[Number(match[1])] ?? null);
  },
  conditionScope: (_document, _nodeId, context) => context,
  conditionScopeSchema: (_document, _nodeId, context) => scopePathsSchema(context),
  paletteOf: (document) =>
    document.nodes.length >= 3
      ? [{ id: 'node', refusal: 'A line holds three nodes at most.' }]
      : [{ id: 'node', refusal: null }],
  diffMarksOf: (diff) => Object.fromEntries(diff.added.map((id) => [id, 'added' as const])),
};

export const LINE: LineDocument = {
  nodes: ['a', 'b', 'c'],
  edges: [{ id: 'e-a', from: 'a', to: 'b' }],
  layout: {},
};
