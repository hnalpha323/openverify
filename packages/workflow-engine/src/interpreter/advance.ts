/**
 * The pure interpreter (plan C117.1): `advance(definition, runState, completedStep)` answers the next
 * state and the steps to make ready. It touches no clock, no database and no queue, so it can be
 * replayed in a test or a future simulation, though recovery never depends on replay: a run's rows
 * are its record.
 *
 * Control-flow nodes (conditional, parallel fork and join, loop counters, Update Variable, Calculate,
 * output) run inside the advance that reached them, because nothing external happens (C117.3); they
 * come back in `executed`, for their step rows and the journal. Every other node comes back in
 * `stepsToMakeReady`, and its completion is the next call.
 *
 * Failures follow C119.7: the step's `error` edge, then its `continue-on-error`, else the enclosing
 * parallel or loop, which waits for what is still running (every branch must finish, C119.4) and then
 * fails in turn, up to the run. A failure nothing absorbed stays in `failures`, so a resume re-readies
 * exactly those steps (C120.3).
 *
 * The executor runs one advance at a time per run, holding the run row, because Update Variable and
 * the counters are read-modify-write. The join counter of C119.4 is `joins[key].open`.
 */
import type { WorkflowDefinition, WorkflowStep } from '@openverify/contracts';
import type { EvaluationScope } from '../expressions/evaluate.js';
import type { JsonRecord, JsonValue } from '../expressions/json.js';
import { parseCondition } from '../expressions/parse.js';
import { parsePath, readSegments } from '../expressions/paths.js';
import { decideRoutes, decideWhile, type ParsedRoute } from '../expressions/positions.js';
import {
  BODY,
  DONE,
  ELSE,
  ERROR,
  NEXT,
  ROUTE_PREFIX,
  BRANCH_PREFIX,
  edgeOn,
  enclosureOf,
  indexGraph,
  isBackEdge,
  regionsOf,
  type ActionStep,
  type ConditionalStep,
  type GraphIndex,
  type LoopStep,
  type ParallelRegion,
  type Region,
  type WaitStep,
} from '../graph/structure.js';
import { WORKFLOW_RUN_LIMITS, type EngineErrorCode } from '../limits/index.js';
import { parseTemplate, renderTemplate, type RenderScope } from '../templates/render.js';
import { checkValue, parseTypeDsl } from '../variables/types.js';
import type {
  AdvanceResult,
  ExecutedStep,
  JoinState,
  LoopState,
  ReadyStep,
  RunState,
  StepCompletion,
  StepFailure,
} from './state.js';

export interface AdvanceContext {
  /** C119.8: each started module's pinned definition, by its iteration path. */
  readonly modules?: Readonly<Record<string, WorkflowDefinition>>;
  /** C120.7: a test run's `end-step`. */
  readonly endStep?: string;
}

export interface RunSeed {
  /** C140.2: Workflow 8B's flattened case; an inert `null` until then. */
  readonly currentCase?: JsonValue;
  readonly trigger: JsonValue;
  readonly inputs: JsonRecord;
  readonly currentRun: JsonRecord;
  /** The database's clock, as the executor read it. */
  readonly now: string;
  /** C120.7: a test run's `start-step`. */
  readonly startStep?: string;
}

/** C117.2: a step's row key, the iteration path before the node. */
export function stepKey(iterationPath: string, nodeId: string): string {
  return `${iterationPath}${nodeId}`;
}

/** C117.5: independent of the attempt. */
export function effectKey(runId: string, nodeId: string, iterationPath: string): string {
  return `${runId}/${nodeId}/${iterationPath}`;
}

const SEGMENT = '/';
const MODULE_PREFIX = 'module:';
const LOOP_LIMIT = WORKFLOW_RUN_LIMITS['loop-items'].value;
const STEP_LIMIT = WORKFLOW_RUN_LIMITS['step-executions'].value;
const VARIABLES_LIMIT = WORKFLOW_RUN_LIMITS['variables-bytes'].value;

const CONTROL_ACTIONS: ReadonlySet<string> = new Set(['calculate', 'update_variable']);

const segmentsOf = (path: string): readonly string[] =>
  path.split(SEGMENT).filter((segment) => segment !== '');

const parentOf = (path: string): string => {
  const segments = segmentsOf(path).slice(0, -1);
  return segments.length === 0 ? '' : `${segments.join(SEGMENT)}${SEGMENT}`;
};

const lastSegment = (path: string): string => segmentsOf(path).at(-1) ?? '';

const prefixes = (path: string): readonly string[] => {
  const found = [''];
  let prefix = '';
  for (const segment of segmentsOf(path)) {
    prefix += `${segment}${SEGMENT}`;
    found.push(prefix);
  }
  return found;
};

/** The iteration path of the module a path is inside, or `null`. */
function modulePathOf(path: string): string | null {
  const found = prefixes(path).filter((prefix) => lastSegment(prefix).startsWith(MODULE_PREFIX));
  return found.at(-1) ?? null;
}

const iterationIndex = (path: string): number => {
  const segment = lastSegment(path);
  return Number(segment.slice(segment.indexOf('[') + 1, -1));
};

