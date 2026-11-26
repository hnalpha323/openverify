/**
 * The port rules the editor shares between its views (C113.3, C141.2, C141.3): which output ports a
 * node has, which edge sits on a port, and which targets a port may connect to. The outline's
 * "Connect next step to" lists exactly the targets the canvas's `isValidConnection` accepts,
 * because both call `canConnect`. The API's graph check stays the authority at save and publish;
 * these rules only keep the views from offering a connection the check refuses for its shape.
 */
import type { DraftDefinition, DraftEdge, DraftStep } from './document-model';

/** C113.1: the trigger is an edge endpoint with no step of its own. */
export const TRIGGER_NODE = 'trigger';
/** C113.1: the output node's literal id. */
export const OUTPUT_NODE = 'output';
/** C113.3: a loop body's back-edge ends at its loop's `continue` port. */
export const CONTINUE_PORT = 'continue';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The `key` of each entry of a route or branch list, skipping what is not one. */
function keysOf(list: unknown): string[] {
  if (!Array.isArray(list)) {
    return [];
  }
  return list.flatMap((entry: unknown) =>
    isRecord(entry) && typeof entry.key === 'string' ? [entry.key] : [],
  );
}

/** The ports a node must connect (C113.3); `error` is the optional one. */
export function requiredPortsOf(step: DraftStep | null): readonly string[] {
  switch (step?.type) {
    case 'output':
      return [];
    case 'parallel':
      return keysOf(step.branches).map((key) => `branch:${key}`);
    case 'conditional':
      return [...keysOf(step.routes).map((key) => `route:${key}`), 'else'];
    case 'loop':
      return ['body', 'done'];
    default:
      return ['next'];
  }
}

/** C113.2: the node types that can fail along an edge of their own. */
const hasErrorPort = (step: DraftStep): boolean =>
  step.type === 'action' || step.type === 'loop' || step.type === 'module';

/** Every port a node has (C113.3). The trigger (`null`) has `next`. */
export function portsOf(step: DraftStep | null): readonly string[] {
  const required = requiredPortsOf(step);
  return step !== null && hasErrorPort(step) ? [...required, 'error'] : required;
}

/** The one edge on a port, if any. */
export function edgeOn(
  definition: DraftDefinition,
  from: string,
  port: string,
): DraftEdge | undefined {
  return definition.edges.find((edge) => edge.from === from && edge['from-port'] === port);
}

/** The step `id`, `null` for the trigger, `undefined` when no such node exists. */
function nodeOf(definition: DraftDefinition, id: string): DraftStep | null | undefined {
  if (id === TRIGGER_NODE) {
    return definition.trigger === null ? undefined : null;
  }
  return definition.steps.find((step) => step.id === id);
}

/** Whether `from` leads to `to` along forward edges (a loop body's back-edge is not one). */
function leadsTo(definition: DraftDefinition, from: string, to: string): boolean {
  const seen = new Set<string>([from]);
  const queue = [from];
  for (let current = queue.shift(); current !== undefined; current = queue.shift()) {
    if (current === to) {
      return true;
    }
    for (const edge of definition.edges) {
      if (edge.from === current && edge['to-port'] !== CONTINUE_PORT && !seen.has(edge.to)) {
        seen.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  return false;
}

/**
 * Whether `from`'s `port` may lead to `to` (C113.3, C113.5): the source and port exist, the target
 * is a step other than the source and the start (nothing leads into the trigger or a module's
 * input), and the target does not already lead back to the source, which would make a cycle.
 */
export function canConnect(
  definition: DraftDefinition,
  from: string,
  port: string,
  to: string,
): boolean {
  const source = nodeOf(definition, from);
  if (source === undefined || !portsOf(source).includes(port)) {
    return false;
  }
  const target = to === TRIGGER_NODE ? undefined : nodeOf(definition, to);
  if (target === undefined || target === null || to === from || target.type === 'module-input') {
    return false;
  }
  return !leadsTo(definition, to, from);
}

/** The targets `from`'s `port` may lead to, in definition order. */
export function validTargets(
  definition: DraftDefinition,
  from: string,
  port: string,
): readonly string[] {
  return definition.steps
    .map((step) => step.id)
    .filter((id) => canConnect(definition, from, port, id));
}

/** "Next", "Route high", "Branch b", "Else", "Loop body", "After the loop", "On error". */
export function portWords(port: string): string {
  const separator = port.indexOf(':');
  if (separator !== -1) {
    const kind = port.slice(0, separator);
    return `${kind === 'route' ? 'Route' : 'Branch'} ${port.slice(separator + 1)}`;
  }
  switch (port) {
    case 'next':
      return 'Next';
    case 'else':
      return 'Else';
    case 'body':
      return 'Loop body';
    case 'done':
      return 'After the loop';
    case 'error':
      return 'On error';
    default:
      return port;
  }
}
