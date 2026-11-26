/**
 * C120.6 (P11; decision 78): run values, masked fail closed. Without PII visibility every step input
 * and output, run output, variable and trigger-snapshot value is `null`, except a member a schema
 * declares non-PII: ids, enums, statuses, booleans, counts and timestamps. An untyped value (an
 * Evaluate Code result, an HTTPS body with no schema, an undeclared variable) is always masked. The
 * keys stay, so a reader can tell a masked member from one that was never there.
 */
import type { WorkflowDefinition } from '@openverify/contracts';
import type { WorkflowRunStepRow } from '@openverify/db';
import {
  actionOutputMarks,
  parseTypeDsl,
  triggerViewType,
  type ActionRegistry,
  type ScopeType,
} from '@openverify/workflow-engine';

type Values = Record<string, unknown>;

const PLAIN_KINDS: ReadonlySet<string> = new Set([
  'boolean',
  'number',
  'integer',
  'datetime',
  'id',
  'enum',
]);

const isPlain = (type: ScopeType | undefined): boolean =>
  type !== undefined && PLAIN_KINDS.has(type.kind) && !type.pii;

const maskAll = (values: Values): Values =>
  Object.fromEntries(Object.keys(values).map((key) => [key, null]));

const keep = (values: Values, plain: (key: string) => boolean): Values =>
  Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, plain(key) ? value : null]),
  );

/** C119: what control flow and a wait put in their outputs: names, ids, counts and booleans. */
const PLAIN_CONTROL: Readonly<Record<string, ReadonlySet<string>>> = {
  conditional: new Set(['route']),
  loop: new Set(['iterations']),
  wait: new Set([
    'resolved-by',
    'event-id',
    'event-name',
    'resolver-type',
    'resolver-id',
    'resolved-via',
    'resolver-held-inquiries-write',
  ]),
};

/** The registry's marks, or nothing: an entry that cannot say masks everything. */
function marksOf(
  step: Pick<WorkflowRunStepRow, 'actionKey' | 'actionVersion'>,
  registry: ActionRegistry,
): Readonly<Record<string, boolean>> {
  const entry =
    step.actionKey === null ? undefined : registry.get(step.actionKey, step.actionVersion ?? 0);
  if (entry === undefined) {
    return {};
  }
  try {
    return actionOutputMarks(entry.key, entry.output);
  } catch {
    return {};
  }
}

export function maskStepOutput(
  step: Pick<WorkflowRunStepRow, 'nodeType' | 'actionKey' | 'actionVersion'>,
  output: Values,
  registry: ActionRegistry,
): Values {
  if (step.nodeType === 'action') {
    const marks = marksOf(step, registry);
    return keep(output, (key) => marks[key] === false);
  }
  const plain = PLAIN_CONTROL[step.nodeType];
  return plain === undefined ? maskAll(output) : keep(output, (key) => plain.has(key));
}

/** A declared input or variable keeps its value when its own type says it holds no PII. */
function declaredPlain(
  declared: readonly { readonly name: string; readonly type: string }[],
): ReadonlySet<string> {
  const plain = new Set<string>();
  for (const { name, type } of declared) {
    const parsed = parseTypeDsl(type);
    if (parsed.ok && isPlain(parsed.type)) {
      plain.add(name);
    }
  }
  return plain;
}

export const maskInputs = (values: Values, definition: WorkflowDefinition | null): Values => {
  const plain = declaredPlain(definition?.inputs ?? []);
  return keep(values, (key) => plain.has(key));
};

export const maskVariables = (values: Values, definition: WorkflowDefinition | null): Values => {
  const plain = declaredPlain(definition?.variables ?? []);
  return keep(values, (key) => plain.has(key));
};

/** C120.6: an output declared non-PII still shows only what cannot be free text. */
export function maskOutputs(values: Values, definition: WorkflowDefinition | null): Values {
  const declared = new Set(
    (definition?.outputs ?? []).filter(({ pii }) => !pii).map(({ name }) => name),
  );
  return keep(
    values,
    (key) =>
      declared.has(key) && (typeof values[key] === 'number' || typeof values[key] === 'boolean'),
  );
}

/** C120.6: the trigger's contract says which members are plain, when the snapshot names its type. */
export function maskTriggerSnapshot(values: Values): Values {
  const view = typeof values.type === 'string' ? triggerViewType(values.type) : null;
  if (view?.kind !== 'object') {
    return maskAll(values);
  }
  return keep(values, (key) => isPlain(view.members[key]));
}
