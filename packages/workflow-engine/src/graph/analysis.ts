/**
 * Static analyses of a definition's paths (plan C128.2-C128.4). None of them decides anything a run
 * does: `solely-automated` is computed at run time from what happened. The wording here only chooses
 * what the editor says, and the biometric and heuristic reads are what publish asks a declaration or
 * an acknowledgement for. A path here is every path to a step, so a read on any of them counts, and
 * what cannot be known counts against the operator: an unbounded filter and an unknown template read
 * as biometric.
 *
 * Workflow 10B (`api-integrity`; C210.5, a Phase 8 publish-check amendment): an adverse step's path
 * may read a signal that is never decisive alone (`signalsNotDecisiveAlone`, the predicate Phase 9's
 * flow rules share): `nonDecisiveSignals` asks `heuristic:<step id>` whatever its tier, and
 * `undecidedSignals` names those read by a route (the routes after it and `else` included) from which
 * the step is reached with no `run_verification` and no route on its outcome in between, which
 * publish refuses.
 */
import type { WorkflowDefinition, WorkflowStep } from '@openverify/contracts';
import { eventSubject, isEventName } from '@openverify/contracts';
import type { ActionRegistry } from '../actions/registry.js';
import type { JsonValue } from '../expressions/json.js';
import { parseCondition, type Expression } from '../expressions/parse.js';
import { parsePath } from '../expressions/paths.js';
import {
  HUMAN_STEP_ENTRIES,
  createHumanStepTable,
  type HumanStepTable,
} from '../interpreter/human-steps.js';
import { parseTemplate } from '../templates/render.js';
import { parseConfigTemplates } from '../templates/sinks.js';
import { signalsNotDecisiveAlone } from '@openverify/core';
import {
  ELSE,
  ROUTE_PREFIX,
  edgesFrom,
  indexGraph,
  reachable,
  reaching,
  type ActionStep,
  type ConditionalStep,
  type GraphIndex,
} from './structure.js';

export const BIOMETRIC_REASONS = [
  'action-is-biometric',
  'trigger-admits-biometric',
  'trigger-unbounded',
  'reads-biometric-result',
  'reads-status-of-biometric-template',
  'reads-status-unbounded',
] as const;
export type BiometricReason = (typeof BIOMETRIC_REASONS)[number];

export interface PathAnalysisContext {
  readonly registry: ActionRegistry;
  readonly humanSteps?: HumanStepTable;
  /** C128.4: whether a template holds a biometric check or a face list; unknown fails closed. */
  readonly templateIsBiometric?: (templateId: string) => boolean | undefined;
}

export interface AdverseStepAnalysis {
  readonly stepId: string;
  readonly adverse: 'always' | 'by-config';
  /** C128.2: the editor's wording, and nothing else. */
  readonly personReviews: boolean;
  /** C128.4: needs `config.biometric-basis` in production. */
  readonly biometric: boolean;
  readonly biometricReasons: readonly BiometricReason[];
  /** C128.3: beta steps whose output the path reads: `heuristic:<step id>`. */
  readonly heuristicSteps: readonly string[];
  /**
   * C210.5 (Workflow 10B): the `decisive-alone: false` signals a path to the step reads (the
   * acknowledgement `heuristic:<step id>`, whatever their tier).
   */
  readonly nonDecisiveSignals: readonly string[];
  /**
   * C210.5: those of them read by a route from which the step is reached with no verification and
   * no route on its outcome in between: publish refuses the step (`signal_not_decisive_alone`).
   */
  readonly undecidedSignals: readonly string[];
  /** Every path read on the way to the step, and by the step. */
  readonly reads: readonly string[];
}

