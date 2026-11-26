/**
 * The variable picker's scope (C115.3): what a step can read where it stands, each path with its
 * type and two marks: nullable (C114.6: it can be unknown, so a condition must say what then) and
 * PII (C115.6: it is personal data, so it taints what it reaches). The trigger view, the declared
 * inputs and variables, the run's own members, and the output of every step that comes before this
 * one on every path (it dominates it, C115.3), each typed by the catalogue's output schema with its
 * marks (C120.6). A step that continues on error may have no output, so its outputs are nullable.
 *
 * This is the editor's aid, computed in the browser from what the API served; the API's graph check
 * types every path and stays the authority (C113.5). It is also where the console finds a step's
 * egress (C121.4): an egress action whose settings read a PII path.
 */
import type { ScopePath } from '../../graph-editor/graph-adapter';
import type { DraftDefinition, DraftStep } from './document-model';
import type { CatalogueAction } from './palette-model';
import { CONTINUE_PORT, TRIGGER_NODE } from './port-rules';

/**
 * A path a condition may read, with its type and marks: the shared editor's (C155.1), whose
 * optional tier and stage only a flow's facts carry.
 */
export type { ScopePath } from '../../graph-editor/graph-adapter';

export interface SchemaMarks {
  readonly nullable?: boolean;
  readonly pii?: boolean;
}

type Schema = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Schema =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Members past this depth are offered as their object. */
const MAX_DEPTH = 3;

const allowsNull = (schema: Schema): boolean =>
  schema.type === 'null' ||
  (Array.isArray(schema.type) && schema.type.includes('null')) ||
  (Array.isArray(schema.anyOf) &&
    schema.anyOf.some((option) => isRecord(option) && option.type === 'null'));

/** The schema without its `null` alternative, when one alternative is left. */
function coreOf(schema: Schema): Schema {
  if (Array.isArray(schema.type)) {
    const types = schema.type.filter((type) => type !== 'null');
    return types.length === 1 ? { ...schema, type: types[0] } : { ...schema, type: types };
  }
  if (Array.isArray(schema.anyOf)) {
    const options = schema.anyOf.filter(
      (option): option is Schema => isRecord(option) && option.type !== 'null',
    );
    const [only] = options;
    return options.length === 1 && only !== undefined ? only : schema;
  }
  return schema;
}

/** An id's pattern starts with its prefix: `^idec_`, `^inq_[0-7]…`. */
const ID_PATTERN = /^\^[a-z]+_/;

function typeOf(schema: Schema): { readonly type: string; readonly options: readonly string[] } {
  const values = Array.isArray(schema.enum)
    ? schema.enum
    : schema.const === undefined
      ? null
      : [schema.const];
  if (values?.every((value) => typeof value === 'string')) {
    return { type: 'enum', options: values };
  }
  switch (schema.type) {
    case 'string':
      if (typeof schema.pattern === 'string' && ID_PATTERN.test(schema.pattern)) {
        return { type: 'id', options: [] };
      }
      return { type: schema.format === 'date-time' ? 'datetime' : 'string', options: [] };
    case 'integer':
    case 'number':
    case 'boolean':
      return { type: schema.type, options: [] };
    case 'array':
      return { type: 'list', options: [] };
    case 'object':
      return { type: 'object', options: [] };
    default:
      return { type: 'any', options: [] };
  }
}

function walk(
  schema: Schema,
  path: string,
  source: string,
  marks: Required<SchemaMarks>,
  depth: number,
): ScopePath[] {
  const nullable = marks.nullable || allowsNull(schema);
  const pii = marks.pii || schema.pii === true;
  const core = coreOf(schema);
  if (isRecord(core.properties) && depth < MAX_DEPTH) {
    return Object.entries(core.properties).flatMap(([name, member]) =>
      walk(isRecord(member) ? member : {}, `${path}.${name}`, source, { nullable, pii }, depth + 1),
    );
  }
  return [{ path, ...typeOf(core), nullable, pii, source }];
}

/** Each member of an output schema (C122.4) under `prefix`, with its type and marks. */
export function pathsOfSchema(
  schema: unknown,
  prefix: string,
  source: string,
  marks: SchemaMarks = {},
): ScopePath[] {
  if (!isRecord(schema) || !isRecord(schema.properties)) {
    return [];
  }
  const inherited = { nullable: marks.nullable ?? false, pii: marks.pii ?? false };
  return Object.entries(schema.properties).flatMap(([name, member]) =>
    walk(isRecord(member) ? member : {}, `${prefix}.${name}`, source, inherited, 1),
  );
}

const SCALARS = new Set(['string', 'number', 'integer', 'boolean', 'datetime']);

/** A declared input, variable or output (C115.3), typed by its DSL text and its `pii` suffix. */
export function declaredPath(
  path: string,
  type: string,
  source: string,
  marks: SchemaMarks = {},
): ScopePath {
  const text = type.trim();
  const suffixed = /\s+pii$/.test(text);
  const bare = suffixed ? text.replace(/\s+pii$/, '') : text;
  const enumValues = /^enum<([^>]*)>$/.exec(bare);
  const word = /^[a-z]+/.exec(bare)?.[0] ?? '';
  const kind = SCALARS.has(bare)
    ? bare
    : enumValues !== null
      ? 'enum'
      : word === 'id' || word === 'file'
        ? 'id'
        : word === 'list'
          ? 'list'
          : word === 'object'
            ? 'object'
            : 'any';
  return {
    path,
    type: kind,
    options: enumValues === null ? [] : (enumValues[1] ?? '').split(',').map((v) => v.trim()),
    nullable: marks.nullable ?? false,
    pii: (marks.pii ?? false) || suffixed,
    source,
  };
}

