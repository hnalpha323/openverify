/**
 * C150.3, C150.6, C150.7, C150.9, C150.10, C151.13 (owner `flow-spec-logic`): the publish-time
 * typing of every branch over the flow scope, and the acknowledgement analyses `api-templates`'
 * publish path calls (it owns the publish rules and compares these with the acknowledgements given).
 *
 * The typing: each route's condition is typed by the injected typer against the concrete scope at
 * its branch (`flowScopeAt`): an unknown path is `scope_path_unknown`; a signal that is not
 * flow-provisional or not collected, and every list, `scope_path_unavailable_in_flow`; a signal a
 * route reads and its `waitFor` does not name, `signal_wait_missing`; a route that reads a nullable
 * path with no `onNull`, `on_null_missing` (no default); the typer's own rules
 * (`pii_literal_in_condition`, `nullable_in_boolean_position`, ...) keep their codes.
 *
 * The acknowledgements (`<kind>:<target>`): `fallback:` for a fallback that continues (C150.6);
 * `client-unable:` beside it for an `nfc` step (C207.9: a self-asserted "cannot read a chip");
 * `heuristic:` for a branch that reads a heuristic or a check that is not required, whichever way it
 * routes (C150.7, H07); `adverse-path:` for a failure step a branch on anything but a verification's
 * outcome can reach (C150.7, H08), which in production also needs a decision basis and a contest
 * route, a biometric basis on a biometric path (C128.4), and the consent keys an explicit-consent
 * basis needs; `asserted-fact:` (production; sandbox warns) for a route on a fact the person or
 * the client controls that reaches a completion through fewer verifications than `else` (C150.10);
 * `unverified-path:` (production; sandbox warns) for a completion reachable through no
 * verification, or skipping a verification type another path requires (C151.13, H09).
 *
 * Workflow 10B (`api-integrity`; C210.5, C211.5, C211.9; a C154.9 amendment):
 * - `signal_not_decisive_alone` (an error in every environment): a failure reached from a route whose
 *   condition reads a `decisive-alone: false` signal (`signalsNotDecisiveAlone`, the predicate Phase
 *   8's workflow checks share) is refused unless a verification step and a route reading that
 *   verification's outcome lie between them. The routes after the signal's, `else` and its `onNull`
 *   route depend on it too. The rule is over what a route reads, so a trivially true or unrelated fact
 *   beside the signal changes nothing; its stated limit: a route that also reads the outcome of a
 *   verification lying on the path to it (dominating its branch) passes.
 * - `heuristic:` also for every route reading such a signal, whatever its tier and direction.
 * - With `deviceIntegrityBound` false, a route on a signal fed by the integrity verdict is
 *   `provider_not_bound` (Phase 7's code); with it true, a consent step that starts the
 *   session-integrity collection (it shows `notice.session-integrity`) needs `notice.play-integrity`
 *   on it, or on a screen or a consent that dominates it (`play_integrity_notice_missing`).
 */
import {
  CHECK_REGISTRY,
  SIGNAL_REGISTRY,
  getCheckDefinition,
  isHeuristicSignalTier,
  listChecks,
  signalsNotDecisiveAlone,
  type SignalTier,
  type VerificationType,
} from '@openverify/core';
import type { FieldSchemaInput } from './graph.js';
import { componentsOf } from './rules/components-walk.js';
import { dominates, graphModelOf, type GraphModel } from './rules/graph-model.js';
import { CORE_VERIFICATION_TYPES, conditionPaths, isVerificationType } from './rules/shared.js';
import type { FlowProblem } from './schemas/problems.js';
import type { FlowV2 } from './schemas/flow.js';
import {
  FLOW_SCOPE_EXTRACTIONS,
  FLOW_SCOPE_PATHS,
  type ScopeDescription,
  type ScopePathDescription,
  type ScopeSource,
  type ScopeValueType,
} from './schemas/scope.js';
import type { FlowV2Step } from './schemas/steps.js';

/** One concrete path, as `@openverify/workflow-engine`'s `typeFlowCondition` takes it. */
export interface FlowConditionPathInput {
  readonly path: string;
  readonly type: ScopeValueType;
  readonly options?: readonly string[];
  readonly nullable: boolean;
  readonly pii: boolean;
}

/** The typer the caller injects: `typeFlowCondition` of `@openverify/workflow-engine` (C150.12). */
export type ConditionTyper = (
  condition: Readonly<Record<string, unknown>>,
  paths: readonly FlowConditionPathInput[],
) => {
  readonly issues: readonly {
    readonly pointer: string;
    readonly code: string;
    readonly detail: string;
  }[];
  readonly reads: readonly {
    readonly path: string;
    readonly nullable: boolean;
    readonly pii: boolean;
    readonly pointer: string;
  }[];
  readonly readsNullable: boolean;
};