/** The rooted paths an expression reads; a list operator's body reads its element, not a root. */
function expressionPaths(expression: Expression, into: string[]): void {
  switch (expression.kind) {
    case 'var':
      into.push(expression.path.text);
      break;
    case 'missing':
      into.push(...expression.paths.map(({ text }) => text));
      break;
    case 'array':
      for (const item of expression.items) {
        expressionPaths(item, into);
      }
      break;
    case 'operation':
      for (const [index, arg] of expression.args.entries()) {
        if (index !== 1 || !BODIED.has(expression.operator)) {
          expressionPaths(arg, into);
        }
      }
      break;
    default:
      break;
  }
}

const BODIED: ReadonlySet<string> = new Set(['all', 'some', 'none', 'filter', 'map', 'reduce']);

function conditionPaths(raw: JsonValue | undefined): readonly string[] {
  const parsed = raw === undefined ? null : parseCondition(raw);
  const paths: string[] = [];
  if (parsed?.ok === true) {
    expressionPaths(parsed.expression, paths);
  }
  return paths;
}

function templatePaths(raw: JsonValue | undefined): readonly string[] {
  const parsed = raw === undefined ? null : parseTemplate(raw);
  return parsed?.ok === true
    ? parsed.template.references.flatMap(({ secret, path }) => (secret === null ? [path.text] : []))
    : [];
}

function stepReads(step: WorkflowStep): readonly string[] {
  switch (step.type) {
    case 'action':
      return parseConfigTemplates(step.config).references.flatMap(({ secret, path }) =>
        secret === null ? [path.text] : [],
      );
    case 'conditional':
      return step.routes.flatMap(({ condition }) => conditionPaths(condition));
    case 'loop':
      return step.mode === 'while' ? conditionPaths(step.condition) : [step.items];
    case 'wait':
      return step.mode === 'events' ? [step.subject, ...conditionPaths(step.filter)] : [];
    case 'module':
      return templatePaths(step.inputs);
    case 'output':
      return templatePaths(step.mappings);
    case 'array-map-output':
      return templatePaths(step.value);
    default:
      return [];
  }
}

const ancestorsOf = (graph: GraphIndex, stepId: string): readonly WorkflowStep[] => {
  const before = reaching(graph, [stepId]);
  return graph.definition.steps.filter(({ id }) => before.has(id));
};

const stepOfPath = (path: string): string | undefined => {
  const [root, id] = parsePath(path)?.segments ?? [];
  return root === 'steps' && typeof id === 'string' ? id : undefined;
};

const TEMPLATE_PATHS: ReadonlySet<string> = new Set([
  'trigger.template.id',
  'trigger.template.token',
  'trigger.inquiry-template.id',
  'trigger.inquiry_template.id',
]);

const literalTexts = (expression: Expression | undefined): readonly string[] | null => {
  if (expression?.kind === 'literal' && typeof expression.value === 'string') {
    return [expression.value];
  }
  if (expression?.kind === 'array') {
    const texts = expression.items.flatMap((item) =>
      item.kind === 'literal' && typeof item.value === 'string' ? [item.value] : [],
    );
    return texts.length === expression.items.length ? texts : null;
  }
  return null;
};

const readsTemplate = (expression: Expression | undefined): boolean =>
  expression?.kind === 'var' && TEMPLATE_PATHS.has(expression.path.text);

function boundBy(expression: Expression): readonly string[] | null {
  if (expression.kind !== 'operation') {
    return null;
  }
  const [left, right] = expression.args;
  switch (expression.operator) {
    case '===':
      if (readsTemplate(left)) {
        return literalTexts(right);
      }
      return readsTemplate(right) ? literalTexts(left) : null;
    case 'in':
      return readsTemplate(left) ? literalTexts(right) : null;
    case 'and':
      return narrowest(expression.args);
    default:
      return null;
  }
}

function narrowest(args: readonly Expression[]): readonly string[] | null {
  const bounds = args.flatMap((arg) => {
    const bound = boundBy(arg);
    return bound === null ? [] : [bound];
  });
  const [first, ...others] = bounds;
  return first === undefined
    ? null
    : others.reduce((left, right) => left.filter((id) => right.includes(id)), first);
}

