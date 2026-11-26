/**
 * C147.10 (owner `flow-spec-logic`; review F07): v1 to v2, lossless and golden-tested on every
 * v1 fixture (`v2/golden/migrations/`). Stored rows are never rewritten: the API migrates on read.
 *
 * Each v1 step keeps its id, and `entry` is the first step. v1 runs a step, then takes the first of
 * its transitions whose condition is absent or true, else the next step in list order. So for each
 * non-terminal step S:
 * - its conditional transitions listed before its first unconditional one become a `branch`
 *   `<S>-routes` (a numeric suffix when taken; shortened with a hash past 64 characters) whose routes
 *   are those transitions in order, each with `onNull: "else"`, and whose `else` is that first
 *   unconditional transition's target or, failing one, the next step in list order;
 * - transitions after its first unconditional one are dropped (v1 never reaches them), each a note;
 * - otherwise S gets a `next` edge to its target or the next step;
 * - a last step that is not terminal gets a `next` edge to a synthetic `completion` step (no
 *   `messageKey`), as v1 ends there with completion.
 *
 * Conditions keep v1's semantics: `{"var": "inquiry.status"}` stays (the only fact v1's context
 * holds, never null); any other `var` becomes its v1 answer, the literal fallback (`null` unless the
 * `var` names one), so a migrated flow never meets `scope_path_missing`. Where Phase 8's strict
 * dialect could answer otherwise than v1's loose one (`==` or `!=` whose operands are not both
 * strings or `null`, a `null` under any other operator, an operator v1's clients never evaluated),
 * a note says so; the equivalence test runs every fixture through both.
 *
 * A v1 `form` step becomes a `screen` with the matching form components (`text` -> `text_input`,
 * `date`, `email`, `phone`, `select` with options keyed `o1`, `o2`, ..., `country` ->
 * `country_select`) and a submit button. Notes also flag a field pattern the restricted grammar
 * refuses, and a consent step that does not come first on every path to a step that collects data
 * (the C147.6 publish rule a draft made from it must then meet).
 */
import { FlowSpecError, type FlowStep, type FormField, type FlowTransition } from '../flow.js';
import { compilePattern } from './pattern/index.js';
import { dominates, graphModelOf } from './rules/graph-model.js';
import { flowV2Schema, type FlowV2 } from './schemas/flow.js';
import { isFlowV2, type AnyFlow, type FlowV1 } from './schemas/versions.js';

/** A change the migration made that a reader should know of, by pointer into the v1 input. */
export interface MigrationNote {
  readonly pointer: string;
  readonly code: string;
  readonly detail: string;
}

export interface MigratedFlow {
  readonly flow: FlowV2;
  readonly notes: readonly MigrationNote[];
}

/** The note codes a migration can give, so the builder can word each. */
export const MIGRATION_NOTE_CODES = Object.freeze([
  'transition_dropped',
  'synthetic_completion',
  'form_to_screen',
  'path_outside_v1_context',
  'var_default_dropped',
  'var_object_context',
  'condition_folded',
  'loose_equality',
  'null_operand',
  'operator_outside_v1',
  'pattern_refused',
  'consent_not_first',
] as const);
export type MigrationNoteCode = (typeof MIGRATION_NOTE_CODES)[number];

/** The copy key of the submit button a migrated form gets (the web flow's built-in word). */
export const MIGRATED_SUBMIT_LABEL_KEY = 'screen.continue';

/** The only fact v1's condition context holds (`flowConditionContext`). */
const V1_CONTEXT_PATH = 'inquiry.status';
const V1_OPERATORS = new Set(['var', '==', '!=', '===', '!==', '!', '!!', 'and', 'or', 'in']);
const EQUALITY = new Set(['==', '!=', '===', '!==']);
const LOOSE = new Set(['==', '!=']);
const TERMINAL = new Set(['completion', 'failure']);
const MAX_ID = 64;
type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** FNV-1a over the UTF-16 code units, in base 36: a short, stable suffix (not a security hash). */
function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, '0').slice(0, 7);
}

class Migration {
  readonly notes: MigrationNote[] = [];
  readonly ids: Set<string>;

  constructor(readonly v1: FlowV1) {
    this.ids = new Set(v1.steps.map((step) => step.id));
  }

  note(pointer: string, code: MigrationNoteCode, detail: string): void {
    this.notes.push({ pointer, code, detail });
  }