/** What the scope at a step depends on beyond the flow. */
export interface FlowScopeContext {
  readonly fieldSchemas?: readonly FieldSchemaInput[];
  /** `verification-config`'s checks by verification type (core's names). */
  readonly checks?: Readonly<
    Record<
      string,
      Readonly<Record<string, { readonly enabled: boolean; readonly required: boolean }>>
    >
  >;
  /** The version's resolved signal-config `collect` (signal names); absent, the registry default. */
  readonly signalCollect?: readonly string[];
  /** Each `run_workflow` step's declared outputs, from the target version's output mappings. */
  readonly workflowOutputs?: Readonly<
    Record<
      string,
      readonly { readonly name: string; readonly type: ScopeValueType; readonly pii: boolean }[]
    >
  >;
}

export interface PublishAnalysisContext extends FlowScopeContext {
  readonly environment: 'sandbox' | 'production';
  readonly typeCondition: ConditionTyper;
  /** Phase 8's `templateIsBiometric` for this template (C128.4); `null` (unknown) fails closed. */
  readonly templateIsBiometric?: boolean | null;
  /**
   * C211.5, C211.9 (Workflow 10B): whether the environment kind binds a `deviceIntegrity` provider;
   * left out when the caller does not know, which skips the two rules that depend on it.
   */
  readonly deviceIntegrityBound?: boolean;
}

export const ACKNOWLEDGEMENT_KINDS = Object.freeze([
  'fallback',
  'heuristic',
  'adverse-path',
  'asserted-fact',
  'unverified-path',
  // C207.9 (Workflow 10C): `client-unable:<nfc step id>`: a self-asserted "this client cannot read a
  // chip" may continue without review. The rule that asks for it is api-nfc's.
  'client-unable',
] as const);
export type AcknowledgementKind = (typeof ACKNOWLEDGEMENT_KINDS)[number];

/** A publish acknowledgement the version needs (`<kind>:<target>`, C154.9), with why. */
export interface RequiredAcknowledgement {
  readonly key: string;
  readonly kind: AcknowledgementKind;
  readonly target: string;
  readonly pointer: string;
  readonly reason: string;
}

export interface PublishAnalysis {
  readonly problems: readonly FlowProblem[];
  readonly acknowledgements: readonly RequiredAcknowledgement[];
}

const FIXED_ROOTS = ['inquiry.status', 'inquiry.tags', 'inquiry.created-at', 'inquiry.started-at'];
const FIXED_PREFIXES = ['account.', 'device.', 'session.'];

/** A field type (C149.1) as the scope types it. */
const FIELD_SCOPE_TYPES: Readonly<Record<string, ScopeValueType>> = Object.freeze({
  string: 'string',
  'email-address': 'string',
  integer: 'integer',
  number: 'number',
  boolean: 'boolean',
  date: 'date',
  datetime: 'datetime',
  choices: 'string',
  'multi-choices': 'string-array',
  array: 'string-array',
});

const concrete = (
  description: Omit<ScopePathDescription, 'outcome' | 'availableInFlow'> &
    Partial<Pick<ScopePathDescription, 'outcome' | 'availableInFlow'>>,
): ScopePathDescription => ({ outcome: false, availableInFlow: true, ...description });

const checkTier = (tier: string, alternate: string | undefined): SignalTier =>
  (alternate === undefined ? tier : `${tier}/${alternate}`) as SignalTier;

/** The checks a verification step's scope holds: the enabled ones, or the registry's. */
function checksOf(type: string, context: FlowScopeContext): string[] {
  const configured = context.checks?.[type];
  if (configured !== undefined) {
    return Object.entries(configured)
      .filter(([, check]) => check.enabled)
      .map(([name]) => name);
  }
  return listChecks(type as VerificationType).map((check) => check.id);
}

