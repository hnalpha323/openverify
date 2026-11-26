/**
 * The graph a v2 flow describes, as the rules of C147.6 and the migration's notes read it: each
 * step's outgoing edges by port, what `entry` reaches, what reaches a terminal step, and the
 * dominators ("A dominates B": every path from `entry` to B passes A). Edges whose endpoints are not
 * steps are left out here (the rules report them). Pure; at most C147.5's 200 steps.
 */
import type { FlowV2, FlowV2Edge } from '../schemas/flow.js';
import type { FlowV2Step } from '../schemas/steps.js';

export interface GraphEdge {
  readonly index: number;
  readonly edge: FlowV2Edge;
}

export interface GraphModel {
  readonly steps: ReadonlyMap<string, FlowV2Step>;
  /** Each step's outgoing edges, in document order. */
  readonly out: ReadonlyMap<string, readonly GraphEdge[]>;
  /** Each step's predecessors over edges. */
  readonly into: ReadonlyMap<string, readonly string[]>;
  /** Steps reachable from `entry` (none when `entry` is not a step). */
  readonly reachable: ReadonlySet<string>;
  /** Each reachable step's dominators, itself included. */
  readonly dominators: ReadonlyMap<string, ReadonlySet<string>>;
}

/** The members every set holds; none for no set. */
function intersection(sets: readonly ReadonlySet<string>[]): Set<string> {
  const [first, ...rest] = sets;
  return new Set([...(first ?? [])].filter((member) => rest.every((set) => set.has(member))));
}

export function graphModelOf(flow: FlowV2): GraphModel {
  const steps = new Map(flow.steps.map((step) => [step.id, step]));
  const out = new Map<string, GraphEdge[]>(flow.steps.map((step) => [step.id, []]));
  const into = new Map<string, string[]>(flow.steps.map((step) => [step.id, []]));
  flow.edges.forEach((edge, index) => {
    if (steps.has(edge.from) && steps.has(edge.to)) {
      out.get(edge.from)?.push({ index, edge });
      into.get(edge.to)?.push(edge.from);
    }
  });

  const reachable = new Set<string>();
  const order: string[] = [];
  if (steps.has(flow.entry)) {
    const stack = [flow.entry];
    for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
      if (reachable.has(id)) continue;
      reachable.add(id);
      order.push(id);
      for (const { edge } of out.get(id) ?? []) stack.push(edge.to);
    }
  }

  // The iterative data-flow form: dom(entry) = {entry}; dom(n) = {n} + the meet of its predecessors'.
  const dominators = new Map<string, Set<string>>();
  for (const id of order) {
    dominators.set(id, id === flow.entry ? new Set([id]) : new Set(order));
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of order) {
      if (id === flow.entry) continue;
      const predecessors = (into.get(id) ?? []).filter((from) => reachable.has(from));
      const next = intersection(predecessors.map((from) => dominators.get(from) ?? new Set()));
      next.add(id);
      const current = dominators.get(id) ?? new Set<string>();
      if (next.size !== current.size || [...next].some((x) => !current.has(x))) {
        dominators.set(id, next);
        changed = true;
      }
    }
  }
  return { steps, out, into, reachable, dominators };
}

/** Whether every path from `entry` to `target` passes `dominator` (false when unreachable). */
export function dominates(model: GraphModel, dominator: string, target: string): boolean {
  return model.dominators.get(target)?.has(dominator) ?? false;
}

/** The steps from which some terminal step is reachable. */
export function reachesTerminal(model: GraphModel): ReadonlySet<string> {
  const done = new Set<string>();
  const stack = [...model.steps.values()]
    .filter((step) => step.type === 'completion' || step.type === 'failure')
    .map((step) => step.id);
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    if (done.has(id)) continue;
    done.add(id);
    for (const from of model.into.get(id) ?? []) stack.push(from);
  }
  return done;
}