  /** A step id not taken yet, from `base`; past 64 characters the base keeps a hash suffix. */
  freshId(base: string): string {
    const fit = (candidate: string, suffix: string): string =>
      candidate.length + suffix.length <= MAX_ID
        ? `${candidate}${suffix}`
        : `${candidate.slice(0, MAX_ID - suffix.length - 8)}-${shortHash(candidate)}${suffix}`;
    let id = fit(base, '');
    for (let n = 2; this.ids.has(id); n += 1) id = fit(base, `-${String(n)}`);
    this.ids.add(id);
    return id;
  }

  /**
   * A condition with v1's one context path kept, every other path replaced by its v1 answer (the
   * literal fallback), and every sub-condition that reads no `inquiry.status` folded to its v1
   * value, so the strict dialect cannot answer otherwise than v1 did.
   */
  condition(raw: Json, pointer: string): Json {
    return this.fold(this.substitute(raw, pointer), pointer, null) as Json;
  }

  private substitute(node: unknown, pointer: string): unknown {
    if (Array.isArray(node)) {
      return node.map((item: unknown, index) =>
        this.substitute(item, `${pointer}/${String(index)}`),
      );
    }
    if (!isRecord(node)) return node;
    const keys = Object.keys(node);
    const [operator] = keys;
    if (keys.length !== 1 || operator === undefined) return node;
    const raw = node[operator];
    const at = `${pointer}/${operator.replaceAll('~', '~0').replaceAll('/', '~1')}`;
    if (operator === 'var') return this.variable(raw, at);
    if (!V1_OPERATORS.has(operator)) {
      this.note(
        at,
        'operator_outside_v1',
        `v1's clients stopped at "${operator}"; v2 evaluates it`,
      );
    }
    return { [operator]: this.substitute(raw, at) };
  }

  private variable(raw: unknown, pointer: string): unknown {
    const [path, fallback = null] = Array.isArray(raw) ? (raw as unknown[]) : [raw];
    if (path === V1_CONTEXT_PATH) {
      if (Array.isArray(raw) && raw.length > 1) {
        this.note(
          pointer,
          'var_default_dropped',
          'inquiry.status is never missing, so v1 never read the default',
        );
      }
      return { var: V1_CONTEXT_PATH };
    }
    if (path === '' || path === 'inquiry') {
      // No literal stands for v1's context object, so it is kept as a read: never folded into a
      // confident answer, and refused by the typing at publish until the author rewrites it.
      this.note(
        pointer,
        'var_object_context',
        'v1 read its whole context here; rewrite this condition',
      );
      return { var: 'inquiry' };
    }
    this.note(
      pointer,
      'path_outside_v1_context',
      'v1 read this path as its fallback; the migrated condition holds that literal',
    );
    return fallback;
  }

  private fold(node: unknown, pointer: string, parent: string | null): unknown {
    if (isFree(node) && (isRecord(node) || (Array.isArray(node) && node.some(isRecord)))) {
      const value = v1Value(node);
      if (parent === null) {
        this.note(
          pointer,
          'condition_folded',
          'This condition reads no v1 fact, so it is its v1 answer',
        );
        return { '!!': [truthy(value)] };
      }
      this.note(pointer, 'condition_folded', 'This part reads no v1 fact, so it is its v1 answer');
      this.noteNull(value, pointer, parent);
      return value;
    }
    if (Array.isArray(node)) {
      return node.map((item: unknown, index) =>
        this.fold(item, `${pointer}/${String(index)}`, parent),
      );
    }
    if (!isRecord(node)) {
      this.noteNull(node, pointer, parent);
      return node;
    }
    const [operator] = Object.keys(node);
    if (operator === undefined || operator === 'var') return node;
    const at = `${pointer}/${operator.replaceAll('~', '~0').replaceAll('/', '~1')}`;
    const raw = node[operator];
    const folded = Array.isArray(raw)
      ? raw.map((arg: unknown, index) => this.fold(arg, `${at}/${String(index)}`, operator))
      : this.fold(raw, at, operator);
    if (LOOSE.has(operator) && !(Array.isArray(folded) && folded.every(comparesAlike))) {
      this.note(at, 'loose_equality', `"${operator}" compares strictly in v2; v1 compared loosely`);
    }
    return { [operator]: folded };
  }

  private noteNull(value: unknown, pointer: string, parent: string | null): void {
    if (value === null && parent !== null && !EQUALITY.has(parent)) {
      this.note(
        pointer,
        'null_operand',
        `A null under "${parent}" is unknown in v2, where v1 read it as false`,
      );
    }
  }
}

const truthy = (value: unknown): boolean =>
  Array.isArray(value) ? value.length > 0 : Boolean(value);