interface GraphFacts {
  readonly graph: GraphIndex;
  readonly enclosure: ReadonlyMap<string, readonly Region[]>;
}

const FACTS = new WeakMap<WorkflowDefinition, GraphFacts>();

function factsOf(definition: WorkflowDefinition): GraphFacts {
  const known = FACTS.get(definition);
  if (known !== undefined) {
    return known;
  }
  const graph = indexGraph(definition);
  const facts = { graph, enclosure: enclosureOf(regionsOf(graph)) };
  FACTS.set(definition, facts);
  return facts;
}

function visibleOutputs(state: RunState, iterationPath: string): JsonRecord {
  const modulePath = modulePathOf(iterationPath);
  const visible: Record<string, JsonValue> = {};
  for (const prefix of prefixes(iterationPath)) {
    if (modulePath === null || prefix.startsWith(modulePath)) {
      for (const [nodeId, output] of Object.entries(state.outputs[prefix] ?? {})) {
        visible[nodeId] = { output };
      }
    }
  }
  return visible;
}

function loopRoot(state: RunState, iterationPath: string): JsonRecord | undefined {
  const modulePath = modulePathOf(iterationPath) ?? '';
  const inner = prefixes(iterationPath)
    .filter((prefix) => prefix.endsWith(`]${SEGMENT}`) && prefix.startsWith(modulePath))
    .at(-1);
  if (inner === undefined) {
    return undefined;
  }
  const segment = lastSegment(inner);
  const loop = state.loops[stepKey(parentOf(inner), segment.slice(0, segment.indexOf('[')))];
  const index = iterationIndex(inner);
  return { item: loop?.items?.[index] ?? null, index };
}

/**
 * C114.4: the roots a path reads at an iteration path, for this file and for the executor, which
 * renders an action's config and a wait's filter with them. Inside a module the parent is out of
 * reach: a module reads only its inputs (C119.8).
 */
export function runScope(state: RunState, iterationPath: string): EvaluationScope {
  const modulePath = modulePathOf(iterationPath);
  const loop = loopRoot(state, iterationPath);
  const steps = visibleOutputs(state, iterationPath);
  const shared = {
    steps,
    current_run: state.currentRun,
    ...(loop === undefined ? {} : { loop }),
  };
  if (modulePath !== null) {
    const frame = state.modules[modulePath];
    return { roots: { ...shared, inputs: frame?.inputs ?? {}, vars: {} }, now: state.now };
  }
  return {
    roots: {
      ...shared,
      trigger: state.trigger,
      inputs: state.inputs,
      vars: state.variables,
      current_case: state.currentCase,
    },
    now: state.now,
  };
}

interface Frame {
  readonly facts: GraphFacts;
  /** The iteration path nodes of this frame run at. */
  readonly path: string;
}

const utf8Bytes = (value: JsonValue): number => Buffer.byteLength(JSON.stringify(value), 'utf8');

const textOf = (value: JsonValue | undefined): string => (typeof value === 'string' ? value : '');

/** A render's failure, a class of its own so no rendered value can read as one. */
class Failed {
  constructor(readonly failed: EngineErrorCode) {}
}

const isFailed = (value: unknown): value is Failed => value instanceof Failed;

/** What Calculate answers when an operation has no result (H21). */
class CalculateFailure extends Error {
  override readonly name = 'CalculateFailure';

  constructor(readonly reason: string) {
    super(reason);
  }
}

function calculateOperand(value: JsonValue): number {
  if (value === null) {
    throw new CalculateFailure('operand_null');
  }
  if (typeof value !== 'number') {
    throw new CalculateFailure('operand_not_a_number');
  }
  return value;
}

function calculate(operator: string, operands: readonly JsonValue[]): number {
  const numbers = operands.flatMap((value) => (Array.isArray(value) ? value : [value]));
  const values = numbers.map(calculateOperand);
  const [first] = values;
  if (first === undefined) {
    throw new CalculateFailure('no_operands');
  }
  const rest = values.slice(1);
  const total = values.reduce((left, right) => left + right, 0);
  const result = ((): number => {
    switch (operator) {
      case 'subtract':
        return rest.reduce((left, right) => left - right, first);
      case 'multiply':
        return rest.reduce((left, right) => left * right, first);
      case 'divide':
        if (rest.includes(0)) {
          throw new CalculateFailure('divide_by_zero');
        }
        return rest.reduce((left, right) => left / right, first);
      case 'avg':
        return total / values.length;
      default:
        return total;
    }
  })();
  if (!Number.isFinite(result)) {
    throw new CalculateFailure('not_finite');
  }
  return result + 0;
}

function declaredTypeOf(definition: WorkflowDefinition, name: string) {
  const declared = definition.variables.find((variable) => variable.name === name);
  const parsed = declared === undefined ? null : parseTypeDsl(declared.type);
  return parsed?.ok === true ? parsed.type : null;
}

/** One advance: a mutable draft of the state, walked through a work list, never recursively. */
class Walk {
  private state: RunState;
  private readonly work: (() => void)[] = [];
  private readonly ready: ReadyStep[] = [];
  private readonly executed: ExecutedStep[] = [];
  private halted = false;

