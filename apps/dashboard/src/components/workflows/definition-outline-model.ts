/**
 * The outline of a workflow definition (C141.2, editor note 2.4): the trigger at the root, each
 * step under the one before it, and the routes, the else, branches, loop bodies and error paths
 * as child groups. A step reached a second time (a join) is named, not repeated; a step no edge
 * reaches is listed under "Not connected". Each step carries the problems whose JSON Pointer
 * falls inside it, so the outline says how many it has. Pure, so it is tested without a DOM.
 */
import { portWords } from './editor/port-rules';
import { WORKFLOW_TRIGGER_TYPE_WORDS, wordOf } from './workflow-words';

export interface OutlineIssue {
  readonly pointer: string;
  readonly detail: string;
}

export interface OutlineItem {
  /** A step id, `trigger`, or a group key. */
  readonly id: string;
  readonly label: string;
  /** The step's index in `steps`, `null` for the trigger and groups. */
  readonly stepIndex: number | null;
  readonly issues: readonly OutlineIssue[];
  readonly children: readonly OutlineItem[];
}

interface Step {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly actionKey: string | null;
  readonly index: number;
  /** A conditional's route labels by key. */
  readonly routeLabels: ReadonlyMap<string, string>;
}

interface Edge {
  readonly from: string;
  readonly port: string;
  readonly to: string;
}

const STEP_WORDS: Readonly<Record<string, string>> = {
  action: 'Action',
  wait: 'Wait',
  parallel: 'Parallel',
  join: 'Join',
  conditional: 'Conditional',
  loop: 'Loop',
  'array-map-output': 'Collect',
  module: 'Module',
  output: 'Output',
  'module-input': 'Module input',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function stepsOf(value: unknown): Step[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((step: unknown, index) => {
    if (!isRecord(step)) {
      return [];
    }
    const id = text(step.id);
    if (id === null) {
      return [];
    }
    return [
      {
        id,
        name: text(step.name) ?? id,
        type: text(step.type) ?? 'step',
        actionKey: text(step['action-key']),
        index,
        routeLabels: new Map(
          (Array.isArray(step.routes) ? (step.routes as unknown[]) : []).flatMap((route) =>
            isRecord(route) && typeof route.key === 'string' && typeof route.label === 'string'
              ? [[route.key, route.label] as const]
              : [],
          ),
        ),
      },
    ];
  });
}

function edgesOf(value: unknown): Edge[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((edge: unknown) => {
    if (!isRecord(edge)) {
      return [];
    }
    const from = text(edge.from);
    const port = text(edge['from-port']);
    const to = text(edge.to);
    // A loop body's back-edge returns to its loop: it is not a step after the body.
    return from === null || port === null || to === null || edge['to-port'] === 'continue'
      ? []
      : [{ from, port, to }];
  });
}

/** A route's own label where it has one ("Route 1"), else the port in words ("Route high"). */
function groupWords(step: Step, port: string): string {
  if (port.startsWith('route:')) {
    const label = step.routeLabels.get(port.slice('route:'.length));
    if (label !== undefined) {
      return label;
    }
  }
  return portWords(port);
}

function stepLabel(step: Step): string {
  return stepLabelOf(step);
}

/** A step's name as the outline and the canvas both say it ("Action calculate: Score"). */
export function stepLabelOf(step: {
  readonly type: string;
  readonly name: string;
  readonly actionKey: string | null;
}): string {
  const kind = wordOf(STEP_WORDS, step.type);
  return `${step.actionKey === null ? kind : `${kind} ${step.actionKey}`}: ${step.name}`;
}

/** The trigger's name as the outline and the canvas both say it ("Trigger: The API"). */
export function triggerLabelOf(type: string | null): string {
  return `Trigger: ${type === null ? 'No trigger yet' : wordOf(WORKFLOW_TRIGGER_TYPE_WORDS, type)}`;
}

function issuesOf(index: number, issues: readonly OutlineIssue[]): OutlineIssue[] {
  const prefix = `/steps/${String(index)}`;
  return issues.filter(
    (issue) => issue.pointer === prefix || issue.pointer.startsWith(`${prefix}/`),
  );
}

export function outlineOf(definition: unknown, issues: readonly OutlineIssue[]): OutlineItem[] {
  if (!isRecord(definition)) {
    return [];
  }
  const steps = stepsOf(definition.steps);
  const byId = new Map(steps.map((step) => [step.id, step]));
  const edges = edgesOf(definition.edges);
  const visited = new Set<string>();

  const leaving = (from: string) => edges.filter((edge) => edge.from === from);

  /** The chain that starts at `id`: each step, then what follows its `next` port. */
  const chain = (id: string, key: string): OutlineItem[] => {
    const items: OutlineItem[] = [];
    let current: string | undefined = id;
    while (current !== undefined) {
      const step = byId.get(current);
      if (step === undefined) {
        break;
      }
      if (visited.has(step.id)) {
        items.push({
          id: `${key}/goes-on/${step.id}`,
          label: `Goes on at ${step.id}`,
          stepIndex: null,
          issues: [],
          children: [],
        });
        break;
      }
      visited.add(step.id);
      const out = leaving(step.id);
      const groups = out
        .filter((edge) => edge.port !== 'next')
        .map((edge) => {
          const groupKey = `${step.id}/${edge.port}`;
          return {
            id: groupKey,
            label: groupWords(step, edge.port),
            stepIndex: null,
            issues: [],
            children: chain(edge.to, groupKey),
          };
        });
      items.push({
        id: step.id,
        label: stepLabel(step),
        stepIndex: step.index,
        issues: issuesOf(step.index, issues),
        children: groups,
      });
      current = out.find((edge) => edge.port === 'next')?.to;
    }
    return items;
  };

  const trigger = isRecord(definition.trigger) ? text(definition.trigger.type) : null;
  const first = leaving('trigger').find((edge) => edge.port === 'next');
  const root: OutlineItem = {
    id: 'trigger',
    label: triggerLabelOf(trigger),
    stepIndex: null,
    issues: issues.filter(
      (issue) => issue.pointer === '/trigger' || issue.pointer.startsWith('/trigger/'),
    ),
    children: first === undefined ? [] : chain(first.to, 'trigger'),
  };
  const loose = steps.filter((step) => !visited.has(step.id));
  if (loose.length === 0) {
    return [root];
  }
  return [
    root,
    {
      id: 'not-connected',
      label: 'Not connected',
      stepIndex: null,
      issues: [],
      children: loose.map((step) => ({
        id: step.id,
        label: stepLabel(step),
        stepIndex: step.index,
        issues: issuesOf(step.index, issues),
        children: [],
      })),
    },
  ];
}