/** Whether a (substituted) node reads no `inquiry.status` and holds only v1's operators. */
function isFree(node: unknown): boolean {
  if (Array.isArray(node)) return node.every(isFree);
  if (!isRecord(node)) return true;
  const [operator] = Object.keys(node);
  if (operator === undefined || !V1_OPERATORS.has(operator) || operator === 'var') return false;
  return isFree(node[operator]);
}

/**
 * v1's JSONLogic answer for a node that reads nothing (the web flow's own evaluator,
 * `apps/flow/src/flow/json-logic.ts`, removed in Workflow 9D as K9-34; see `git log` for it).
 */
function v1Value(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(v1Value);
  if (!isRecord(node)) return node;
  const [operator = ''] = Object.keys(node);
  const raw = node[operator];
  const args: readonly unknown[] = Array.isArray(raw) ? raw : [raw];
  const values = (): unknown[] => args.map(v1Value);
  switch (operator) {
    case 'and': {
      let value: unknown;
      for (const arg of args) {
        value = v1Value(arg);
        if (!truthy(value)) return value;
      }
      return value;
    }
    case 'or': {
      let value: unknown;
      for (const arg of args) {
        value = v1Value(arg);
        if (truthy(value)) return value;
      }
      return value;
    }
    case '==':
    case '!=': {
      const [left, right] = values();
      // v1's `==` was JavaScript's loose equality.
      const equal = left == right;
      return operator === '==' ? equal : !equal;
    }
    case '===':
    case '!==': {
      const [left, right] = values();
      return operator === '===' ? left === right : left !== right;
    }
    case '!':
      return !truthy(values()[0]);
    case '!!':
      return truthy(values()[0]);
    default: {
      const [needle, haystack] = values();
      return Array.isArray(haystack)
        ? haystack.includes(needle)
        : typeof haystack === 'string' && typeof needle === 'string' && haystack.includes(needle);
    }
  }
}

/** An operand v1 and v2 compare alike: a string, `null`, or v1's one context path. */
function comparesAlike(operand: unknown): boolean {
  if (operand === null || typeof operand === 'string') return true;
  return isRecord(operand) && operand.var === V1_CONTEXT_PATH;
}

function componentOf(field: FormField, migration: Migration, pointer: string): Json {
  const base = {
    id: field.name,
    field: field.name,
    labelKey: field.labelKey,
    required: field.required,
  };
  switch (field.type) {
    case 'text': {
      const { minLength, maxLength, pattern } = field.validation ?? {};
      if (pattern !== undefined) {
        const compiled = compilePattern(pattern);
        if (!compiled.ok) {
          migration.note(
            `${pointer}/validation/pattern`,
            'pattern_refused',
            `The restricted pattern grammar refuses this pattern (${compiled.reason})`,
          );
        }
      }
      return {
        ...base,
        kind: 'text_input',
        ...(minLength === undefined ? {} : { minLength }),
        ...(maxLength === undefined ? {} : { maxLength }),
        ...(pattern === undefined ? {} : { pattern }),
      };
    }
    case 'date':
      return { ...base, kind: 'date', ...(field.validation ?? {}) };
    case 'email':
      return { ...base, kind: 'email' };
    case 'phone':
      return { ...base, kind: 'phone', ...(field.validation ?? {}) };
    case 'select':
      return {
        ...base,
        kind: 'select',
        options: field.options.map((option, index) => ({
          key: `o${String(index + 1)}`,
          value: option.value,
          labelKey: option.labelKey,
        })),
      };
    case 'country':
      return { ...base, kind: 'country_select', ...(field.validation ?? {}) };
  }
}

function stepOf(step: FlowStep, index: number, migration: Migration): Json {
  if (step.type !== 'form') return step;
  const pointer = `/steps/${String(index)}`;
  migration.note(
    pointer,
    'form_to_screen',
    'The form became a screen with its fields and a submit button',
  );
  const components = step.fields.map((field, at) =>
    componentOf(field, migration, `${pointer}/fields/${String(at)}`),
  );
  const taken = new Set(step.fields.map((field) => field.name));
  let button = 'continue';
  for (let n = 2; taken.has(button); n += 1) button = `continue_${String(n)}`;
  components.push({
    id: button,
    kind: 'button',
    labelKey: MIGRATED_SUBMIT_LABEL_KEY,
    action: 'submit',
  });
  return { id: step.id, type: 'screen', components };
}