function verificationPaths(
  step: FlowV2Step,
  dominating: boolean,
  context: FlowScopeContext,
): ScopePathDescription[] {
  const type = CORE_VERIFICATION_TYPES[step.type] ?? '';
  const base = `verifications.${step.id}`;
  const outcome = (name: string, valueType: ScopeValueType, options?: readonly string[]) =>
    concrete({
      path: `${base}.${name}`,
      type: valueType,
      ...(options === undefined ? {} : { options }),
      nullable: !dominating,
      pii: false,
      tier: 'R',
      stage: 'ga',
      source: 'verification',
      outcome: true,
    });
  const fixed = FLOW_SCOPE_PATHS.find(({ path }) => path === 'verifications.<step id>.status');
  return [
    outcome('status', 'enum', fixed?.options),
    outcome('attempts', 'integer'),
    outcome('attempts-remaining', 'integer'),
    ...checksOf(type, context).map((name) => {
      const check = getCheckDefinition(name);
      return concrete({
        path: `${base}.checks.${name}.status`,
        type: 'enum',
        options: ['passed', 'failed', 'not_applicable'],
        nullable: true,
        pii: false,
        tier: check === undefined ? null : checkTier(check.tier, check.alternateTier),
        stage: check?.stage ?? null,
        source: 'verification',
      });
    }),
    ...(Object.hasOwn(FLOW_SCOPE_EXTRACTIONS, step.type)
      ? FLOW_SCOPE_EXTRACTIONS[step.type as keyof typeof FLOW_SCOPE_EXTRACTIONS]
      : []
    ).map((extraction) =>
      concrete({
        path: `${base}.${extraction.attribute}`,
        type: extraction.type,
        ...(extraction.options === undefined ? {} : { options: extraction.options }),
        nullable: true,
        pii: extraction.pii,
        tier: extraction.tier,
        stage: extraction.stage,
        source: 'verification',
      }),
    ),
  ];
}

function signalPaths(context: FlowScopeContext): ScopePathDescription[] {
  const collected = new Set(
    context.signalCollect ??
      SIGNAL_REGISTRY.filter((signal) => signal.default).map((signal) => signal.name),
  );
  return SIGNAL_REGISTRY.map((signal) => {
    const valueType: ScopeValueType =
      signal.valueType === 'enum' || (signal.valueType === 'string' && signal.values !== null)
        ? 'enum'
        : signal.valueType;
    return concrete({
      path: `signals.${signal.name}`,
      type: valueType,
      ...(signal.values === null ? {} : { options: signal.values }),
      nullable: true,
      pii: false,
      tier: signal.tier,
      stage: signal.stage,
      source: signal.collectionTier === 'server' ? 'server' : 'client',
      availableInFlow: signal.flowProvisional && collected.has(signal.name),
    });
  });
}

/** C150.2, C150.10: the concrete scope a branch at `stepId` reads (`null`: before any step). */
export function flowScopeAt(
  flow: FlowV2,
  stepId: string | null,
  context: FlowScopeContext = {},
): ScopeDescription {
  return { paths: scopeAt(flow, graphModelOf(flow), stepId, context) };
}

function scopeAt(
  flow: FlowV2,
  model: GraphModel,
  stepId: string | null,
  context: FlowScopeContext,
): ScopePathDescription[] {
  const fixed = FLOW_SCOPE_PATHS.filter(
    ({ path }) =>
      FIXED_ROOTS.includes(path) || FIXED_PREFIXES.some((prefix) => path.startsWith(prefix)),
  );
  const fields = (context.fieldSchemas ?? []).map((field) =>
    concrete({
      path: `inquiry.fields.${field.key}`,
      type: FIELD_SCOPE_TYPES[field.type] ?? 'string',
      nullable: true,
      pii: field.pii,
      tier: 'R',
      stage: 'ga',
      source: 'person',
    }),
  );
  const verifications = flow.steps
    .filter((step) => isVerificationType(step.type))
    .flatMap((step) =>
      verificationPaths(step, stepId !== null && dominates(model, step.id, stepId), context),
    );
  const workflows = flow.steps.flatMap((step) => {
    if (step.type !== 'action' || step.action.kind !== 'run_workflow') return [];
    const base = `workflows.${step.id}`;
    const server = { nullable: true, tier: 'R', stage: 'ga', source: 'server' } as const;
    return [
      concrete({
        path: `${base}.status`,
        type: 'enum',
        options: ['completed', 'errored', 'canceled', 'timed-out'],
        pii: false,
        ...server,
      }),
      concrete({ path: `${base}.error-type`, type: 'string', pii: false, ...server }),
      ...(context.workflowOutputs?.[step.id] ?? []).map((output) =>
        concrete({
          path: `${base}.outputs.${output.name}`,
          type: output.type,
          pii: output.pii,
          ...server,
        }),
      ),
    ];
  });
  return [...fixed, ...fields, ...verifications, ...signalPaths(context), ...workflows];
}

// The analyses ---------------------------------------------------------------------------------

const asInput = (path: ScopePathDescription): FlowConditionPathInput => ({
  path: path.path,
  type: path.type,
  ...(path.options === undefined ? {} : { options: path.options }),
  nullable: path.nullable,
  pii: path.pii,
});

