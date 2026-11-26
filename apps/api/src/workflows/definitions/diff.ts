/**
 * C116.6: the diff of two versions, computed on the server from their definitions and keyed by step
 * id. Definitions hold configuration and never subject data, so a change can show both values. `layout`
 * never counts as a change of a step: the nodes that only moved are listed apart.
 */
import type {
  WorkflowDefinition,
  WorkflowStep,
  WorkflowVersionDiffDocument,
} from '@openverify/contracts';
import { isDeepStrictEqual } from 'node:util';

type Attributes = WorkflowVersionDiffDocument['data']['attributes'];
export type WorkflowDiff = Omit<Attributes, 'against-version-id'>;
type Change = WorkflowDiff['trigger-changes'][number];
type Json = WorkflowDiff['trigger-changes'][number]['after'];

const token = (key: string | number) => String(key).replaceAll('~', '~0').replaceAll('/', '~1');

const isRecord = (value: unknown): value is Readonly<Record<string, Json>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Every leaf that differs, by pointer. A shape that differs is one change at its pointer. */
function changesOf(pointer: string, before: unknown, after: unknown, into: Change[]): void {
  if (isDeepStrictEqual(before, after)) {
    return;
  }
  if (isRecord(before) && isRecord(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      changesOf(`${pointer}/${token(key)}`, before[key] ?? null, after[key] ?? null, into);
    }
    return;
  }
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
    before.forEach((value: unknown, index) => {
      changesOf(`${pointer}/${String(index)}`, value, after[index], into);
    });
    return;
  }
  into.push({ pointer, before: (before ?? null) as Json, after: (after ?? null) as Json });
}

function changes(pointer: string, before: unknown, after: unknown): Change[] {
  const into: Change[] = [];
  changesOf(pointer, before, after, into);
  return into;
}

/** A list of `{ name }` as a map, so a reordered declaration is no change. */
function byName(root: string, before: readonly { name: string }[], after: typeof before): Change[] {
  const named = (list: typeof before) => new Map(list.map((item) => [item.name, item]));
  const was = named(before);
  const now = named(after);
  return [...new Set([...was.keys(), ...now.keys()])].flatMap((name) => {
    const pointer = `${root}/${token(name)}`;
    const old = was.get(name);
    const current = now.get(name);
    return old === undefined || current === undefined
      ? [{ pointer, before: old ?? null, after: current ?? null }]
      : changes(pointer, old, current);
  });
}

function diffSteps(version: WorkflowDefinition, against: WorkflowDefinition) {
  const of = (definition: WorkflowDefinition) =>
    new Map<string, WorkflowStep>(definition.steps.map((step) => [step.id, step]));
  const now = of(version);
  const was = of(against);
  return {
    added: [...now.keys()].filter((id) => !was.has(id)),
    removed: [...was.keys()].filter((id) => !now.has(id)),
    changed: [...now].flatMap(([id, step]) => {
      const old = was.get(id);
      const found = old === undefined ? [] : changes('', old, step);
      return found.length === 0 ? [] : [{ id, changes: found }];
    }),
  };
}

function diffEdges(version: WorkflowDefinition, against: WorkflowDefinition) {
  const missingFrom = (from: WorkflowDefinition, other: WorkflowDefinition) =>
    from.edges
      .filter((edge) => !other.edges.some((candidate) => isDeepStrictEqual(candidate, edge)))
      .map((edge) => edge.id);
  return { added: missingFrom(version, against), removed: missingFrom(against, version) };
}

export function diffDefinitions(
  version: WorkflowDefinition,
  against: WorkflowDefinition,
): WorkflowDiff {
  const steps = diffSteps(version, against);
  const changed = new Set(steps.changed.map(({ id }) => id));
  const moved = new Set([...Object.keys(version.layout), ...Object.keys(against.layout)]);
  return {
    steps,
    edges: diffEdges(version, against),
    'trigger-changes': changes('/trigger', against.trigger, version.trigger),
    'input-changes': byName('/inputs', against.inputs, version.inputs),
    'output-changes': byName('/outputs', against.outputs, version.outputs),
    'variable-changes': byName('/variables', against.variables, version.variables),
    'layout-changes': [...moved].filter(
      (id) => !changed.has(id) && !isDeepStrictEqual(version.layout[id], against.layout[id]),
    ),
  };
}