function migrateV1(v1: FlowV1): MigratedFlow {
  const migration = new Migration(v1);
  const steps: Json[] = v1.steps.map((step, index) => stepOf(step, index, migration));
  const edges: { from: string; port: string; to: string }[] = [];
  // Created on first need, for a non-terminal last step (C147.10).
  const synthetic: { id: string | null } = { id: null };
  const completionId = (): string => {
    synthetic.id ??= migration.freshId('completion');
    return synthetic.id;
  };

  v1.steps.forEach((step, index) => {
    if (TERMINAL.has(step.type)) return;
    const outgoing = v1.transitions
      .map((transition, at) => ({ transition, at }))
      .filter(({ transition }) => transition.from === step.id);
    const firstUnconditional = outgoing.findIndex(
      ({ transition }) => transition.condition === undefined,
    );
    const conditional =
      firstUnconditional === -1 ? outgoing : outgoing.slice(0, firstUnconditional);
    for (const { at } of firstUnconditional === -1 ? [] : outgoing.slice(firstUnconditional + 1)) {
      migration.note(
        `/transitions/${String(at)}`,
        'transition_dropped',
        'v1 takes the first unconditional transition, so this one was never reached',
      );
    }
    const following = v1.steps[index + 1]?.id;
    const unconditional = outgoing[firstUnconditional]?.transition.to;
    const elseTarget = unconditional ?? following ?? completionId();
    if (conditional.length === 0) {
      edges.push({ from: step.id, port: 'next', to: elseTarget });
      return;
    }
    const branchId = migration.freshId(`${step.id}-routes`);
    steps.push({
      id: branchId,
      type: 'branch',
      routes: conditional.map(({ transition, at }, number) => ({
        key: `r${String(number + 1)}`,
        label: `Transition ${String(at + 1)}`,
        condition: migration.condition(
          (transition as FlowTransition & { condition: Json }).condition,
          `/transitions/${String(at)}/condition`,
        ),
        onNull: 'else',
      })),
    });
    edges.push({ from: step.id, port: 'next', to: branchId });
    conditional.forEach(({ transition }, number) => {
      edges.push({ from: branchId, port: `route:r${String(number + 1)}`, to: transition.to });
    });
    edges.push({ from: branchId, port: 'else', to: elseTarget });
  });

  if (synthetic.id !== null) {
    steps.push({ id: synthetic.id, type: 'completion' });
    migration.note(
      `/steps/${String(v1.steps.length - 1)}`,
      'synthetic_completion',
      'v1 ends with completion after its last step; v2 names that completion step',
    );
  }

  const parsed = flowV2Schema.safeParse({
    metadata: { ...v1.metadata, specVersion: 2 },
    entry: v1.steps[0]?.id,
    steps,
    edges: edges.map((edge, index) => ({ id: `e${String(index + 1)}`, ...edge })),
  });
  if (!parsed.success) {
    // Only a v1 document no v1 schema accepts can get here; never pass it on unchecked.
    throw new FlowSpecError(
      parsed.error.issues.map((issue) => ({
        pointer: '',
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    );
  }
  noteConsentOrder(parsed.data, v1, migration);
  return { flow: parsed.data, notes: migration.notes };
}

/** The steps that collect data: every verification step and every migrated form (C147.6). */
const COLLECTS = new Set([
  'government_id',
  'selfie',
  'document',
  'phone_otp',
  'email_otp',
  'database',
  'aamva',
  'nfc',
  'crypto_wallet',
  'database_business',
  'business_website',
  'screen',
]);

function noteConsentOrder(flow: FlowV2, v1: FlowV1, migration: Migration): void {
  const model = graphModelOf(flow);
  const consents = flow.steps.filter((step) => step.type === 'consent').map((step) => step.id);
  flow.steps.forEach((step) => {
    if (!COLLECTS.has(step.type) || !model.reachable.has(step.id)) return;
    if (consents.some((consent) => dominates(model, consent, step.id))) return;
    const index = v1.steps.findIndex((original) => original.id === step.id);
    migration.note(
      `/steps/${String(index)}`,
      'consent_not_first',
      'No consent step comes first on every path to this step; publishing a draft made from it is refused until one does',
    );
  });
}

/** A v2 flow as is; a v1 flow migrated (C147.1). */
export function migrateFlow(input: AnyFlow): FlowV2 {
  return migrateFlowWithNotes(input).flow;
}

/** `migrateFlow` with the notes the builder shows and the publish problems cite. */
export function migrateFlowWithNotes(input: AnyFlow): MigratedFlow {
  return isFlowV2(input) ? { flow: input, notes: [] } : migrateV1(input);
}