const TYPER_CODES: Readonly<Record<string, string>> = Object.freeze({
  path_unknown: 'scope_path_unknown',
});

/** The paths a condition's `var`s read, each with its pointer in the condition. */
function readsAt(node: unknown, pointer: string): { path: string; pointer: string }[] {
  if (Array.isArray(node)) {
    return node.flatMap((item: unknown, index) => readsAt(item, `${pointer}/${String(index)}`));
  }
  if (typeof node !== 'object' || node === null) return [];
  return Object.entries(node).flatMap(([operator, raw]) => {
    const at = `${pointer}/${operator.replaceAll('~', '~0').replaceAll('/', '~1')}`;
    if (operator !== 'var') return readsAt(raw, at);
    const path: unknown = Array.isArray(raw) ? (raw as unknown[])[0] : raw;
    return typeof path === 'string' ? [{ path, pointer: at }] : [];
  });
}

const isSignal = (path: string): boolean => path.startsWith('signals.');
const isList = (path: string): boolean => path.startsWith('lists.');

interface BranchFacts {
  readonly paths: readonly ScopePathDescription[];
  readonly lists: boolean;
}

class Analysis {
  readonly problems: FlowProblem[] = [];
  readonly acknowledgements: RequiredAcknowledgement[] = [];
  readonly model: GraphModel;
  readonly facts = new Map<string, BranchFacts>();

  constructor(
    readonly flow: FlowV2,
    readonly context: PublishAnalysisContext,
  ) {
    this.model = graphModelOf(flow);
  }

  error(pointer: string, code: string, detail: string): void {
    this.problems.push({ pointer, code, detail, severity: 'error' });
  }

  acknowledge(kind: AcknowledgementKind, index: number, reason: string): void {
    const target = this.flow.steps[index]?.id ?? '';
    this.acknowledgements.push({
      key: `${kind}:${target}`,
      kind,
      target,
      pointer: `/steps/${String(index)}`,
      reason,
    });
  }

  /** Production asks for the acknowledgement; sandbox warns (C150.10, C151.13). */
  productionOnly(kind: AcknowledgementKind, index: number, code: string, reason: string): void {
    if (this.context.environment === 'production') {
      this.acknowledge(kind, index, reason);
    } else {
      this.problems.push({
        pointer: `/steps/${String(index)}`,
        code,
        detail: reason,
        severity: 'warning',
      });
    }
  }
}

function typeBranch(
  analysis: Analysis,
  step: Extract<FlowV2Step, { type: 'branch' }>,
  index: number,
): void {
  const scope = scopeAt(analysis.flow, analysis.model, step.id, analysis.context);
  const byPath = new Map(scope.map((path) => [path.path, path]));
  const inputs = scope.map(asInput);
  const waited = new Set(step.waitFor?.facts ?? []);
  const read: ScopePathDescription[] = [];
  let lists = false;
  const at = `/steps/${String(index)}`;
  step.routes.forEach((route, routeIndex) => {
    const base = `${at}/routes/${String(routeIndex)}`;
    const suppressed = new Set<string>();
    for (const { path, pointer } of readsAt(route.condition, '')) {
      if (!isList(path)) continue;
      lists = true;
      suppressed.add(pointer);
      analysis.error(
        `${base}/condition${pointer}`,
        'scope_path_unavailable_in_flow',
        'No list screening finishes before the person’s part does, so a flow cannot read lists',
      );
    }
    const typing = analysis.context.typeCondition(route.condition, inputs);
    for (const issue of typing.issues) {
      if (suppressed.has(issue.pointer)) continue;
      analysis.error(
        `${base}/condition${issue.pointer}`,
        TYPER_CODES[issue.code] ?? issue.code,
        issue.detail,
      );
    }
    for (const { path, pointer } of typing.reads) {
      const description = byPath.get(path);
      if (description === undefined) continue;
      read.push(description);
      if (isSignal(path) && description.availableInFlow !== true) {
        analysis.error(
          `${base}/condition${pointer}`,
          'scope_path_unavailable_in_flow',
          'A flow reads only flow-provisional signals the version collects',
        );
      } else if (isSignal(path) && !waited.has(path)) {
        analysis.error(
          `${base}/condition${pointer}`,
          'signal_wait_missing',
          'A branch names every signal it reads in its waitFor',
        );
      }
    }
    if (typing.readsNullable && route.onNull === undefined) {
      analysis.error(
        base,
        'on_null_missing',
        'This route reads a value that can be unknown; choose its onNull',
      );
    }
  });
  (step.waitFor?.facts ?? []).forEach((fact, factIndex) => {
    const pointer = `${at}/waitFor/facts/${String(factIndex)}`;
    const description = byPath.get(fact);
    if (isList(fact) || (description !== undefined && description.availableInFlow !== true)) {
      lists ||= isList(fact);
      analysis.error(
        pointer,
        'scope_path_unavailable_in_flow',
        'A branch waits only for facts a flow can read',
      );
    } else if (description === undefined) {
      analysis.error(pointer, 'scope_path_unknown', 'No path of the flow scope');
    } else {
      read.push(description);
    }
  });
  analysis.facts.set(step.id, { paths: read, lists });
}