  constructor(
    private readonly definition: WorkflowDefinition,
    state: RunState,
    private readonly context: AdvanceContext,
  ) {
    this.state = state;
  }

  private update(changes: Partial<RunState>): void {
    this.state = { ...this.state, ...changes };
  }

  /** The graph a path's nodes belong to, or `null` for a module with no pinned definition. */
  private frameAt(path: string): Frame | null {
    const modulePath = modulePathOf(path);
    if (modulePath === null) {
      return { facts: factsOf(this.definition), path };
    }
    const module = this.context.modules?.[modulePath];
    return module === undefined ? null : { facts: factsOf(module), path };
  }

  private haltRun(failure: StepFailure): void {
    this.halted = true;
    this.update({ status: 'errored', failures: [...this.state.failures, failure] });
  }

  private store(path: string, nodeId: string, output: JsonValue): void {
    this.update({
      outputs: {
        ...this.state.outputs,
        [path]: { ...this.state.outputs[path], [nodeId]: output },
      },
    });
  }

  private succeed(frame: Frame, nodeId: string, output: JsonValue): void {
    this.store(frame.path, nodeId, output);
    this.executed.push({
      nodeId,
      iterationPath: frame.path,
      status: 'succeeded',
      output,
      code: null,
    });
  }

  private enter(frame: Frame, nodeId: string): void {
    this.work.push(() => {
      this.visit(frame, nodeId);
    });
  }

  /** The one way along an edge: into a node, to a loop's next iteration, or to a join. */
  private follow(frame: Frame, nodeId: string, port: string): void {
    if (frame.path === '' && nodeId === this.context.endStep) {
      this.update({ status: 'completed' });
      this.halted = true;
      return;
    }
    const edge = edgeOn(frame.facts.graph, nodeId, port);
    if (edge === undefined) {
      this.haltRun({ nodeId, iterationPath: frame.path, code: 'execution_error' });
      return;
    }
    if (isBackEdge(edge)) {
      this.endIteration(frame);
      return;
    }
    const target = frame.facts.graph.nodes.get(edge.to)?.step;
    if (target?.type === 'join') {
      this.arrive(frame, target.id, target['join-of']);
      return;
    }
    this.enter(frame, edge.to);
  }

  private countStep(): boolean {
    const stepExecutions = this.state.stepExecutions + 1;
    this.update({ stepExecutions });
    if (stepExecutions > STEP_LIMIT) {
      this.haltRun({ nodeId: null, iterationPath: '', code: 'step_limit_exceeded' });
      return false;
    }
    return true;
  }

  private visit(frame: Frame, nodeId: string): void {
    const node = frame.facts.graph.nodes.get(nodeId);
    if (node === undefined) {
      this.haltRun({ nodeId, iterationPath: frame.path, code: 'execution_error' });
      return;
    }
    if (node.step === null) {
      this.follow(frame, nodeId, NEXT);
    } else if (this.countStep()) {
      this.visitStep(frame, node.step);
    }
  }

  private visitStep(frame: Frame, step: WorkflowStep): void {
    switch (step.type) {
      case 'action':
        this.visitAction(frame, step);
        break;
      case 'wait':
        this.visitWait(frame, step);
        break;
      case 'conditional':
        this.visitConditional(frame, step);
        break;
      case 'parallel':
        this.fork(frame, step);
        break;
      case 'loop':
        this.startLoop(frame, step);
        break;
      case 'module':
        this.ready.push({
          kind: 'module',
          nodeId: step.id,
          iterationPath: frame.path,
          moduleWorkflowId: step['module-workflow-id'],
          version: step.version,
        });
        break;
      case 'output':
        this.visitOutput(frame, step);
        break;
      case 'array-map-output':
        this.collect(frame, step);
        break;
      case 'module-input':
        this.succeed(frame, step.id, null);
        this.follow(frame, step.id, NEXT);
        break;
      default:
        this.fail(frame, step.id, 'execution_error');
    }
  }

  private renderScope(path: string): RenderScope {
    return { roots: runScope(this.state, path).roots };
  }

  /** A value template rendered for the interpreter's own use, or the step's error. */
  private render(raw: JsonValue, path: string): JsonValue | Failed {
    const parsed = parseTemplate(raw);
    if (!parsed.ok) {
      return new Failed('execution_error');
    }
    const rendered = renderTemplate(parsed.template, this.renderScope(path), 'json');
    return rendered.ok ? rendered.value : new Failed(rendered.code);
  }

  private visitAction(frame: Frame, step: ActionStep): void {
    if (!CONTROL_ACTIONS.has(step['action-key'])) {
      this.ready.push({
        kind: 'action',
        nodeId: step.id,
        iterationPath: frame.path,
        actionKey: step['action-key'],
        actionVersion: step['action-version'],
      });
    } else if (step['action-key'] === 'calculate') {
      this.runCalculate(frame, step);
    } else {
      this.runUpdateVariable(frame, step);
    }
  }

