/**
 * The variable scope per node (plan C115.3): what a path may read at each node, computed forward
 * over the graph.
 *
 * - `steps.<id>.output` is in scope only where the step is sure to have finished: at a merge a step
 *   must have finished on every incoming path, at a `join` on any branch, because every branch must
 *   finish (C119.4), and on an `error` edge the failed step is not in scope.
 * - a step that can continue on error reads nullable (C114.6), because its output may not be there.
 * - the loop item is in scope only inside its body, and nothing of a body is in scope after the loop.
 * - a computed output carries the taint of what fed it (C115.6): Calculate, Evaluate Code, a module.
 */
import type { WorkflowDefinition, WorkflowStep } from '@openverify/contracts';
import type { ActionRegistry, AnyActionRegistryEntry } from '../actions/registry.js';
import { isJsonRecord, type JsonValue } from '../expressions/json.js';
import { parsePath } from '../expressions/paths.js';
import { eventViewType, triggerViewType } from '../expressions/trigger-view.js';
import {
  BODY,
  DONE,
  ERROR,
  enclosureOf,
  forwardOrder,
  isBackEdge,
  edgesTo,
  regionsOf,
  type ActionStep,
  type GraphIndex,
  type LoopStep,
  type Region,
} from '../graph/structure.js';
import { parseTemplate } from '../templates/render.js';
import {
  ANY_TYPE,
  commonType,
  enumType,
  idType,
  listType,
  objectType,
  parseTypeDsl,
  resolvePath,
  scalarType,
  typeFromZod,
  withMarks,
  type ScopeType,
} from './types.js';

/** C119.8: a module's definition, as the check resolves it. */
export type ModuleResolver = (
  workflowId: string,
  version: string,
) => WorkflowDefinition | undefined;

export interface ScopeContext {
  readonly registry: ActionRegistry;
  readonly modules?: ModuleResolver;
  /** C140.2: `current_case`'s type, which Workflow 8B's provider fills. */
  readonly currentCase?: ScopeType;
}

export interface NodeScopes {
  /** An object of the roots in scope at each node. */
  readonly at: ReadonlyMap<string, ScopeType>;
  /** The output type of each step that has one. */
  readonly outputs: ReadonlyMap<string, ScopeType>;
  /** What is sure to have finished before each node, and whether it may have failed. */
  readonly before: ReadonlyMap<string, ReadonlyMap<string, boolean>>;
}

const RESOLVED_BY = ['event', 'timeout'] as const;
const RESOLVED_VIA = ['single', 'bulk'] as const;

/** C119.3: a wait's output, which C128.2 reads. */
const WAIT_EVENTS_OUTPUT = objectType({
  'resolved-by': enumType(RESOLVED_BY),
  'event-id': idType('evt', { nullable: true }),
  'event-name': scalarType('string', { nullable: true }),
  'resolver-type': scalarType('string', { nullable: true }),
  'resolver-id': idType(null, { nullable: true }),
  'resolved-via': enumType(RESOLVED_VIA, { nullable: true }),
  'resolver-held-inquiries-write': scalarType('boolean', { nullable: true }),
});

const CURRENT_RUN = objectType({
  id: idType('wfr'),
  'created-at': scalarType('datetime'),
  'workflow-id': idType('wfl'),
  'version-id': idType('wfv'),
  environment: objectType({ kind: enumType(['sandbox', 'production']) }),
});

const CONDITIONAL_OUTPUT = objectType({ route: scalarType('string') });
const LOOP_OUTPUT = objectType({ iterations: scalarType('integer') });
const NO_OUTPUT = objectType({});

/** C114.4, C140.2: each object type's flattened view; a case's is the case resource's (Workflow 8B). */
const OBJECT_VIEW_NAMES: Readonly<Record<string, string | null>> = {
  account: 'account',
  inquiry: 'inquiry',
  transaction: 'transaction',
  report: 'report',
  case: 'case',
};

const UNKNOWN_OBJECT = withMarks(ANY_TYPE, { nullable: true, pii: true });

function objectViewType(objectType: string): ScopeType {
  const view = OBJECT_VIEW_NAMES[objectType];
  if (view === null || view === undefined) {
    return UNKNOWN_OBJECT;
  }
  return triggerViewType(view) ?? eventViewType(`${view}/watchlist.ready`) ?? UNKNOWN_OBJECT;
}

const SUBJECT_OF_A_SCHEDULE = objectType(
  { id: idType(null), type: scalarType('string') },
  { nullable: true },
);