const isOutcome = (path: ScopePathDescription): boolean => path.outcome;

const SIGNAL_PREFIX = 'signals.';

/** C210.5: the `decisive-alone: false` signals among `paths` (flow scope paths). */
const notDecisiveAloneOf = (paths: readonly string[]): string[] =>
  signalsNotDecisiveAlone(paths.filter(isSignal).map((path) => path.slice(SIGNAL_PREFIX.length)));

function isHeuristic(path: ScopePathDescription, context: FlowScopeContext): boolean {
  if (path.tier !== null && isHeuristicSignalTier(path.tier)) return true;
  // C210.5: a signal that is not decisive alone, whatever its tier (the Play Integrity ones are A).
  if (notDecisiveAloneOf([path.path]).length > 0) return true;
  const check = /^verifications\.([^.]+)\.checks\.([^.]+)\.status$/.exec(path.path);
  if (check === null) return false;
  return !checkRequired(check[1] ?? '', check[2] ?? '', context);
}

/** Whether a check decides its verification (ADR 0002 §3c): configured, else the registry default. */
function checkRequired(_stepId: string, name: string, context: FlowScopeContext): boolean {
  const definition = CHECK_REGISTRY.find((check) => check.id === name);
  const configured =
    definition === undefined ? undefined : context.checks?.[definition.verificationType]?.[name];
  return configured === undefined
    ? (definition?.defaultRequired ?? false)
    : configured.enabled && configured.required;
}

/** Steps reachable from a branch through its own edges. */
function reachableFrom(model: GraphModel, stepId: string): Set<string> {
  const seen = new Set<string>();
  const stack = (model.out.get(stepId) ?? []).map(({ edge }) => edge.to);
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    if (seen.has(id)) continue;
    seen.add(id);
    for (const { edge } of model.out.get(id) ?? []) stack.push(edge.to);
  }
  return seen;
}

/** The fewest verification steps on a path from `start` to a completion (0-1 breadth first). */
function verificationsToCompletion(analysis: Analysis, start: string | undefined): number {
  if (start === undefined) return Number.POSITIVE_INFINITY;
  const cost = (id: string): number =>
    isVerificationType(analysis.model.steps.get(id)?.type ?? '') ? 1 : 0;
  const best = new Map<string, number>([[start, cost(start)]]);
  const queue: string[] = [start];
  let answer = Number.POSITIVE_INFINITY;
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    const here = best.get(id) ?? 0;
    if (analysis.model.steps.get(id)?.type === 'completion') answer = Math.min(answer, here);
    for (const { edge } of analysis.model.out.get(id) ?? []) {
      const next = here + cost(edge.to);
      if (next < (best.get(edge.to) ?? Number.POSITIVE_INFINITY)) {
        best.set(edge.to, next);
        if (cost(edge.to) === 0) queue.unshift(edge.to);
        else queue.push(edge.to);
      }
    }
  }
  return answer;
}

const PERSON_OR_CLIENT: ReadonlySet<ScopeSource> = new Set(['person', 'client']);

function checkBranchAcknowledgements(analysis: Analysis): void {
  analysis.flow.steps.forEach((step, index) => {
    if (step.type !== 'branch') return;
    const facts = analysis.facts.get(step.id);
    if (facts === undefined) return;
    if (facts.paths.some((path) => isHeuristic(path, analysis.context))) {
      analysis.acknowledge(
        'heuristic',
        index,
        'A route reads a heuristic or a check that is not required; it inherits its error rate whichever way it routes',
      );
    }
  });
}