  private runCalculate(frame: Frame, step: ActionStep): void {
    const { operands, operator, default: fallback } = step.config;
    const rendered = this.render(operands ?? [], frame.path);
    if (isFailed(rendered)) {
      this.fail(frame, step.id, rendered.failed);
      return;
    }
    try {
      const value = calculate(textOf(operator), Array.isArray(rendered) ? rendered : [rendered]);
      this.succeed(frame, step.id, { value, defaulted: false, 'default-reason': null });
    } catch (error) {
      if (!(error instanceof CalculateFailure)) {
        throw error;
      }
      if (typeof fallback !== 'number') {
        this.fail(frame, step.id, 'expression_arithmetic_error');
        return;
      }
      this.succeed(frame, step.id, {
        value: fallback,
        defaulted: true,
        'default-reason': error.reason,
      });
    }
    this.follow(frame, step.id, NEXT);
  }

  private nextVariable(
    name: string,
    operator: string,
    value: JsonValue,
  ): JsonValue | undefined | Failed {
    const held = Object.hasOwn(this.state.variables, name) ? this.state.variables[name] : undefined;
    if (operator === 'set') {
      return value;
    }
    if (operator === 'unset') {
      return undefined;
    }
    if (held !== undefined && !Array.isArray(held)) {
      return new Failed('variable_type_mismatch');
    }
    const list = held ?? [];
    return operator === 'push' ? [...list, value] : list.filter((item) => item !== value);
  }

  private runUpdateVariable(frame: Frame, step: ActionStep): void {
    const name = textOf(step.config.name);
    const operator = textOf(step.config.operator);
    const rendered = this.render(step.config.value ?? null, frame.path);
    if (isFailed(rendered)) {
      this.fail(frame, step.id, rendered.failed);
      return;
    }
    const next = this.nextVariable(name, operator, rendered);
    if (isFailed(next)) {
      this.fail(frame, step.id, next.failed);
      return;
    }
    const type = declaredTypeOf(this.definition, name);
    if (next !== undefined && type !== null && checkValue(type, next).length > 0) {
      this.fail(frame, step.id, 'variable_type_mismatch');
      return;
    }
    const variables = Object.fromEntries(
      Object.entries(this.state.variables).filter(([member]) => member !== name),
    );
    if (next !== undefined) {
      variables[name] = next;
    }
    if (utf8Bytes(variables) > VARIABLES_LIMIT) {
      this.fail(frame, step.id, 'payload_too_large');
      return;
    }
    this.update({ variables });
    this.succeed(frame, step.id, { name, operator, held: next !== undefined });
    this.follow(frame, step.id, NEXT);
  }

  private visitWait(frame: Frame, step: WaitStep): void {
    if (step.mode === 'time') {
      this.ready.push({
        kind: 'wait-time',
        nodeId: step.id,
        iterationPath: frame.path,
        seconds: step.seconds,
      });
      return;
    }
    const path = parsePath(step.subject);
    const subject = readSegments(
      this.renderScope(frame.path).roots as JsonValue,
      path?.segments ?? [],
    );
    if (typeof subject !== 'string') {
      this.fail(frame, step.id, 'template_variable_missing');
      return;
    }
    this.ready.push({
      kind: 'wait-events',
      nodeId: step.id,
      iterationPath: frame.path,
      correlationKey: subject,
      events: step.events,
      timeoutSeconds: step['timeout-seconds'],
    });
  }

  private parsedRoutes(step: ConditionalStep): readonly ParsedRoute[] | null {
    const routes: ParsedRoute[] = [];
    for (const { key, condition, 'on-null': onNull } of step.routes) {
      const parsed = condition === undefined ? null : parseCondition(condition);
      if (parsed?.ok === false) {
        return null;
      }
      routes.push({ key, condition: parsed?.expression ?? null, onNull: onNull ?? null });
    }
    return routes;
  }

  private takeRoute(frame: Frame, step: ConditionalStep, route: string): void {
    this.succeed(frame, step.id, { route });
    this.follow(frame, step.id, route === ELSE ? ELSE : `${ROUTE_PREFIX}${route}`);
  }

  private visitConditional(frame: Frame, step: ConditionalStep): void {
    const routes = this.parsedRoutes(step);
    if (routes === null) {
      this.fail(frame, step.id, 'execution_error');
      return;
    }
    const decision = decideRoutes(routes, runScope(this.state, frame.path));
    if (decision.kind === 'route') {
      this.takeRoute(frame, step, decision.key);
    } else if (decision.kind === 'else') {
      this.takeRoute(frame, step, ELSE);
    } else if (step['continue-on-error'] === true) {
      this.takeRoute(frame, step, ELSE);
    } else {
      this.fail(frame, step.id, decision.code);
    }
  }

  private joinKey(frame: Frame, joinId: string): string {
    return stepKey(frame.path, joinId);
  }

