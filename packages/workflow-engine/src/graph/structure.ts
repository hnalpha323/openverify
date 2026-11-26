/**
 * The shape of a definition's graph (plan C113.3, C113.5), shared by the graph check, the scope and
 * the interpreter: nodes, ports, edges, and what encloses what. Everything is computed from the
 * definition alone, so all three read the same structure.
 */
import type { WorkflowDefinition, WorkflowEdge, WorkflowStep } from '@openverify/contracts';

/** C113.1: the trigger is an edge endpoint, with no step of its own. */
export const TRIGGER_NODE = 'trigger';
/** C113.1: the output node's literal id. */
export const OUTPUT_NODE = 'output';

export const NEXT = 'next';
export const ERROR = 'error';
export const ELSE = 'else';
export const BODY = 'body';
export const DONE = 'done';
export const CONTINUE = 'continue';
export const ROUTE_PREFIX = 'route:';
export const BRANCH_PREFIX = 'branch:';

export interface IndexedEdge {
  readonly edge: WorkflowEdge;
  /** Its position in `edges`, for a pointer. */
  readonly index: number;
}

export interface GraphNode {
  readonly id: string;
  /** `null` for the trigger. */
  readonly step: WorkflowStep | null;
  /** Its position in `steps`, or -1 for the trigger. */
  readonly index: number;
}

export interface GraphIndex {
  readonly definition: WorkflowDefinition;
  readonly nodes: ReadonlyMap<string, GraphNode>;
  readonly outgoing: ReadonlyMap<string, readonly IndexedEdge[]>;
  readonly incoming: ReadonlyMap<string, readonly IndexedEdge[]>;
  /** The trigger, or a module's input node; `null` when a definition has neither yet. */
  readonly start: string | null;
}

export type ParallelStep = Extract<WorkflowStep, { type: 'parallel' }>;
export type LoopStep = Extract<WorkflowStep, { type: 'loop' }>;
export type ActionStep = Extract<WorkflowStep, { type: 'action' }>;
export type WaitStep = Extract<WorkflowStep, { type: 'wait' }>;
export type ConditionalStep = Extract<WorkflowStep, { type: 'conditional' }>;
export type ModuleStep = Extract<WorkflowStep, { type: 'module' }>;

/** C113.2: the three node types that can fail with an edge of their own. */
const hasErrorPort = (step: WorkflowStep): boolean =>
  step.type === 'action' || step.type === 'loop' || step.type === 'module';

/** C113.3: the ports a node must connect. `error` is the optional one. */
export function requiredPorts(step: WorkflowStep | null): readonly string[] {
  switch (step?.type) {
    case 'output':
      return [];
    case 'parallel':
      return step.branches.map(({ key }) => `${BRANCH_PREFIX}${key}`);
    case 'conditional':
      return [...step.routes.map(({ key }) => `${ROUTE_PREFIX}${key}`), ELSE];
    case 'loop':
      return [BODY, DONE];
    default:
      return [NEXT];
  }
}

/** C113.3: every port a node has. */
export function allowedPorts(step: WorkflowStep | null): readonly string[] {
  const required = requiredPorts(step);
  return step !== null && hasErrorPort(step) ? [...required, ERROR] : required;
}

const push = <Value>(map: Map<string, Value[]>, key: string, value: Value): void => {
  const list = map.get(key);
  if (list === undefined) {
    map.set(key, [value]);
  } else {
    list.push(value);
  }
};

export function indexGraph(definition: WorkflowDefinition): GraphIndex {
  const nodes = new Map<string, GraphNode>();
  if (definition.trigger !== null) {
    nodes.set(TRIGGER_NODE, { id: TRIGGER_NODE, step: null, index: -1 });
  }
  definition.steps.forEach((step, index) => {
    nodes.set(step.id, { id: step.id, step, index });
  });
  const outgoing = new Map<string, IndexedEdge[]>();
  const incoming = new Map<string, IndexedEdge[]>();
  definition.edges.forEach((edge, index) => {
    push(outgoing, edge.from, { edge, index });
    push(incoming, edge.to, { edge, index });
  });
  const moduleInput = definition.steps.find(({ type }) => type === 'module-input');
  const start = definition.trigger === null ? (moduleInput?.id ?? null) : TRIGGER_NODE;
  return { definition, nodes, outgoing, incoming, start };
}

export const edgesFrom = (graph: GraphIndex, id: string): readonly IndexedEdge[] =>
  graph.outgoing.get(id) ?? [];

export const edgesTo = (graph: GraphIndex, id: string): readonly IndexedEdge[] =>
  graph.incoming.get(id) ?? [];

/** The one edge on a port; the graph check holds a port to one edge. */
export const edgeOn = (graph: GraphIndex, id: string, port: string): WorkflowEdge | undefined =>
  edgesFrom(graph, id).find(({ edge }) => edge['from-port'] === port)?.edge;

export const isBackEdge = (edge: WorkflowEdge): boolean => edge['to-port'] === CONTINUE;