function eventsType(events: readonly string[]): ScopeType {
  const views = events.flatMap((event) => eventViewType(event) ?? []);
  const [first, ...others] = views;
  return first === undefined ? UNKNOWN_OBJECT : others.reduce(commonType, first);
}

function declaredObject(
  items: readonly {
    readonly name: string;
    readonly type: string;
    readonly pii?: boolean | undefined;
  }[],
  requiredOf: (name: string) => boolean,
): ScopeType {
  const members: Record<string, ScopeType> = {};
  for (const { name, type, pii } of items) {
    const parsed = parseTypeDsl(type);
    members[name] = withMarks(parsed.ok ? parsed.type : ANY_TYPE, {
      nullable: !requiredOf(name),
      pii: pii === true,
    });
  }
  return objectType(members);
}

const inputsType = ({ inputs }: WorkflowDefinition): ScopeType => {
  const required = new Set(inputs.filter((input) => input.required).map(({ name }) => name));
  return declaredObject(inputs, (name) => required.has(name));
};

const variablesType = ({ variables }: WorkflowDefinition): ScopeType =>
  declaredObject(variables, () => true);

/**
 * C115.3: the typed trigger object. A definition without a trigger has no such root. K8-12: a test
 * run's synthetic payload is checked against it.
 */
export function triggerType(definition: WorkflowDefinition): ScopeType | null {
  const { trigger } = definition;
  switch (trigger?.type) {
    case 'trigger-event':
    case 'trigger-verification':
      return eventsType(trigger.config.events);
    // C152.2: a flow's run_workflow passes its declared inputs alone, never the inquiry's data.
    case 'trigger-api':
    case 'trigger-flow':
      return inputsType(definition);
    case 'trigger-schedule':
      return SUBJECT_OF_A_SCHEDULE;
    case 'trigger-recurring':
    case 'trigger-direct':
      return objectViewType(trigger.config['object-type']);
    case 'trigger-account':
      return objectViewType('account');
    case 'trigger-case':
      return objectViewType('case');
    default:
      return null;
  }
}

const OUTPUT_TYPES = new WeakMap<AnyActionRegistryEntry, ScopeType>();

function registryOutput(entry: AnyActionRegistryEntry): ScopeType {
  const known = OUTPUT_TYPES.get(entry);
  if (known !== undefined) {
    return known;
  }
  const type = typeFromZod(entry.output);
  OUTPUT_TYPES.set(entry, type);
  return type;
}

/** The roots a template's references read at a node, and whether any carries PII. */
export function templateCarriesPii(raw: JsonValue, scope: ScopeType): boolean {
  const parsed = parseTemplate(raw);
  if (!parsed.ok) {
    return false;
  }
  return parsed.template.references.some(({ path }) => {
    const resolved = resolvePath(scope, path.segments);
    return resolved.ok && (resolved.pii || containsPii(resolved.type));
  });
}

/** Whether a value of `type` holds anything personal, at any depth. */
export function containsPii(type: ScopeType): boolean {
  if (type.pii) {
    return true;
  }
  if (type.kind === 'list') {
    return containsPii(type.of);
  }
  return (
    type.kind === 'object' &&
    (Object.values(type.members).some(containsPii) ||
      (type.rest !== null && containsPii(type.rest)))
  );
}

const replaceMember = (type: ScopeType, name: string, member: ScopeType): ScopeType =>
  type.kind === 'object' ? { ...type, members: { ...type.members, [name]: member } } : type;

const EVALUATE_VALUE: Readonly<Record<string, ScopeType>> = {
  boolean: scalarType('boolean'),
  number: scalarType('number'),
  string: scalarType('string'),
  object: ANY_TYPE,
  none: withMarks(ANY_TYPE, { nullable: true }),
};

/** C123.2: the value has the declared return type and the taint of its mapped properties. */
function evaluateCodeOutput(step: ActionStep, base: ScopeType, scope: ScopeType): ScopeType {
  const returnType = step.config['return-type'];
  const value = typeof returnType === 'string' ? EVALUATE_VALUE[returnType] : undefined;
  const pii = templateCarriesPii(step.config.properties ?? null, scope);
  return replaceMember(base, 'value', withMarks(value ?? ANY_TYPE, { pii }));
}

/** C127.10: `value` carries the taint of its operands, and reads null when the operation failed. */
function calculateOutput(step: ActionStep, base: ScopeType, scope: ScopeType): ScopeType {
  const pii = templateCarriesPii(step.config.operands ?? null, scope);
  const nullable = step.config.default === undefined;
  return replaceMember(base, 'value', scalarType('number', { pii, nullable }));
}