  private fork(frame: Frame, step: Extract<WorkflowStep, { type: 'parallel' }>): void {
    const join = frame.facts.graph.definition.steps.find(
      (candidate) => candidate.type === 'join' && candidate['join-of'] === step.id,
    );
    if (join === undefined) {
      this.fail(frame, step.id, 'execution_error');
      return;
    }
    this.update({
      joins: {
        ...this.state.joins,
        [this.joinKey(frame, join.id)]: { open: step.branches.length, failed: 0 },
      },
    });
    this.succeed(frame, step.id, null);
    for (const { key } of step.branches) {
      this.follow(frame, step.id, `${BRANCH_PREFIX}${key}`);
    }
  }

  private setJoin(key: string, join: JoinState): void {
    this.update({ joins: { ...this.state.joins, [key]: join } });
  }

  /** C119.4: one branch reached its join; the last one decides. */
  private arrive(frame: Frame, joinId: string, parallelId: string): void {
    const key = this.joinKey(frame, joinId);
    const join = this.state.joins[key];
    if (join === undefined) {
      this.haltRun({ nodeId: joinId, iterationPath: frame.path, code: 'execution_error' });
      return;
    }
    const open = join.open - 1;
    this.setJoin(key, { ...join, open });
    if (open === 0) {
      this.settleJoin(frame, joinId, parallelId, join.failed);
    }
  }

  private settleJoin(frame: Frame, joinId: string, parallelId: string, failed: number): void {
    if (failed > 0) {
      this.bubble(frame, parallelId);
      return;
    }
    if (this.countStep()) {
      this.succeed(frame, joinId, null);
      this.follow(frame, joinId, NEXT);
    }
  }

  private loopKey(frame: Frame, loopId: string): string {
    return stepKey(frame.path, loopId);
  }

  private setLoop(key: string, loop: LoopState): void {
    this.update({ loops: { ...this.state.loops, [key]: loop } });
  }

  private readItems(frame: Frame, step: LoopStep): readonly JsonValue[] | null {
    if (step.mode === 'while') {
      return [];
    }
    const path = parsePath(step.items);
    const items = readSegments(
      this.renderScope(frame.path).roots as JsonValue,
      path?.segments ?? [],
    );
    if (items === undefined || items === null) {
      this.fail(frame, step.id, 'condition_input_null');
      return null;
    }
    if (!Array.isArray(items)) {
      this.fail(frame, step.id, 'loop_items_invalid');
      return null;
    }
    if (items.length > LOOP_LIMIT) {
      this.fail(frame, step.id, 'loop_limit_exceeded');
      return null;
    }
    return items;
  }

  private startLoop(frame: Frame, step: LoopStep): void {
    const items = this.readItems(frame, step);
    if (items !== null) {
      this.setLoop(this.loopKey(frame, step.id), {
        items: step.mode === 'while' ? null : items,
        next: 0,
        open: 0,
        failed: 0,
        iterations: 0,
        values: {},
      });
      this.pump(frame, step);
    }
  }

  private startIteration(frame: Frame, step: LoopStep, loop: LoopState): void {
    const key = this.loopKey(frame, step.id);
    this.setLoop(key, { ...loop, next: loop.next + 1, open: loop.open + 1 });
    const iteration: Frame = {
      facts: frame.facts,
      path: `${frame.path}${step.id}[${String(loop.next)}]${SEGMENT}`,
    };
    const edge = edgeOn(frame.facts.graph, step.id, BODY);
    if (edge === undefined) {
      this.haltRun({ nodeId: step.id, iterationPath: frame.path, code: 'execution_error' });
    } else {
      this.enter(iteration, edge.to);
    }
  }

  private finishLoop(frame: Frame, step: LoopStep, loop: LoopState): void {
    const iterations = { iterations: loop.iterations };
    const values = Array.from(
      { length: loop.iterations },
      (_item, index) => loop.values[String(index)] ?? null,
    );
    this.succeed(frame, step.id, step.mode === 'map' ? { ...iterations, values } : iterations);
    this.follow(frame, step.id, DONE);
  }

  private whileHolds(frame: Frame, step: Extract<LoopStep, { mode: 'while' }>): boolean | null {
    const parsed = parseCondition(step.condition);
    if (!parsed.ok) {
      this.fail(frame, step.id, 'execution_error');
      return null;
    }
    const loop = this.state.loops[this.loopKey(frame, step.id)];
    const scope = runScope(this.state, frame.path);
    const decision = decideWhile(parsed.expression, step['on-null'] ?? null, {
      ...scope,
      roots: { ...scope.roots, loop: { index: loop?.next ?? 0 } },
    });
    if (decision.kind === 'error') {
      this.fail(frame, step.id, decision.code);
      return null;
    }
    return decision.kind === 'continue';
  }

  /** What a loop does next: start iterations, finish, or fail once what is open has finished. */
  private pump(frame: Frame, step: LoopStep): void {
    const key = this.loopKey(frame, step.id);
    const loop = this.state.loops[key];
    if (loop === undefined) {
      this.haltRun({ nodeId: step.id, iterationPath: frame.path, code: 'execution_error' });
    } else if (loop.failed > 0) {
      if (loop.open === 0) {
        this.bubbleLoop(frame, step);
      }
    } else if (step.mode === 'while') {
      this.pumpWhile(frame, step, loop);
    } else {
      this.pumpItems(frame, step, loop);
    }
  }