function checkAssertedFacts(analysis: Analysis): void {
  analysis.flow.steps.forEach((step, index) => {
    if (step.type !== 'branch') return;
    const target = (port: string): string | undefined =>
      (analysis.model.out.get(step.id) ?? []).find(({ edge }) => edge.port === port)?.edge.to;
    const elseCost = verificationsToCompletion(analysis, target('else'));
    const asserted = step.routes.some((route) => {
      const paths = conditionPaths(route.condition);
      const facts = analysis.facts.get(step.id)?.paths ?? [];
      const controlled = facts.some(
        (fact) => paths.includes(fact.path) && PERSON_OR_CLIENT.has(fact.source),
      );
      return (
        controlled && verificationsToCompletion(analysis, target(`route:${route.key}`)) < elseCost
      );
    });
    if (asserted) {
      analysis.productionOnly(
        'asserted-fact',
        index,
        'asserted_fact_route',
        'A route on a fact the person or their client controls reaches completion through fewer verifications than else',
      );
    }
  });
}

/** C128.4's three cases: a biometric result read; an inquiry status or a check status on a biometric template. */
function biometric(analysis: Analysis, facts: BranchFacts): boolean {
  const selfies = new Set(
    analysis.flow.steps.filter((step) => step.type === 'selfie').map((step) => step.id),
  );
  const biometricTemplate = analysis.context.templateIsBiometric !== false;
  return facts.paths.some((fact) => {
    const [, stepId] = /^verifications\.([^.]+)\./.exec(fact.path) ?? [];
    if (stepId !== undefined && selfies.has(stepId)) return true;
    return (
      biometricTemplate &&
      (fact.path === 'inquiry.status' || /\.checks\.[^.]+\.status$/.test(fact.path))
    );
  });
}

function consentKeys(analysis: Analysis, stepId: string): Set<string> {
  const keys = new Set<string>();
  for (const step of analysis.flow.steps) {
    if (step.type !== 'consent' || !dominates(analysis.model, step.id, stepId)) continue;
    for (const key of [...step.textKeys, ...(step.optionalTextKeys ?? [])]) keys.add(key);
  }
  return keys;
}

function checkAdversePaths(analysis: Analysis): void {
  const adverseBranches = analysis.flow.steps.filter((step) => {
    const facts = analysis.facts.get(step.id);
    return facts !== undefined && (facts.lists || facts.paths.some((path) => !isOutcome(path)));
  });
  analysis.flow.steps.forEach((step, index) => {
    if (step.type !== 'failure') return;
    const from = adverseBranches.filter((branch) =>
      reachableFrom(analysis.model, branch.id).has(step.id),
    );
    if (from.length === 0) return;
    analysis.acknowledge(
      'adverse-path',
      index,
      'A branch on something other than a verification’s own outcome can lead here',
    );
    const isBiometric = from.some((branch) =>
      biometric(analysis, analysis.facts.get(branch.id) ?? { paths: [], lists: false }),
    );
    const at = `/steps/${String(index)}`;
    if (analysis.context.environment === 'production') {
      if (step.decisionBasis === undefined)
        analysis.error(
          at,
          'decision_basis_missing',
          'In production an adverse failure declares its decision basis',
        );
      if (step.contestRoute === undefined)
        analysis.error(
          at,
          'contest_route_missing',
          'In production an adverse failure gives a contest route',
        );
      if (isBiometric && step.biometricBasis === undefined)
        analysis.error(
          at,
          'biometric_basis_missing',
          'This adverse path reads a biometric result and declares its biometric basis',
        );
    }
    const explicit =
      step.decisionBasis === 'explicit-consent' || step.biometricBasis === 'explicit-consent';
    if (explicit) {
      const keys = consentKeys(analysis, step.id);
      const needed = ['consent.automated-decision', ...(isBiometric ? ['consent.biometric'] : [])];
      if (!needed.every((key) => keys.has(key))) {
        analysis.error(
          at,
          'consent_key_missing',
          `A consent step before this failure lists ${needed.join(' and ')}`,
        );
      }
    }
  });
}

/** Whether `target` is reachable from the entry without entering a step `avoided` refuses. */
function reachableAvoiding(
  analysis: Analysis,
  target: string,
  avoided: (step: FlowV2Step) => boolean,
): boolean {
  const seen = new Set<string>();
  const stack = [analysis.flow.entry];
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    const step = analysis.model.steps.get(id);
    if (step === undefined || seen.has(id) || avoided(step)) continue;
    if (id === target) return true;
    seen.add(id);
    for (const { edge } of analysis.model.out.get(id) ?? []) stack.push(edge.to);
  }
  return false;
}