/** C124.1, C124.5: a body reads through its declared schema or not at all. */
function httpsOutput(step: ActionStep, base: ScopeType): ScopeType {
  const declared = step.config['response-schema'];
  const members = Array.isArray(declared) ? declared.filter(isJsonRecord) : [];
  if (members.length === 0) {
    return replaceMember(base, 'body', { kind: 'any', opaque: true, nullable: true, pii: true });
  }
  const items = members.flatMap(({ name, type, pii }) =>
    typeof name === 'string' && typeof type === 'string' ? [{ name, type, pii: pii === true }] : [],
  );
  return replaceMember(
    base,
    'body',
    withMarks(
      declaredObject(items, () => false),
      { nullable: true },
    ),
  );
}

function fetchOutput(step: ActionStep, base: ScopeType): ScopeType {
  const type = step.config['object-type'];
  return typeof type === 'string' ? replaceMember(base, 'object', objectViewType(type)) : base;
}

function actionOutput(step: ActionStep, scope: ScopeType, context: ScopeContext): ScopeType {
  const entry = context.registry.get(step['action-key'], step['action-version']);
  if (entry === undefined) {
    return withMarks(ANY_TYPE, { pii: true });
  }
  const base = registryOutput(entry);
  switch (step['action-key']) {
    case 'evaluate_code':
      return evaluateCodeOutput(step, base, scope);
    case 'calculate':
      return calculateOutput(step, base, scope);
    case 'make_https_request':
      return httpsOutput(step, base);
    case 'fetch_object':
      return fetchOutput(step, base);
    default:
      return base;
  }
}

function moduleOutput(
  step: Extract<WorkflowStep, { type: 'module' }>,
  scope: ScopeType,
  context: ScopeContext,
): ScopeType {
  const module = context.modules?.(step['module-workflow-id'], step.version);
  const tainted = templateCarriesPii(step.inputs, scope);
  const members: Record<string, ScopeType> = {};
  for (const { name, pii } of module?.outputs ?? []) {
    members[name] = withMarks(ANY_TYPE, { nullable: true, pii: pii || tainted });
  }
  return module === undefined ? withMarks(ANY_TYPE, { pii: true }) : objectType(members);
}

function nodeOutput(
  step: WorkflowStep | null,
  scope: ScopeType,
  context: ScopeContext,
): ScopeType | null {
  switch (step?.type) {
    case 'action':
      return actionOutput(step, scope, context);
    case 'wait':
      return step.mode === 'events' ? WAIT_EVENTS_OUTPUT : NO_OUTPUT;
    case 'conditional':
      return CONDITIONAL_OUTPUT;
    case 'loop':
      return LOOP_OUTPUT;
    case 'module':
      return moduleOutput(step, scope, context);
    default:
      return null;
  }
}

/** C114.6: a step that can follow `next` after failing reads nullable. */
const canContinue = (step: WorkflowStep | null, hasError: boolean): boolean =>
  step !== null && 'continue-on-error' in step && step['continue-on-error'] === true && !hasError;

type Available = ReadonlyMap<string, boolean>;

function intersect(states: readonly Available[]): Available {
  const [first, ...others] = states;
  const result = new Map<string, boolean>();
  for (const [id, nullable] of first ?? new Map<string, boolean>()) {
    if (others.every((state) => state.has(id))) {
      result.set(id, nullable || others.some((state) => state.get(id) === true));
    }
  }
  return result;
}

function unite(states: readonly Available[]): Available {
  const result = new Map<string, boolean>();
  for (const state of states) {
    for (const [id, nullable] of state) {
      result.set(id, nullable || result.get(id) === true);
    }
  }
  return result;
}

const rootsOf = (
  definition: WorkflowDefinition,
  context: ScopeContext,
): Record<string, ScopeType> => {
  const trigger = triggerType(definition);
  return {
    ...(trigger === null ? {} : { trigger }),
    inputs: inputsType(definition),
    vars: variablesType(definition),
    current_run: CURRENT_RUN,
    ...(context.currentCase === undefined ? {} : { current_case: context.currentCase }),
  };
};

function loopRoot(step: LoopStep, scope: ScopeType): ScopeType {
  const index = scalarType('integer');
  if (step.mode === 'while') {
    return objectType({ index });
  }
  const segments = parsePath(step.items)?.segments ?? [];
  const resolved = resolvePath(scope, segments);
  const list = resolved.ok ? resolved.type : ANY_TYPE;
  const item = list.kind === 'list' ? list.of : ANY_TYPE;
  const pii = resolved.ok && resolved.pii;
  return objectType({ item: withMarks(item, { pii }), index });
}