  private pumpItems(frame: Frame, step: LoopStep, first: LoopState): void {
    const key = this.loopKey(frame, step.id);
    const concurrency = step.concurrency ?? 1;
    let loop = first;
    const total = loop.items?.length ?? 0;
    while (loop.open < concurrency && loop.next < total) {
      this.startIteration(frame, step, loop);
      loop = this.state.loops[key] ?? loop;
    }
    if (loop.open === 0 && loop.next >= total) {
      this.finishLoop(frame, step, loop);
    }
  }

  private pumpWhile(
    frame: Frame,
    step: Extract<LoopStep, { mode: 'while' }>,
    loop: LoopState,
  ): void {
    const holds = this.whileHolds(frame, step);
    if (holds === false) {
      this.finishLoop(frame, step, loop);
    } else if (holds === true) {
      if (loop.next >= step['max-iterations']) {
        this.fail(frame, step.id, 'loop_limit_exceeded');
      } else {
        this.startIteration(frame, step, loop);
      }
    }
  }

  /** An iteration's path, back to the loop that started it. */
  private loopFrame(frame: Frame): { readonly outer: Frame; readonly step: LoopStep } | null {
    const segment = lastSegment(frame.path);
    const loopId = segment.slice(0, segment.indexOf('['));
    const step = frame.facts.graph.nodes.get(loopId)?.step;
    return step?.type === 'loop'
      ? { outer: { facts: frame.facts, path: parentOf(frame.path) }, step }
      : null;
  }

  private endIteration(frame: Frame): void {
    const found = this.loopFrame(frame);
    const loop =
      found === null ? undefined : this.state.loops[this.loopKey(found.outer, found.step.id)];
    if (found === null || loop === undefined) {
      this.haltRun({ nodeId: null, iterationPath: frame.path, code: 'execution_error' });
      return;
    }
    const { outer, step } = found;
    this.setLoop(this.loopKey(outer, step.id), {
      ...loop,
      open: loop.open - 1,
      iterations: loop.iterations + 1,
    });
    this.pump(outer, step);
  }

  private collect(frame: Frame, step: Extract<WorkflowStep, { type: 'array-map-output' }>): void {
    const rendered = this.render(step.value, frame.path);
    if (isFailed(rendered)) {
      this.fail(frame, step.id, rendered.failed);
      return;
    }
    const found = this.loopFrame(frame);
    const key = found === null ? '' : this.loopKey(found.outer, found.step.id);
    const loop = this.state.loops[key];
    if (loop === undefined) {
      this.fail(frame, step.id, 'execution_error');
      return;
    }
    const index = String(iterationIndex(frame.path));
    this.setLoop(key, { ...loop, values: { ...loop.values, [index]: rendered } });
    this.succeed(frame, step.id, rendered);
    this.follow(frame, step.id, NEXT);
  }

  private renderMappings(frame: Frame, nodeId: string, mappings: JsonRecord): JsonRecord | null {
    const rendered: Record<string, JsonValue> = {};
    for (const [name, mapping] of Object.entries(mappings)) {
      const value = this.render(mapping, frame.path);
      if (isFailed(value)) {
        this.fail(frame, nodeId, value.failed);
        return null;
      }
      rendered[name] = value;
    }
    return rendered;
  }

  private visitOutput(frame: Frame, step: Extract<WorkflowStep, { type: 'output' }>): void {
    const rendered = this.renderMappings(frame, step.id, step.mappings);
    if (rendered === null) {
      return;
    }
    this.succeed(frame, step.id, rendered);
    const modulePath = modulePathOf(frame.path);
    if (modulePath === null) {
      this.update({ status: 'completed', runOutputs: rendered });
      return;
    }
    const parent = this.frameAt(parentOf(modulePath));
    const moduleId = lastSegment(modulePath).slice(MODULE_PREFIX.length);
    if (parent !== null) {
      this.succeed(parent, moduleId, rendered);
      this.follow(parent, moduleId, NEXT);
    }
  }

  /** C119.7: one failure of a node at a frame. */
  fail(frame: Frame, nodeId: string, code: string): void {
    this.executed.push({
      nodeId,
      iterationPath: frame.path,
      status: 'failed',
      output: null,
      code,
    });
    this.afterFailure(frame, nodeId, code);
  }

  private afterFailure(frame: Frame, nodeId: string, code: string): void {
    const step = frame.facts.graph.nodes.get(nodeId)?.step;
    if (edgeOn(frame.facts.graph, nodeId, ERROR) !== undefined) {
      this.follow(frame, nodeId, ERROR);
    } else if (step !== undefined && step !== null && continues(step)) {
      this.store(frame.path, nodeId, null);
      this.follow(frame, nodeId, step.type === 'loop' ? DONE : NEXT);
    } else {
      this.update({
        failures: [...this.state.failures, { nodeId, iterationPath: frame.path, code }],
      });
      this.bubble(frame, nodeId);
    }
  }