/**
 * C128.4: the inquiry templates a condition holds a run to, or `null` when it does not bound them:
 * only what must be true for the condition to hold counts, so an `or` and a negation bound nothing.
 */
export function boundTemplateIds(condition: unknown): readonly string[] | null {
  const parsed = condition === undefined ? null : parseCondition(condition);
  return parsed?.ok === true ? boundBy(parsed.expression) : null;
}

/** C128.2: the conditionals whose routes read a step's output. */
export function conditionalsReading(
  definition: WorkflowDefinition,
  stepId: string,
): readonly string[] {
  return definition.steps.flatMap((step) =>
    step.type === 'conditional' && stepReads(step).some((path) => stepOfPath(path) === stepId)
      ? [step.id]
      : [],
  );
}

function personReviews(
  graph: GraphIndex,
  stepId: string,
  ancestors: readonly WorkflowStep[],
  table: HumanStepTable,
): boolean {
  const waits = ancestors.filter(
    (step) =>
      step.type === 'wait' &&
      step.mode === 'events' &&
      step.events.some((event) => table.entryFor(event) !== undefined),
  );
  const { start } = graph;
  if (waits.length === 0 || start === null) {
    return false;
  }
  const stop = new Set(waits.map(({ id }) => id));
  const conditionals = new Set(ancestors.map(({ id }) => id));
  return (
    !reachable(graph, [start], stop).has(stepId) &&
    waits.some(({ id }) =>
      conditionalsReading(graph.definition, id).some((reader) => conditionals.has(reader)),
    )
  );
}