function checkFallbacksAndCompletions(analysis: Analysis): void {
  const { flow, model } = analysis;
  flow.steps.forEach((step, index) => {
    const fallback = (model.out.get(step.id) ?? []).some(({ edge }) => edge.port === 'exhausted');
    if (
      isVerificationType(step.type) &&
      fallback &&
      'onFallback' in step &&
      step.onFallback === 'continue'
    ) {
      analysis.acknowledge(
        'fallback',
        index,
        'A fallback that continues completes without sending the inquiry to review',
      );
      // C207.9 (Workflow 10C, api-nfc): `fallback:` covers a person who tried and failed; a
      // client that says it cannot read a chip at all is a separate, self-asserted claim.
      if (step.type === 'nfc') {
        analysis.acknowledge(
          'client-unable',
          index,
          'A client that reports it cannot read a document chip also takes this fallback and completes without review; the report is self-asserted, and any client can send it',
        );
      }
    }
    // C207.9 (Workflow 10C, api-nfc; review H11): the web flow and an app without a reader have
    // no other way past an nfc step.
    if (step.type === 'nfc' && !fallback && model.reachable.has(step.id)) {
      analysis.problems.push({
        pointer: `/steps/${String(index)}`,
        code: 'nfc_fallback_missing',
        detail:
          'This step has no exhausted edge, so every web session and every Android session without a chip reader stops here',
        severity: 'warning',
      });
    }
  });
  const types = new Set(
    flow.steps
      .filter((step) => model.reachable.has(step.id) && isVerificationType(step.type))
      .map((step) => step.type),
  );
  flow.steps.forEach((step, index) => {
    if (step.type !== 'completion' || !model.reachable.has(step.id)) return;
    const skips = [...types].some((type) =>
      reachableAvoiding(analysis, step.id, (other) => other.type === type),
    );
    if (
      types.size === 0 ||
      skips ||
      reachableAvoiding(analysis, step.id, (other) => isVerificationType(other.type))
    ) {
      analysis.productionOnly(
        'unverified-path',
        index,
        'unverified_path_completion',
        'This completion is reachable through no verification, or skipping a verification another path requires',
      );
    }
  });
}

type BranchStep = Extract<FlowV2Step, { type: 'branch' }>;

const OUTCOME_PATH = /^verifications\.([^.]+)\.(?:status|attempts|attempts-remaining)$/;

/** The verification steps whose outcome (C150.7's definition) a condition reads. */
const outcomeStepsOf = (condition: unknown): string[] =>
  conditionPaths(condition).flatMap((path) => OUTCOME_PATH.exec(path)?.[1] ?? []);

/** The ports a branch takes only when route `index` did not decide otherwise: its own and after. */
function dependentPorts(step: BranchStep, index: number): Set<string> {
  const ports = new Set<string>(['else']);
  step.routes.forEach((route, at) => {
    if (at >= index) ports.add(`route:${route.key}`);
  });
  const onNull = step.routes[index]?.onNull;
  if (onNull?.startsWith('route:') === true) ports.add(onNull);
  return ports;
}

/**
 * C210.5: the failure steps reached from `branch`'s route `index` along a path that passes no
 * verification step followed by a route reading its outcome (whose own ports and later ones are
 * then held by that outcome).
 */
function undecidedFailures(analysis: Analysis, branch: BranchStep, index: number): Set<string> {
  const { model } = analysis;
  const ports = dependentPorts(branch, index);
  const found = new Set<string>();
  const seen = new Set<string>();
  const stack = (model.out.get(branch.id) ?? [])
    .filter(({ edge }) => ports.has(edge.port))
    .map(({ edge }) => ({ id: edge.to, verified: [] as string[] }));
  for (let at = stack.pop(); at !== undefined; at = stack.pop()) {
    const key = `${at.id}|${[...at.verified].sort().join(',')}`;
    const step = model.steps.get(at.id);
    if (seen.has(key) || step === undefined) continue;
    seen.add(key);
    if (step.type === 'failure') {
      found.add(step.id);
      continue;
    }
    const verified =
      isVerificationType(step.type) && !at.verified.includes(step.id)
        ? [...at.verified, step.id]
        : at.verified;
    let edges = model.out.get(step.id) ?? [];
    if (step.type === 'branch') {
      const gate = step.routes.findIndex((route) =>
        outcomeStepsOf(route.condition).some((id) => verified.includes(id)),
      );
      if (gate !== -1) {
        const held = dependentPorts(step, gate);
        edges = edges.filter(({ edge }) => !held.has(edge.port));
      }
    }
    for (const { edge } of edges) stack.push({ id: edge.to, verified });
  }
  return found;
}

