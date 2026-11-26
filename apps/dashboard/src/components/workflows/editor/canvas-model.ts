/**
 * What the canvas draws (C141.3, C141.5), computed from the one document model: a node per step
 * and one for the trigger, an edge per definition edge with its port in words, each node's
 * problems by JSON Pointer (C113.6) and its mark against the live version (C116.6). Pure, so the
 * canvas's own rules are tested without a browser.
 */
import {
  issuesUnder,
  type DiffMark,
  type GraphIssue,
  type GraphPath,
  type StatusBadge,
} from '../../graph-editor/graph-adapter';
import { stepLabelOf, triggerLabelOf } from '../definition-outline-model';
import { connectPort, type DraftDefinition, type Edited, type Position } from './document-model';
import { tidyLayout } from './layout';
import { CONTINUE_PORT, portsOf, portWords, TRIGGER_NODE } from './port-rules';

export type { DiffMark } from '../../graph-editor/graph-adapter';

/** A problem by JSON Pointer (C113.6). */
export type CanvasIssue = GraphIssue;

export interface StepNodeData {
  readonly [member: string]: unknown;
  /** The node's name, as the outline names it ("Wait: Wait for a time"). */
  readonly label: string;
  /** The trigger has no way in. */
  readonly start: boolean;
  /** Each output port, in words. */
  readonly ports: readonly { readonly port: string; readonly label: string }[];
  /** The problems whose pointer falls inside this node. */
  readonly issues: readonly string[];
  readonly mark: DiffMark | null;
  /** On a run's path: the node's status as an icon and a word, or "Not reached". */
  readonly status: StatusBadge | null;
}

export interface CanvasNode {
  readonly id: string;
  readonly position: Position;
  readonly data: StepNodeData;
}