/** Everything `from` reaches, following edges forward, never past `stop`, never along a back-edge. */
export function reachable(
  graph: GraphIndex,
  from: readonly string[],
  stop: ReadonlySet<string> = new Set(),
): ReadonlySet<string> {
  const seen = new Set<string>();
  const stack = from.filter((id) => !stop.has(id));
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    if (!seen.has(id)) {
      seen.add(id);
      for (const { edge } of edgesFrom(graph, id)) {
        if (!isBackEdge(edge) && !stop.has(edge.to)) {
          stack.push(edge.to);
        }
      }
    }
  }
  return seen;
}

/** Every node that reaches one of `to`, following edges backward, back-edges included. */
export function reaching(graph: GraphIndex, to: readonly string[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const stack = [...to];
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    if (!seen.has(id)) {
      seen.add(id);
      for (const { edge } of edgesTo(graph, id)) {
        stack.push(edge.from);
      }
    }
  }
  return seen;
}

export interface ParallelRegion {
  readonly kind: 'parallel';
  readonly id: string;
  /** Its `join`, or `null` when the definition has none. */
  readonly join: string | null;
  /** Each branch key's nodes, the join left out. */
  readonly branches: ReadonlyMap<string, ReadonlySet<string>>;
  readonly body: ReadonlySet<string>;
}

export interface LoopRegion {
  readonly kind: 'loop';
  readonly id: string;
  readonly body: ReadonlySet<string>;
}

export type Region = ParallelRegion | LoopRegion;

function parallelRegion(graph: GraphIndex, step: ParallelStep): ParallelRegion {
  const join = graph.definition.steps.find(
    (candidate) => candidate.type === 'join' && candidate['join-of'] === step.id,
  );
  const stop = new Set(join === undefined ? [] : [join.id]);
  const branches = new Map<string, ReadonlySet<string>>();
  for (const { key } of step.branches) {
    const edge = edgeOn(graph, step.id, `${BRANCH_PREFIX}${key}`);
    branches.set(key, edge === undefined ? new Set() : reachable(graph, [edge.to], stop));
  }
  const body = new Set([...branches.values()].flatMap((nodes) => [...nodes]));
  return { kind: 'parallel', id: step.id, join: join?.id ?? null, branches, body };
}

function loopRegion(graph: GraphIndex, step: LoopStep): LoopRegion {
  const edge = edgeOn(graph, step.id, BODY);
  return {
    kind: 'loop',
    id: step.id,
    body: edge === undefined ? new Set() : reachable(graph, [edge.to], new Set([step.id])),
  };
}

/** Every parallel and loop of the definition, with what it holds. */
export function regionsOf(graph: GraphIndex): readonly Region[] {
  return graph.definition.steps.flatMap((step): readonly Region[] => {
    if (step.type === 'parallel') {
      return [parallelRegion(graph, step)];
    }
    return step.type === 'loop' ? [loopRegion(graph, step)] : [];
  });
}

/** What encloses each node, outermost first. Only a well-nested graph has a meaningful answer. */
export function enclosureOf(regions: readonly Region[]): ReadonlyMap<string, readonly Region[]> {
  const enclosure = new Map<string, Region[]>();
  const outermostFirst = regions.toSorted((left, right) => right.body.size - left.body.size);
  for (const region of outermostFirst) {
    for (const id of region.body) {
      push(enclosure, id, region);
    }
  }
  return enclosure;
}

/** The nodes in an order where each comes after what precedes it, or `null` for a cycle. */
export function forwardOrder(graph: GraphIndex): readonly string[] | null {
  const extra = extraEdges(graph);
  const waiting = new Map<string, number>();
  const followers = new Map<string, string[]>();
  for (const id of graph.nodes.keys()) {
    waiting.set(id, 0);
  }
  const link = (from: string, to: string): void => {
    if (waiting.has(from) && waiting.has(to)) {
      waiting.set(to, (waiting.get(to) ?? 0) + 1);
      push(followers, from, to);
    }
  };
  for (const edge of graph.definition.edges) {
    if (!isBackEdge(edge)) {
      link(edge.from, edge.to);
    }
  }
  for (const [from, to] of extra) {
    link(from, to);
  }
  const ready = [...waiting].filter(([, count]) => count === 0).map(([id]) => id);
  const order: string[] = [];
  for (let id = ready.shift(); id !== undefined; id = ready.shift()) {
    order.push(id);
    for (const follower of followers.get(id) ?? []) {
      const count = (waiting.get(follower) ?? 0) - 1;
      waiting.set(follower, count);
      if (count === 0) {
        ready.push(follower);
      }
    }
  }
  return order.length === graph.nodes.size ? order : null;
}

/**
 * A loop's `done` follows everything in its body, because a `map`'s output type comes from the body
 * and what follows reads it, though no edge says so.
 */
function extraEdges(graph: GraphIndex): readonly (readonly [string, string])[] {
  return graph.definition.edges.flatMap((edge) => {
    const done = isBackEdge(edge) ? edgeOn(graph, edge.to, DONE) : undefined;
    return done === undefined || isBackEdge(done) ? [] : [[edge.from, done.to] as const];
  });
}
