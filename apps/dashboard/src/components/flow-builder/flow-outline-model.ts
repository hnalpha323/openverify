/**
 * The flow outline's model (C155.2): an APG tree from the entry along `next`, the path a person
 * takes read as a list; each other port (a route, else, exhausted, error, a further button) is a
 * group holding its target's chain, in order, and a step met again is a "Go to" item, never drawn
 * twice. Steps the entry does not reach are grouped last. Pure, so the keyboard-first view is tested
 * without a browser.
 */
import type { FlowV2, FlowV2Step } from '@openverify/flow-spec';
import { FLOW_BUILDER_COPY } from '../../lib/copy/flow-builder';
import type { DiffMark, GraphIssue } from '../graph-editor/graph-adapter';
import { edgeOnPort, stepOf, stepPorts } from './flow-model';

export interface FlowOutlineItem {
  /** A step id, or a key of its own for a port group, a go-to, a gap or the unreachable group. */
  readonly id: string;
  readonly kind: 'step' | 'port' | 'goto' | 'unset' | 'unreachable';
  readonly label: string;
  /** The step this item is, or whose port it is. */
  readonly stepId: string | null;
  readonly port: string | null;
  /** A go-to's step. */
  readonly target: string | null;
  readonly issues: readonly string[];
  readonly children: readonly FlowOutlineItem[];
}

const copy = FLOW_BUILDER_COPY;

/** A step in words: its type, its name when it has one, its id when its type repeats. */
export function flowStepLabel(flow: FlowV2, step: FlowV2Step): string {
  const type = copy.stepTypes[step.type];
  const name = 'name' in step ? step.name : undefined;
  if (name !== undefined && name !== '') {
    return `${type}: ${name}`;
  }
  return flow.steps.filter((other) => other.type === step.type).length > 1
    ? `${type} ${step.id}`
    : type;
}

/** A port in words, a route by its label (C147.4). */
export function flowPortLabel(step: FlowV2Step | undefined, port: string): string {
  if (port.startsWith('route:')) {
    const key = port.slice('route:'.length);
    const label =
      step?.type === 'branch' ? step.routes.find((route) => route.key === key)?.label : undefined;
    return copy.ports.route(label ?? key);
  }
  if (port.startsWith('button:')) {
    return copy.ports.button(port.slice('button:'.length));
  }
  switch (port) {
    case 'next':
      return copy.ports.next;
    case 'exhausted':
      return copy.ports.exhausted;
    case 'else':
      return copy.ports.else;
    case 'error':
      return copy.ports.error;
    default:
      return port;
  }
}

const STEP_POINTER = /^\/steps\/(\d+)(?:\/|$)/;

/**
 * The step a problem's JSON Pointer falls inside: the flow's own (`/steps/3`), the version's
 * (`/flow/steps/3`) or the request body's (`/data/attributes/flow/steps/3`); `null` for anything
 * else (an edge, the entry, another member).
 */
export function flowProblemStep(flow: FlowV2, pointer: string): string | null {
  let rest = pointer;
  for (const prefix of ['/data/attributes', '/flow']) {
    if (rest.startsWith(`${prefix}/`)) {
      rest = rest.slice(prefix.length);
    }
  }
  const match = STEP_POINTER.exec(rest);
  return match === null ? null : (flow.steps[Number(match[1])]?.id ?? null);
}

/** The tree of `flow`, each step with the problems that fall inside it. */
export function flowOutlineOf(
  flow: FlowV2,
  issues: readonly GraphIssue[],
  marks: Readonly<Record<string, DiffMark>> = {},
): FlowOutlineItem[] {
  const byStep = new Map<string, string[]>();
  for (const issue of issues) {
    const step = flowProblemStep(flow, issue.pointer);
    if (step !== null) {
      byStep.set(step, [...(byStep.get(step) ?? []), issue.detail]);
    }
  }
  const shown = new Set<string>();

  const unset = (from: string, port: string): FlowOutlineItem => ({
    id: `unset:${from}:${port}`,
    kind: 'unset',
    label: copy.outline.notConnected,
    stepId: from,
    port,
    target: null,
    issues: [],
    children: [],
  });

  const chain = (start: string, via: { from: string; port: string } | null): FlowOutlineItem[] => {
    const items: FlowOutlineItem[] = [];
    let current = start;
    let through = via;
    for (;;) {
      const step = stepOf(flow, current);
      if (step === undefined) {
        break;
      }
      if (shown.has(current)) {
        items.push({
          id: `goto:${through?.from ?? ''}:${through?.port ?? ''}`,
          kind: 'goto',
          label: copy.outline.goTo(flowStepLabel(flow, step)),
          stepId: through?.from ?? null,
          port: through?.port ?? null,
          target: current,
          issues: [],
          children: [],
        });
        break;
      }
      shown.add(current);
      // An unwired `exhausted` port is no gap: the fallback is optional (C150.6), and the step's
      // menu offers adding one.
      const children = stepPorts(step)
        .filter(
          (port) =>
            port !== 'next' &&
            (port !== 'exhausted' || edgeOnPort(flow, step.id, port) !== undefined),
        )
        .map((port): FlowOutlineItem => {
          const edge = edgeOnPort(flow, step.id, port);
          return {
            id: `${step.id}:${port}`,
            kind: 'port',
            label: flowPortLabel(step, port),
            stepId: step.id,
            port,
            target: edge?.to ?? null,
            issues: [],
            children:
              edge === undefined ? [unset(step.id, port)] : chain(edge.to, { from: step.id, port }),
          };
        });
      items.push({
        id: step.id,
        kind: 'step',
        label:
          marks[step.id] === undefined
            ? flowStepLabel(flow, step)
            : copy.outline.marked(flowStepLabel(flow, step), marks[step.id] ?? 'changed'),
        stepId: step.id,
        port: null,
        target: null,
        issues: byStep.get(step.id) ?? [],
        children,
      });
      if (!stepPorts(step).includes('next')) {
        break;
      }
      const next = edgeOnPort(flow, step.id, 'next');
      if (next === undefined) {
        items.push(unset(step.id, 'next'));
        break;
      }
      through = { from: step.id, port: 'next' };
      current = next.to;
    }
    return items;
  };

  const tree = chain(flow.entry, null);
  const rest = flow.steps.filter((step) => !shown.has(step.id));
  if (rest.length > 0) {
    const children: FlowOutlineItem[] = [];
    for (const step of rest) {
      if (!shown.has(step.id)) {
        children.push(...chain(step.id, null));
      }
    }
    tree.push({
      id: 'unreachable',
      kind: 'unreachable',
      label: copy.outline.unreachable,
      stepId: null,
      port: null,
      target: null,
      issues: [],
      children,
    });
  }
  return tree;
}