  /** A failure nothing at this node absorbed, passed to what encloses it. */
  private bubble(frame: Frame, nodeId: string): void {
    const region = frame.facts.enclosure.get(nodeId)?.at(-1);
    if (region === undefined) {
      this.bubbleFrame(frame);
    } else if (region.kind === 'parallel') {
      this.bubbleJoin(frame, region);
    } else {
      this.bubbleIteration(frame);
    }
  }

  private bubbleFrame(frame: Frame): void {
    const modulePath = modulePathOf(frame.path);
    if (modulePath === null) {
      this.update({ status: 'errored' });
      this.halted = true;
      return;
    }
    const parent = this.frameAt(parentOf(modulePath));
    const moduleId = lastSegment(modulePath).slice(MODULE_PREFIX.length);
    if (parent !== null) {
      this.moduleFailed(parent, moduleId);
    }
  }

  /** A failure absorbed further out is no failure of the run: a resume never re-readies it. */
  private absorb(prefix: string): string {
    const absorbed = this.state.failures.filter(({ iterationPath }) =>
      iterationPath.startsWith(prefix),
    );
    this.update({
      failures: this.state.failures.filter((failure) => !absorbed.includes(failure)),
    });
    return absorbed[0]?.code ?? 'execution_error';
  }

  private absorbs(frame: Frame, nodeId: string): boolean {
    const step = frame.facts.graph.nodes.get(nodeId)?.step;
    return (
      edgeOn(frame.facts.graph, nodeId, ERROR) !== undefined ||
      (step !== undefined && step !== null && continues(step))
    );
  }

  /** A module or a loop fails as a step would, keeping the failures inside it unless it absorbs. */
  private settleFailure(frame: Frame, nodeId: string, inner: string): void {
    if (this.absorbs(frame, nodeId)) {
      const code = this.absorb(inner);
      this.executed.push({
        nodeId,
        iterationPath: frame.path,
        status: 'failed',
        output: null,
        code,
      });
      this.afterFailure(frame, nodeId, code);
    } else {
      this.bubble(frame, nodeId);
    }
  }

  private moduleFailed(parent: Frame, moduleId: string): void {
    this.settleFailure(parent, moduleId, `${parent.path}${MODULE_PREFIX}${moduleId}${SEGMENT}`);
  }

  private bubbleJoin(frame: Frame, region: ParallelRegion): void {
    const key = this.joinKey(frame, region.join ?? '');
    const join = this.state.joins[key];
    if (join === undefined) {
      this.haltRun({ nodeId: region.id, iterationPath: frame.path, code: 'execution_error' });
      return;
    }
    const open = join.open - 1;
    this.setJoin(key, { open, failed: join.failed + 1 });
    if (open === 0) {
      this.bubble(frame, region.id);
    }
  }

  private bubbleIteration(frame: Frame): void {
    const found = this.loopFrame(frame);
    const key = found === null ? '' : this.loopKey(found.outer, found.step.id);
    const loop = this.state.loops[key];
    if (found === null || loop === undefined) {
      this.haltRun({ nodeId: null, iterationPath: frame.path, code: 'execution_error' });
      return;
    }
    const { outer, step } = found;
    const open = loop.open - 1;
    this.setLoop(key, { ...loop, open, failed: loop.failed + 1 });
    if (open === 0) {
      this.bubbleLoop(outer, step);
    }
  }

  /** A loop whose iterations have all stopped, with at least one failed. */
  private bubbleLoop(frame: Frame, step: LoopStep): void {
    this.settleFailure(frame, step.id, `${frame.path}${step.id}[`);
  }

  private reopen(frame: Frame, nodeId: string): void {
    const region = frame.facts.enclosure.get(nodeId)?.at(-1);
    if (region === undefined) {
      this.reopenFrame(frame);
    } else if (region.kind === 'parallel') {
      const key = this.joinKey(frame, region.join ?? '');
      const join = this.state.joins[key];
      if (join !== undefined) {
        this.setJoin(key, { open: join.open + 1, failed: join.failed - 1 });
        if (join.open === 0) {
          this.reopen(frame, region.id);
        }
      }
    } else {
      this.reopenLoop(frame);
    }
  }

  private reopenFrame(frame: Frame): void {
    const modulePath = modulePathOf(frame.path);
    const parent = modulePath === null ? null : this.frameAt(parentOf(modulePath));
    if (modulePath !== null && parent !== null) {
      this.reopen(parent, lastSegment(modulePath).slice(MODULE_PREFIX.length));
    }
  }

  private reopenLoop(frame: Frame): void {
    const found = this.loopFrame(frame);
    const key = found === null ? '' : this.loopKey(found.outer, found.step.id);
    const loop = this.state.loops[key];
    if (found !== null && loop !== undefined) {
      this.setLoop(key, { ...loop, open: loop.open + 1, failed: loop.failed - 1 });
      if (loop.open === 0) {
        this.reopen(found.outer, found.step.id);
      }
    }
  }

  private resume(): void {
    const { failures } = this.state;
    if (failures.some(({ nodeId }) => nodeId === null)) {
      return;
    }
    this.update({ status: 'in_progress', failures: [] });
    for (const { nodeId, iterationPath } of failures) {
      const frame = this.frameAt(iterationPath);
      if (frame !== null && nodeId !== null) {
        this.reopen(frame, nodeId);
        this.enter(frame, nodeId);
      }
    }
  }