export interface CanvasEdge {
  readonly id: string;
  readonly source: string;
  readonly sourceHandle: string;
  readonly target: string;
  readonly targetHandle: string;
  /** The port in words, or `null` for a plain next. */
  readonly label: string | null;
  /** On a run's path: whether the run took this edge. */
  readonly taken: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The canvas of `definition`: the trigger (once set) and each step, placed where the layout member
 * says or, for a node it does not place, where tidy-up would; each edge from its port's handle.
 */
export function canvasOf(
  definition: DraftDefinition,
  issues: readonly CanvasIssue[],
  marks: Readonly<Record<string, DiffMark>>,
  path?: RunPath,
): { readonly nodes: readonly CanvasNode[]; readonly edges: readonly CanvasEdge[] } {
  const missing = [
    ...(definition.trigger === null ? [] : [TRIGGER_NODE]),
    ...definition.steps.map((step) => step.id),
  ].some((id) => definition.layout[id] === undefined);
  const tidy = missing ? tidyLayout(definition) : {};
  const at = (id: string): Position => definition.layout[id] ?? tidy[id] ?? { x: 0, y: 0 };
  const trigger: readonly CanvasNode[] =
    definition.trigger === null
      ? []
      : [
          {
            id: TRIGGER_NODE,
            position: at(TRIGGER_NODE),
            data: {
              label: triggerLabelOf(definition.trigger.type),
              start: true,
              ports: [{ port: 'next', label: portWords('next') }],
              issues: issuesUnder(issues, '/trigger'),
              mark: null,
              status: path === undefined ? null : statusBadgeOf(path.statuses[TRIGGER_NODE]),
            },
          },
        ];
  const steps = definition.steps.map((step, index): CanvasNode => ({
    id: step.id,
    position: at(step.id),
    data: {
      label: stepLabelOf({
        type: step.type,
        name: step.name,
        actionKey: typeof step['action-key'] === 'string' ? step['action-key'] : null,
      }),
      start: false,
      ports: portsOf(step).map((port) => ({ port, label: portWords(port) })),
      issues: issuesUnder(issues, `/steps/${String(index)}`),
      mark: marks[step.id] ?? null,
      status: path === undefined ? null : statusBadgeOf(path.statuses[step.id]),
    },
  }));
  const edges = definition.edges.map((edge): CanvasEdge => ({
    id: edge.id,
    source: edge.from,
    sourceHandle: edge['from-port'],
    target: edge.to,
    targetHandle: edge['to-port'] === CONTINUE_PORT ? CONTINUE_PORT : 'in',
    label: edge['from-port'] === 'next' ? null : portWords(edge['from-port']),
    taken: path?.taken.includes(edge.id) ?? false,
  }));
  return { nodes: [...trigger, ...steps], edges };
}

const counted = (count: number, word: string) =>
  `${String(count)} ${word}${count === 1 ? '' : word.endsWith('ch') ? 'es' : 's'}`;

/** "12 steps, 2 branches, 1 error" (C141.3): steps leave out the output and joins. */
export function canvasSummary(definition: DraftDefinition, errors: number): string {
  const steps = definition.steps.filter(
    (step) => step.type !== 'output' && step.type !== 'join',
  ).length;
  const branches = definition.steps.reduce((total, step) => {
    if (step.type === 'conditional') {
      return total + (Array.isArray(step.routes) ? step.routes.filter(isRecord).length : 0) + 1;
    }
    if (step.type === 'parallel') {
      return total + (Array.isArray(step.branches) ? step.branches.filter(isRecord).length : 0);
    }
    return total;
  }, 0);
  return `${counted(steps, 'step')}, ${counted(branches, 'branch')}, ${counted(errors, 'error')}.`;
}

/** C116.6: each step the server diff added or changed. */
export function diffMarksOf(diff: {
  readonly steps: {
    readonly added: readonly string[];
    readonly changed: readonly { readonly id: string }[];
  };
}): Record<string, DiffMark> {
  return Object.fromEntries([
    ...diff.steps.added.map((id) => [id, 'added'] as const),
    ...diff.steps.changed.map(({ id }) => [id, 'changed'] as const),
  ]);
}

/** A connection drawn on the canvas, as the library reports it. */
export interface CanvasConnection {
  readonly source: string;
  readonly sourceHandle: string | null;
  readonly target: string;
}

/**
 * The edit a canvas connection makes, through the same port rules the outline's "Connect next
 * step to" lists (`connectPort`), or `null` when they refuse it: `isValidConnection` is this not
 * being `null`.
 */
export function connectionOf(
  definition: DraftDefinition,
  connection: CanvasConnection,
): Edited | null {
  return connection.sourceHandle === null
    ? null
    : connectPort(
        definition,
        { from: connection.source, port: connection.sourceHandle },
        connection.target,
      );
}

// ---------------------------------------------------------------------------------------------
// A run's path over the read-only canvas (C141.6, C141.9; stubs)

/** A step row of a run, as the path reads it. */
export interface RunStepRow {
  readonly nodeId: string;
  readonly iterationPath: string;
  readonly status: string;
}

/** Each node's status on a run, and the edges the run took. */
export type RunPath = GraphPath;

/** A step status as an icon and a word, never colour alone (WCAG 1.4.1). */
export type { StatusBadge } from '../../graph-editor/graph-adapter';

const STATUS_BADGES: Readonly<Record<string, StatusBadge>> = {
  started: { icon: '▶', word: 'Started' },
  pending: { icon: '○', word: 'Pending' },
  ready: { icon: '○', word: 'Ready' },
  running: { icon: '…', word: 'Running' },
  waiting: { icon: '⏸', word: 'Waiting' },
  succeeded: { icon: '✓', word: 'Succeeded' },
  failed: { icon: '✕', word: 'Failed' },
  skipped: { icon: '↷', word: 'Skipped' },
  canceled: { icon: '⊘', word: 'Canceled' },
  timed_out: { icon: '⏱', word: 'Timed out' },
  // C156.6 (Workflow 9C): a test run's step whose output was overridden.
  overridden: { icon: '✎', word: 'Overridden' },
};

const NOT_REACHED: StatusBadge = { icon: '–', word: 'Not reached' };

/** C120.1: a step's status as an icon and a word; a status the console does not know stays. */
export function statusBadgeOf(status: string | undefined): StatusBadge {
  if (status === undefined) {
    return NOT_REACHED;
  }
  return STATUS_BADGES[status] ?? { icon: '•', word: status };
}

/** A step that ended and led on: its next edge was taken. */
const LED_ON = new Set(['succeeded', 'failed', 'timed_out', 'skipped']);

/**
 * C141.6: each node's status on a run (its top-level row, else its latest iteration's), the
 * trigger as started, and each edge between two nodes that both ran, from one that led on.
 */
export function runPathOf(definition: DraftDefinition, steps: readonly RunStepRow[]): RunPath {
  const statuses: Record<string, string> = { [TRIGGER_NODE]: 'started' };
  for (const row of steps) {
    if (row.iterationPath === '' || statuses[row.nodeId] === undefined) {
      statuses[row.nodeId] = row.status;
    }
  }
  const taken = definition.edges
    .filter((edge) => {
      const from = statuses[edge.from];
      return (
        statuses[edge.to] !== undefined &&
        from !== undefined &&
        (edge.from === TRIGGER_NODE || LED_ON.has(from))
      );
    })
    .map((edge) => edge.id);
  return { statuses, taken };
}

/** The path as a list: from the trigger, along the edges taken, each node once. */
export function pathListOf(
  definition: DraftDefinition,
  path: RunPath,
): readonly { readonly id: string; readonly label: string; readonly badge: StatusBadge }[] {
  const canvas = canvasOf(definition, [], {}, path);
  const labels = new Map(canvas.nodes.map((node) => [node.id, node.data.label]));
  const taken = new Set(path.taken);
  const order: string[] = [];
  const visit = (id: string) => {
    if (order.includes(id) || path.statuses[id] === undefined) {
      return;
    }
    order.push(id);
    for (const edge of definition.edges) {
      if (edge.from === id && taken.has(edge.id)) {
        visit(edge.to);
      }
    }
  };
  visit(TRIGGER_NODE);
  for (const id of Object.keys(path.statuses)) {
    visit(id);
  }
  return order.map((id) => ({
    id,
    label: labels.get(id) ?? id,
    badge: statusBadgeOf(path.statuses[id]),
  }));
}

const pick = (value: Readonly<Record<string, unknown>>, members: readonly string[]) =>
  Object.fromEntries(
    members.flatMap((member) => (member in value ? [[member, value[member]]] : [])),
  );

/**
 * The graph's structure alone, for the run page's canvas (C141.6): ids, types, names, action keys,
 * route and branch keys with their labels, edges and layout. No step configuration, condition or
 * mapping goes to the browser with it.
 */
export function structureOf(definition: DraftDefinition): DraftDefinition {
  return {
    'schema-version': definition['schema-version'],
    trigger: definition.trigger === null ? null : { type: definition.trigger.type, config: {} },
    inputs: [],
    variables: [],
    outputs: [],
    steps: definition.steps.map((step) => ({
      ...(pick(step, ['action-key', 'join-of', 'mode', 'branches']) as Record<string, unknown>),
      id: step.id,
      type: step.type,
      name: step.name,
      ...(Array.isArray(step.routes)
        ? {
            routes: (step.routes as readonly unknown[]).map((route) =>
              isRecord(route) ? pick(route, ['key', 'label']) : {},
            ),
          }
        : {}),
    })),
    edges: definition.edges,
    layout: definition.layout,
  };
}