function checkNotDecisiveAlone(analysis: Analysis): void {
  const refused = new Map<string, { branches: Set<string>; signals: Set<string> }>();
  for (const step of analysis.flow.steps) {
    if (step.type !== 'branch') continue;
    step.routes.forEach((route, index) => {
      const signals = notDecisiveAloneOf(conditionPaths(route.condition));
      if (signals.length === 0) return;
      // The stated limit: the route also reads the outcome of a verification on the path to it.
      const coupled = outcomeStepsOf(route.condition).some(
        (id) =>
          isVerificationType(analysis.model.steps.get(id)?.type ?? '') &&
          dominates(analysis.model, id, step.id),
      );
      if (coupled) return;
      for (const failureId of undecidedFailures(analysis, step, index)) {
        const entry = refused.get(failureId) ?? { branches: new Set(), signals: new Set() };
        entry.branches.add(step.id);
        for (const signal of signals) entry.signals.add(signal);
        refused.set(failureId, entry);
      }
    });
  }
  analysis.flow.steps.forEach((step, index) => {
    const entry = refused.get(step.id);
    if (entry === undefined) return;
    analysis.error(
      `/steps/${String(index)}`,
      'signal_not_decisive_alone',
      `A route of ${[...entry.branches].join(', ')} on ${[...entry.signals].join(', ')}, which is ` +
        'never decisive alone, reaches this failure with no verification and no route on its ' +
        'outcome in between; send it to review instead',
    );
  });
}

/** C211.5: the signals the integrity verdict feeds (Play Integrity's two). */
const VERDICT_SIGNALS: ReadonlySet<string> = new Set(
  SIGNAL_REGISTRY.filter((signal) => signal.inputs.includes('integrity-verdict')).map(
    (signal) => `${SIGNAL_PREFIX}${signal.name}`,
  ),
);

const SESSION_INTEGRITY_NOTICE = 'notice.session-integrity';
const PLAY_INTEGRITY_NOTICE = 'notice.play-integrity';

/** Whether a step shows `key`: a consent's text, or a screen's text component. */
function shows(step: FlowV2Step, key: string): boolean {
  if (step.type === 'consent') {
    return [...step.textKeys, ...(step.optionalTextKeys ?? [])].includes(key);
  }
  return (
    step.type === 'screen' &&
    componentsOf(step.components, '').some(
      ({ component }) => component.kind === 'text' && component.copyKey === key,
    )
  );
}

function checkDeviceIntegrityBinding(analysis: Analysis): void {
  const bound = analysis.context.deviceIntegrityBound;
  if (bound === undefined) return;
  analysis.flow.steps.forEach((step, index) => {
    if (!bound && step.type === 'branch') {
      step.routes.forEach((route, routeIndex) => {
        for (const { path, pointer } of readsAt(route.condition, '')) {
          if (VERDICT_SIGNALS.has(path)) {
            analysis.error(
              `/steps/${String(index)}/routes/${String(routeIndex)}/condition${pointer}`,
              'provider_not_bound',
              'This signal needs a deviceIntegrity provider bound in this environment: without one every inquiry would read it as unknown',
            );
          }
        }
      });
    }
    if (
      bound &&
      step.type === 'consent' &&
      analysis.model.reachable.has(step.id) &&
      shows(step, SESSION_INTEGRITY_NOTICE) &&
      !analysis.flow.steps.some(
        (other) =>
          shows(other, PLAY_INTEGRITY_NOTICE) &&
          (other.id === step.id || dominates(analysis.model, other.id, step.id)),
      )
    ) {
      analysis.error(
        `/steps/${String(index)}`,
        'play_integrity_notice_missing',
        `A Play Integrity provider is bound, so ${PLAY_INTEGRITY_NOTICE} is shown here or on a screen before this consent on every path`,
      );
    }
  });
}

export function analyzeFlowForPublish(
  flow: FlowV2,
  context: PublishAnalysisContext,
): PublishAnalysis {
  const analysis = new Analysis(flow, context);
  flow.steps.forEach((step, index) => {
    if (step.type === 'branch') typeBranch(analysis, step, index);
  });
  const fallbacks = new Analysis(flow, context);
  checkFallbacksAndCompletions(fallbacks);
  checkBranchAcknowledgements(analysis);
  checkAdversePaths(analysis);
  checkAssertedFacts(analysis);
  checkNotDecisiveAlone(analysis);
  checkDeviceIntegrityBinding(analysis);
  const completions = fallbacks.acknowledgements.filter(({ kind }) => kind === 'unverified-path');
  return {
    problems: [...analysis.problems, ...fallbacks.problems],
    acknowledgements: [
      ...fallbacks.acknowledgements.filter(
        ({ kind }) => kind === 'fallback' || kind === 'client-unable',
      ),
      ...analysis.acknowledgements,
      ...completions,
    ],
  };
}