  private finish(
    frame: Frame,
    nodeId: string,
    completed: Extract<StepCompletion, { kind: 'step' }>,
  ): void {
    const step = frame.facts.graph.nodes.get(nodeId)?.step;
    if (step === undefined || step === null) {
      this.haltRun({ nodeId, iterationPath: frame.path, code: 'execution_error' });
    } else if (completed.outcome === 'failed') {
      this.fail(frame, nodeId, completed.code);
    } else if (completed.outcome === 'succeeded') {
      this.store(frame.path, nodeId, completed.output);
      this.follow(frame, nodeId, NEXT);
    } else if (step.type === 'wait' && step.mode === 'events' && step['on-timeout'] === 'error') {
      this.fail(frame, nodeId, 'wait_timed_out');
    } else {
      this.store(frame.path, nodeId, completed.output);
      this.executed.push({
        nodeId,
        iterationPath: frame.path,
        status: 'timed_out',
        output: completed.output,
        code: null,
      });
      this.follow(frame, nodeId, NEXT);
    }
  }

  private startModule(frame: Frame, nodeId: string): void {
    const step = frame.facts.graph.nodes.get(nodeId)?.step;
    const path = `${frame.path}${MODULE_PREFIX}${nodeId}${SEGMENT}`;
    const module = this.frameAt(path);
    if (step?.type !== 'module' || module === null) {
      this.fail(frame, nodeId, 'execution_error');
      return;
    }
    const inputs = this.renderMappings(frame, nodeId, step.inputs);
    if (inputs === null) {
      return;
    }
    this.update({ modules: { ...this.state.modules, [path]: { inputs } } });
    const start = module.facts.graph.start;
    if (start === null) {
      this.fail(frame, nodeId, 'execution_error');
    } else {
      this.enter(module, start);
    }
  }

  private apply(completed: StepCompletion): void {
    switch (completed.kind) {
      case 'start':
        this.begin();
        break;
      case 'resume':
        this.resume();
        break;
      default: {
        const frame = this.frameAt(completed.iterationPath);
        if (frame === null) {
          this.haltRun({
            nodeId: completed.nodeId,
            iterationPath: completed.iterationPath,
            code: 'execution_error',
          });
        } else if (completed.kind === 'module-started') {
          this.startModule(frame, completed.nodeId);
        } else {
          this.finish(frame, completed.nodeId, completed);
        }
      }
    }
  }

  private begin(): void {
    const frame: Frame = { facts: factsOf(this.definition), path: '' };
    const { start } = frame.facts.graph;
    if (start === null) {
      this.haltRun({ nodeId: null, iterationPath: '', code: 'execution_error' });
    } else {
      this.enter(frame, start);
    }
  }

  beginAt(nodeId: string): AdvanceResult {
    this.enter({ facts: factsOf(this.definition), path: '' }, nodeId);
    return this.drain();
  }

  private drain(): AdvanceResult {
    for (let task = this.work.shift(); task !== undefined; task = this.work.shift()) {
      if (this.halted) {
        break;
      }
      task();
    }
    return {
      nextState: this.state,
      stepsToMakeReady: this.halted && this.state.status !== 'in_progress' ? [] : this.ready,
      executed: this.executed,
    };
  }

  run(completed: StepCompletion): AdvanceResult {
    this.apply(completed);
    return this.drain();
  }
}

const continues = (step: WorkflowStep): boolean =>
  'continue-on-error' in step && step['continue-on-error'] === true;

const defaultsOf = ({ variables }: WorkflowDefinition): JsonRecord =>
  Object.fromEntries(
    variables.flatMap(({ name, default: value }) => (value === undefined ? [] : [[name, value]])),
  );

/** C120: a new run's state, and what its first advance makes ready. */
export function startRun(
  definition: WorkflowDefinition,
  seed: RunSeed,
  context: AdvanceContext = {},
): AdvanceResult {
  const state: RunState = {
    status: 'in_progress',
    now: seed.now,
    stepExecutions: 0,
    trigger: seed.trigger,
    inputs: seed.inputs,
    variables: defaultsOf(definition),
    currentRun: seed.currentRun,
    currentCase: seed.currentCase ?? null,
    outputs: {},
    joins: {},
    loops: {},
    modules: {},
    runOutputs: {},
    failures: [],
  };
  const walk = new Walk(definition, state, context);
  return seed.startStep === undefined ? walk.run({ kind: 'start' }) : walk.beginAt(seed.startStep);
}

/**
 * C117.1: what follows `completed`. A run that already ended stays as it is, because a late
 * completion must change nothing, and the executor's fencing keeps one from reaching here at all.
 */
export function advance(
  definition: WorkflowDefinition,
  state: RunState,
  completed: StepCompletion,
  context: AdvanceContext = {},
): AdvanceResult {
  if (state.status !== 'in_progress' && completed.kind !== 'resume') {
    return { nextState: state, stepsToMakeReady: [], executed: [] };
  }
  return new Walk(definition, state, context).run(completed);
}