const BIOMETRIC_PATH = /^trigger\.(?:verification_selfie|selfies?)(?:[.[]|$)/;
const VERIFICATION_STATUS = /^trigger\.verification_\w+\.(?:status|checks)(?:[.[]|$)/;
const TRIGGER_STATUS = /^trigger\.(?:status|checks)(?:[.[]|$)/;
const OUTPUT_STATUS = /^steps\.\w+\.output\.(?:object\.)?(?:status|checks)(?:[.[]|$)/;

const BIOMETRIC_SUBJECTS: ReadonlySet<string> = new Set(['inquiry', 'verification', 'list-match']);
const STATUS_SUBJECTS: ReadonlySet<string> = new Set(['inquiry', 'verification']);

/** The event subjects a trigger listens to. */
function triggerSubjects({ trigger }: WorkflowDefinition): readonly string[] {
  if (trigger?.type === 'trigger-event' || trigger?.type === 'trigger-verification') {
    return trigger.config.events.flatMap((name) => (isEventName(name) ? [eventSubject(name)] : []));
  }
  return [];
}

const criteriaOf = ({ trigger }: WorkflowDefinition): unknown =>
  trigger?.type === 'trigger-event' || trigger?.type === 'trigger-verification'
    ? trigger.config.criteria
    : undefined;

const OBJECT_STATUS_ACTIONS: ReadonlySet<string> = new Set(['fetch_object', 'run_verification']);

function readsStatus(
  graph: GraphIndex,
  reads: readonly string[],
  subjects: readonly string[],
): boolean {
  const triggerStatus = subjects.some((subject) => STATUS_SUBJECTS.has(subject));
  return reads.some((path) => {
    if (VERIFICATION_STATUS.test(path) || (triggerStatus && TRIGGER_STATUS.test(path))) {
      return true;
    }
    const step = graph.nodes.get(stepOfPath(path) ?? '')?.step;
    return (
      OUTPUT_STATUS.test(path) &&
      step?.type === 'action' &&
      OBJECT_STATUS_ACTIONS.has(step['action-key'])
    );
  });
}

const routeBound = (ancestors: readonly WorkflowStep[]): readonly string[] | null => {
  for (const step of ancestors) {
    if (step.type === 'conditional') {
      for (const { condition } of step.routes) {
        const bound = boundTemplateIds(condition);
        if (bound !== null) {
          return bound;
        }
      }
    }
  }
  return null;
};

class BiometricRule {
  private readonly isBiometric: (id: string) => boolean;

  constructor(
    private readonly graph: GraphIndex,
    private readonly registry: ActionRegistry,
    context: PathAnalysisContext,
  ) {
    this.isBiometric = (id) => context.templateIsBiometric?.(id) !== false;
  }

  private readsBiometricResult(reads: readonly string[]): boolean {
    return reads.some((path) => {
      if (BIOMETRIC_PATH.test(path)) {
        return true;
      }
      const step = this.graph.nodes.get(stepOfPath(path) ?? '')?.step;
      return step?.type === 'action' && this.entryOf(step)?.biometric === true;
    });
  }

  private entryOf(step: ActionStep) {
    return this.registry.get(step['action-key'], step['action-version']);
  }

  reasons(
    step: ActionStep,
    ancestors: readonly WorkflowStep[],
    reads: readonly string[],
  ): readonly BiometricReason[] {
    const { definition } = this.graph;
    const found = new Set<BiometricReason>();
    if (this.entryOf(step)?.biometric === true) {
      return ['action-is-biometric'];
    }
    const subjects = triggerSubjects(definition);
    const bound = boundTemplateIds(criteriaOf(definition));
    if (subjects.some((subject) => BIOMETRIC_SUBJECTS.has(subject))) {
      if (bound === null) {
        found.add('trigger-unbounded');
      } else if (bound.some(this.isBiometric)) {
        found.add('trigger-admits-biometric');
      }
    }
    if (this.readsBiometricResult(reads)) {
      found.add('reads-biometric-result');
    }
    if (readsStatus(this.graph, reads, subjects)) {
      const templates = bound ?? routeBound(ancestors);
      if (templates === null) {
        found.add('reads-status-unbounded');
      } else if (templates.some(this.isBiometric)) {
        found.add('reads-status-of-biometric-template');
      }
    }
    return [...found];
  }
}

function heuristicSteps(
  graph: GraphIndex,
  reads: readonly string[],
  registry: ActionRegistry,
): readonly string[] {
  const steps = new Set(reads.flatMap((path) => stepOfPath(path) ?? []));
  return [...steps].filter((id) => {
    const step = graph.nodes.get(id)?.step;
    return (
      step?.type === 'action' &&
      registry.get(step['action-key'], step['action-version'])?.stage === 'beta'
    );
  });
}

/** A signal a path reads: `trigger.signals.<member>`, or a fetched object's `signals.<member>`. */
const SIGNAL_MEMBER = /(?:^|\.)signals\.([a-z][a-z0-9_]*)(?:[.[]|$)/;

/** C210.5: the `decisive-alone: false` signals among `paths`, each once. */
function notDecisiveSignalsOf(paths: readonly string[]): string[] {
  const names = paths.flatMap((path) => {
    const member = SIGNAL_MEMBER.exec(path)?.[1];
    return member === undefined ? [] : [`inquiry/${member}`];
  });
  return signalsNotDecisiveAlone(new Set(names));
}

/** The `run_verification` steps whose outcome (`status`) a condition reads. */
const VERIFICATION_OUTCOME = /^steps\.(\w+)\.output\.(?:object\.)?status(?:[.[]|$)/;

const outcomeStepsOf = (graph: GraphIndex, condition: JsonValue | undefined): string[] =>
  conditionPaths(condition).flatMap((path) => {
    const id = VERIFICATION_OUTCOME.exec(path)?.[1];
    const step = id === undefined ? undefined : graph.nodes.get(id)?.step;
    return step?.type === 'action' && step['action-key'] === 'run_verification' && id !== undefined
      ? [id]
      : [];
  });

/** The ports a conditional takes only when route `index` did not decide otherwise. */
function dependentPorts(step: ConditionalStep, index: number): Set<string> {
  const ports = new Set<string>([ELSE]);
  step.routes.forEach((route, at) => {
    if (at >= index) ports.add(`${ROUTE_PREFIX}${route.key}`);
  });
  const onNull = step.routes[index]?.['on-null'];
  if (onNull?.startsWith(ROUTE_PREFIX) === true) ports.add(onNull);
  return ports;
}

/**
 * C210.5: whether `target` is reached from `conditional`'s route `index` along a path that passes no
 * `run_verification` followed by a route reading its outcome.
 */
function reachedUndecided(
  graph: GraphIndex,
  conditional: ConditionalStep,
  index: number,
  target: string,
): boolean {
  const ports = dependentPorts(conditional, index);
  const seen = new Set<string>();
  const stack = edgesFrom(graph, conditional.id)
    .filter(({ edge }) => ports.has(edge['from-port']))
    .map(({ edge }) => ({ id: edge.to, verified: [] as string[] }));
  for (let at = stack.pop(); at !== undefined; at = stack.pop()) {
    const key = `${at.id}|${[...at.verified].sort().join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (at.id === target) return true;
    const step = graph.nodes.get(at.id)?.step;
    const verified =
      step?.type === 'action' && step['action-key'] === 'run_verification'
        ? [...new Set([...at.verified, step.id])]
        : at.verified;
    let edges = edgesFrom(graph, at.id);
    if (step?.type === 'conditional') {
      const gate = step.routes.findIndex((route) =>
        outcomeStepsOf(graph, route.condition).some((id) => verified.includes(id)),
      );
      if (gate !== -1) {
        const held = dependentPorts(step, gate);
        edges = edges.filter(({ edge }) => !held.has(edge['from-port']));
      }
    }
    for (const { edge } of edges) stack.push({ id: edge.to, verified });
  }
  return false;
}

/** C210.5: the signals of `ancestors`' routes that reach `stepId` undecided. */
function undecidedSignals(
  graph: GraphIndex,
  ancestors: readonly WorkflowStep[],
  stepId: string,
): string[] {
  const found = new Set<string>();
  for (const step of ancestors) {
    if (step.type !== 'conditional') continue;
    step.routes.forEach((route, index) => {
      const signals = notDecisiveSignalsOf(conditionPaths(route.condition));
      if (signals.length > 0 && reachedUndecided(graph, step, index, stepId)) {
        for (const signal of signals) found.add(signal);
      }
    });
  }
  return signalsNotDecisiveAlone(found);
}

/** C128.2-C128.4: what publish and the editor read about each adverse step. */
export function analyzeAdverseSteps(
  definition: WorkflowDefinition,
  context: PathAnalysisContext,
): readonly AdverseStepAnalysis[] {
  const graph = indexGraph(definition);
  const table = context.humanSteps ?? createHumanStepTable(HUMAN_STEP_ENTRIES);
  const biometric = new BiometricRule(graph, context.registry, context);
  return definition.steps.flatMap((step) => {
    if (step.type !== 'action') {
      return [];
    }
    const entry = context.registry.get(step['action-key'], step['action-version']);
    if (entry === undefined || entry.adverse === 'never') {
      return [];
    }
    const ancestors = ancestorsOf(graph, step.id);
    const reads = [...new Set(ancestors.flatMap(stepReads))].sort();
    const biometricReasons = biometric.reasons(step, ancestors, reads);
    return [
      {
        stepId: step.id,
        adverse: entry.adverse,
        personReviews: personReviews(graph, step.id, ancestors, table),
        biometric: biometricReasons.length > 0,
        biometricReasons,
        heuristicSteps: heuristicSteps(graph, reads, context.registry),
        nonDecisiveSignals: notDecisiveSignalsOf(reads),
        undecidedSignals: undecidedSignals(graph, ancestors, step.id),
        reads,
      },
    ];
  });
}