const portKey = (id: string, port: string): string => `${id}\u0000${port}`;

class ScopeWalk {
  readonly at = new Map<string, ScopeType>();
  readonly outputs = new Map<string, ScopeType>();
  readonly before = new Map<string, Available>();
  private readonly ports = new Map<string, Available>();
  private readonly loops = new Map<string, ScopeType>();
  private readonly roots: Record<string, ScopeType>;
  private readonly enclosure: ReadonlyMap<string, readonly Region[]>;

  constructor(
    private readonly graph: GraphIndex,
    private readonly context: ScopeContext,
  ) {
    this.roots = rootsOf(graph.definition, context);
    this.enclosure = enclosureOf(regionsOf(graph));
  }

  private incoming(id: string): Available {
    const edges = edgesTo(this.graph, id).filter(({ edge }) => !isBackEdge(edge));
    const states = edges.flatMap(
      ({ edge }) => this.ports.get(portKey(edge.from, edge['from-port'])) ?? [],
    );
    const isJoin = this.graph.nodes.get(id)?.step?.type === 'join';
    return isJoin ? unite(states) : intersect(states);
  }

  private scopeOf(id: string, available: Available): ScopeType {
    const steps: Record<string, ScopeType> = {};
    for (const [step, nullable] of available) {
      const output = this.outputs.get(step);
      if (output !== undefined) {
        steps[step] = objectType({ output: withMarks(output, { nullable }) });
      }
    }
    const regions = this.enclosure.get(id) ?? [];
    const loop = regions.filter(({ kind }) => kind === 'loop').at(-1);
    const root = loop === undefined ? undefined : this.loops.get(loop.id);
    return objectType({
      ...this.roots,
      steps: objectType(steps),
      ...(root === undefined ? {} : { loop: root }),
    });
  }

  private record(id: string, port: string, state: Available): void {
    this.ports.set(portKey(id, port), state);
  }

  private flow(id: string, step: WorkflowStep | null, available: Available): void {
    const edges = this.graph.outgoing.get(id) ?? [];
    const hasError = edges.some(({ edge }) => edge['from-port'] === ERROR);
    const after = new Map(available);
    if (this.outputs.has(id)) {
      after.set(id, canContinue(step, hasError));
    }
    for (const { edge } of edges) {
      const port = edge['from-port'];
      const failed = port === ERROR || (step?.type === 'loop' && port === BODY);
      this.record(id, port, failed ? available : after);
    }
    if (step?.type === 'loop') {
      this.record(id, DONE, after);
    }
  }

  private collect(
    step: Extract<WorkflowStep, { type: 'array-map-output' }>,
    scope: ScopeType,
  ): void {
    const parsed = parseTemplate(step.value);
    const [only] = parsed.ok ? parsed.template.references : [];
    const resolved =
      only === undefined || (typeof step.value === 'string' && !step.value.trim().startsWith('{{'))
        ? null
        : resolvePath(scope, only.path.segments);
    const value =
      resolved?.ok === true
        ? resolved.type
        : withMarks(ANY_TYPE, {
            pii: templateCarriesPii(step.value, scope),
          });
    this.outputs.set(
      step['map-of'],
      objectType({ iterations: scalarType('integer'), values: listType(value) }),
    );
  }

  walk(order: readonly string[]): void {
    for (const id of order) {
      const step = this.graph.nodes.get(id)?.step ?? null;
      const available = this.incoming(id);
      const scope = this.scopeOf(id, available);
      this.at.set(id, scope);
      this.before.set(id, available);
      const output = nodeOutput(step, scope, this.context);
      if (output !== null) {
        this.outputs.set(id, output);
      }
      if (step?.type === 'loop') {
        this.loops.set(id, loopRoot(step, scope));
      }
      if (step?.type === 'array-map-output') {
        this.collect(step, scope);
      }
      this.flow(id, step, available);
    }
  }
}

/** C115.3: the scope of every node, or `null` for a graph with a cycle, which the check refuses. */
export function buildNodeScopes(graph: GraphIndex, context: ScopeContext): NodeScopes | null {
  const order = forwardOrder(graph);
  if (order === null) {
    return null;
  }
  const walk = new ScopeWalk(graph, context);
  walk.walk(order);
  return { at: walk.at, outputs: walk.outputs, before: walk.before };
}