/** C114.4: the run's own members; never its environment's secrets. */
const RUN_PATHS: readonly ScopePath[] = [
  ['current_run.id', 'id'],
  ['current_run.created-at', 'datetime'],
  ['current_run.workflow-id', 'id'],
  ['current_run.version-id', 'id'],
].map(([path = '', type = '']) => ({
  path,
  type,
  options: [],
  nullable: false,
  pii: false,
  source: 'This run',
}));

const ENVIRONMENT_KIND: ScopePath = {
  path: 'current_run.environment.kind',
  type: 'enum',
  options: ['sandbox', 'production'],
  nullable: false,
  pii: false,
  source: 'This run',
};

/** The steps that come before `nodeId` on every path from the trigger (its dominators). */
function dominatorsOf(definition: DraftDefinition, nodeId: string): ReadonlySet<string> {
  const nodes = [TRIGGER_NODE, ...definition.steps.map((step) => step.id)];
  const predecessors = new Map<string, string[]>(nodes.map((node) => [node, []]));
  for (const edge of definition.edges) {
    if (edge['to-port'] !== CONTINUE_PORT) {
      predecessors.get(edge.to)?.push(edge.from);
    }
  }
  const all = new Set(nodes);
  const dominators = new Map<string, Set<string>>(
    nodes.map((node) => [node, node === TRIGGER_NODE ? new Set([node]) : new Set(all)]),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (node === TRIGGER_NODE) {
        continue;
      }
      const from = (predecessors.get(node) ?? []).map(
        (predecessor) => dominators.get(predecessor) ?? new Set<string>(),
      );
      const [first, ...rest] = from;
      const next = new Set(
        first === undefined
          ? [node]
          : [...first].filter((id) => rest.every((set) => set.has(id))).concat(node),
      );
      const current = dominators.get(node);
      if (current?.size !== next.size) {
        dominators.set(node, next);
        changed = true;
      }
    }
  }
  return dominators.get(nodeId) ?? new Set();
}

const isRecordList = (value: unknown): readonly Schema[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

/** What a step makes available to the steps after it. */
function outputPathsOf(step: DraftStep, actions: readonly CatalogueAction[]): ScopePath[] {
  const prefix = `steps.${step.id}.output`;
  const source = `Step ${step.name}`;
  if (step.type === 'action') {
    const action =
      actions.find(
        (row) => row.key === step['action-key'] && row.version === step['action-version'],
      ) ?? actions.find((row) => row.key === step['action-key']);
    return pathsOfSchema(action?.outputSchema, prefix, source, {
      nullable: step['continue-on-error'] === true,
    });
  }
  if (step.type === 'wait' && step.mode === 'events') {
    return [
      {
        path: `${prefix}.resolved-by`,
        type: 'enum',
        options: ['event', 'timeout'],
        nullable: false,
        pii: false,
        source,
      },
    ];
  }
  return [];
}

/** C115.3: every path a step at `nodeId` can read, with its type and marks. */
export function scopeAt(
  definition: DraftDefinition,
  nodeId: string,
  actions: readonly CatalogueAction[],
  triggerPaths: readonly ScopePath[],
): ScopePath[] {
  const inputs = isRecordList(definition.inputs).map((input) =>
    declaredPath(`inputs.${String(input.name)}`, String(input.type), 'Input', {
      nullable: input.required !== true,
      pii: input.pii === true,
    }),
  );
  const variables = isRecordList(definition.variables).map((variable) =>
    declaredPath(`vars.${String(variable.name)}`, String(variable.type), 'Variable', {
      pii: variable.pii === true,
    }),
  );
  const before = dominatorsOf(definition, nodeId);
  const steps = definition.steps
    .filter((step) => step.id !== nodeId && before.has(step.id))
    .flatMap((step) => outputPathsOf(step, actions));
  return [...triggerPaths, ...inputs, ...variables, ...RUN_PATHS, ENVIRONMENT_KIND, ...steps];
}

const REFERENCE = /\{\{\s*([^{}\s]+)\s*\}\}/g;

/** Every `{{ path }}` in a value's string leaves (C115.1), each once, in order. */
export function referencesOf(value: unknown): string[] {
  const found = new Set<string>();
  const visit = (item: unknown): void => {
    if (typeof item === 'string') {
      for (const match of item.matchAll(REFERENCE)) {
        found.add(String(match[1]));
      }
    } else if (Array.isArray(item)) {
      item.forEach(visit);
    } else if (isRecord(item)) {
      Object.values(item).forEach(visit);
    }
  };
  visit(value);
  return [...found];
}

/** Whether `reference` reads personal data: a PII path, a member below one, or an object above. */
const readsPii = (reference: string, scope: readonly ScopePath[]): boolean =>
  scope.some(
    (path) =>
      path.pii &&
      (path.path === reference ||
        reference.startsWith(`${path.path}.`) ||
        path.path.startsWith(`${reference}.`)),
  );

/**
 * C121.4, C115.6: the PII paths an egress step's settings send off the platform, which publishing
 * marks and needs acknowledged; none for a step that does not leave the platform.
 */
export function egressOf(
  step: DraftStep,
  action: CatalogueAction | undefined,
  scope: readonly ScopePath[],
): string[] {
  if (action?.kind !== 'egress') {
    return [];
  }
  return referencesOf(step.config).filter((reference) => readsPii(reference, scope));
}
