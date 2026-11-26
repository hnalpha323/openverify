/**
 * C156.4 (Workflow 9B, `api-templates-carry`): simulate a template version. The path the server
 * engine would take over a simulated scope, walked by the engine's own functions (review H16):
 * `nextPosition` and `resumeAt` of `@openverify/flow-spec` with the one server evaluator
 * (`flowConditionEvaluator`), each simulated verification's status derived from its per-check
 * overrides through core's `decideVerification`, and the outcome by `flowOutcome`. Labelled
 * simulated; nothing is stored, no request is sent and no workflow runs.
 *
 * What the walk does at each kind of step, as the engine does (`flow-engine/engine.ts`):
 * - a person's step (consent, screen, handoff) is left through `next`: the person goes on;
 * - a verification step is left through `next` when its simulated status passed, was skipped or is
 *   in review; through `exhausted` when it failed and the step has that edge (noted
 *   `fallback-continue` under `onFallback: "continue"`); with no such edge the inquiry fails there;
 *   a verification the scope does not decide stops the path there, pending, as the live flow waits
 *   for the person;
 * - a verification's facts enter the scope only once the path has entered its step, as the live
 *   scope holds only the verifications made so far;
 * - a branch that waits for facts (`waitFor`) waits until its deadline: the facts the scope leaves
 *   unknown stay `null` and follow `onNull` (`waited`, noted `waited_for_facts`);
 * - an action: `run_workflow` never runs, it takes the port its simulated status gives (`completed`
 *   `next`, anything else `error`, outputs only when completed) and the path stops there when the
 *   scope does not simulate it; `tag_inquiry` changes the simulated tags; `flag_for_review` is
 *   noted; `copy_extractions` copies a decided verification's simulated extractions into the
 *   simulated fields; `update_account_fields` writes nothing.
 *
 * What differs from a live inquiry, and is said so (C156.7): a failure step is shown failed even
 * where Phase 8's decision-record gates would send the inquiry to review at run time (the recorded
 * consent is not simulated), and a simulated `null` signal has no reason, so it never counts in the
 * `needs_review` class of `ON_NULL_DEFAULTS`; an errored check (`null`) always does.
 */
import {
  fromApiVerificationType,
  toApiVerificationType,
  verificationConfigSchema,
  type ApiVerificationType,
  type SimulatedScope,
  type templateSimulationDocumentSchema,
} from '@openverify/contracts';
import {
  addTag,
  checkErrorClassOf,
  decideVerification,
  DomainError,
  getCheckDefinition,
  removeTag,
  SIGNAL_REGISTRY,
  type CheckResult,
  type VerificationTemplateConfig,
} from '@openverify/core';
import {
  checkScopeStatus,
  FLOW_SCOPE_EXTRACTIONS,
  FLOW_STEP_NOTES,
  flowOutcome,
  flowScopeAt,
  nextPosition,
  resumeAt,
  type FieldSchemaInput,
  type FlowStepRecordEntry,
  type FlowV2,
  type FlowV2Step,
  type NextPosition,
  type NextPositionOptions,
  type RouteTaken,
  type ScopePathDescription,
  type ScopeSource,
} from '@openverify/flow-spec';
import type { z } from 'zod';
import { flagForReview } from '../../flow-actions/instant-actions.js';
import { ENGINE_NOTES } from '../../flow-engine/engine.js';
import { conditionPaths, flowConditionEvaluator } from '../../flow-engine/evaluator.js';
import { ageYears, type AssembledScope } from '../../flow-engine/scope.js';
import { maxAttemptsOf, stepVerificationType } from '../../flow-engine/verification-state.js';

/** The attributes of a simulation answer. */
export type TemplateSimulation = z.infer<
  typeof templateSimulationDocumentSchema
>['data']['attributes'];

type SimulatedStep = TemplateSimulation['steps'][number];

/** One refusal of a simulated scope: where in the scope, and the rule (never a value). */
export interface SimulationScopeProblem {
  /** A JSON Pointer into the scope, such as `/verifications/id_card/checks/id_expired_detection`. */
  pointer: string;
  detail: string;
}

/** A simulated scope that does not fit the version's flow or configuration. */
export class SimulationScopeError extends Error {
  override name = 'SimulationScopeError';

  constructor(readonly problems: readonly SimulationScopeProblem[]) {
    super('The simulated scope does not fit this template version.');
  }
}

/** What a simulation reads beside the flow and the scope. */
export interface SimulationContext {
  /** The version's `verification-config` by API verification type, as stored (unparsed). */
  verificationConfig: unknown;
  fieldSchemas: readonly FieldSchemaInput[];
  /** The simulated inquiry's creation and start time. */
  now: Date;
}

/** A step's outcome as `flowOutcome` reads it. */
type OutcomeStatus = 'passed' | 'skipped' | 'needs_review' | 'failed' | 'pending';

/** One verification of the scope, resolved against its step. */
interface ResolvedVerification {
  status: OutcomeStatus;
  /** `verifications.<step id>`, as the scope holds it once the step is entered. */
  facts: Record<string, unknown>;
  /** The paths whose `null` is of the `needs_review` class (an errored check). */
  reviewPaths: readonly string[];
}

const escape = (segment: string): string => segment.replaceAll('~', '~0').replaceAll('/', '~1');
const pointer = (...segments: string[]): string => segments.map((s) => `/${escape(s)}`).join('');

/** A simulated verification status, read as the step's outcome. */
function outcomeOf(status: string | null | undefined): OutcomeStatus {
  switch (status) {
    case 'passed':
      return 'passed';
    case 'skipped':
      return 'skipped';
    case 'needs_review':
      return 'needs_review';
    case 'failed':
    case 'canceled':
      return 'failed';
    default:
      return 'pending';
  }
}

/** The version's `verification-config`, by API type; `null` when it does not parse. */
function configOf(
  stored: unknown,
): Partial<Record<ApiVerificationType, VerificationTemplateConfig>> {
  const parsed = verificationConfigSchema.safeParse(stored);
  return parsed.success
    ? (parsed.data as Partial<Record<ApiVerificationType, VerificationTemplateConfig>>)
    : {};
}

/** A check result as a check would have written it, with the simulated status (C29.2). */
function simulatedResult(name: string, status: string | null): CheckResult {
  const definition = getCheckDefinition(name);
  return {
    name,
    status: (status ?? 'not_applicable') as CheckResult['status'],
    type: definition?.checkType ?? 'fraud',
    // A check that errored answers `not_applicable` with `execution_error`, as an outage does.
    reasons: status === null ? ['execution_error'] : [],
    metadata: {},
    stage: definition?.stage ?? 'beta',
    confidence: null,
    provenance: { 'implementation-version': definition?.version ?? 1, thresholds: {} },
  };
}

/** C150.3: a check errored by an outage or an unconfigured provider flags review. */
const checkNullIsReview = (reasons: readonly string[]): boolean =>
  checkErrorClassOf(reasons) !== null && !reasons.includes('input_missing');

type SimulatedVerification = NonNullable<SimulatedScope['verifications']>[string];

function resolveVerification(
  step: FlowV2Step,
  simulated: SimulatedVerification,
  config: Partial<Record<ApiVerificationType, VerificationTemplateConfig>>,
  now: Date,
  problems: SimulationScopeProblem[],
): ResolvedVerification {
  const at = (...more: string[]) => pointer('verifications', step.id, ...more);
  const type = stepVerificationType(step);
  const apiType = type === null ? null : toApiVerificationType(type);
  const typeConfig = apiType === null ? undefined : config[apiType];
  const base = `verifications.${step.id}`;
  const reviewPaths: string[] = [];
  const checks: Record<string, { status: string | null }> = {};
  let status = outcomeOf(simulated.status);
  if (simulated.checks !== undefined) {
    if (typeConfig === undefined) {
      problems.push({
        pointer: at('checks'),
        detail: 'The version configures no checks for this verification type.',
      });
    } else {
      const enabled = Object.entries(typeConfig.checks)
        .filter(([, check]) => check.enabled)
        .map(([name]) => name);
      for (const name of Object.keys(simulated.checks)) {
        if (!enabled.includes(name)) {
          problems.push({
            pointer: at('checks', name),
            detail: 'The version does not run this check for this verification type.',
          });
        }
      }
      // An enabled check the scope leaves out passed; `null` is a check that errored.
      const overrides = simulated.checks;
      const results = enabled.map((name) =>
        simulatedResult(
          name,
          Object.hasOwn(overrides, name) ? (overrides[name] ?? null) : 'passed',
        ),
      );
      for (const result of results) {
        const read = checkScopeStatus(result.status, result.reasons);
        checks[result.name] = { status: read };
        if (read === null && checkNullIsReview(result.reasons)) {
          reviewPaths.push(`${base}.checks.${result.name}.status`);
        }
      }
      const derived = outcomeOf(decideVerification(results, typeConfig).status);
      if (simulated.status != null && outcomeOf(simulated.status) !== derived) {
        problems.push({
          pointer: at('status'),
          detail: 'The status contradicts what its checks decide; leave it out or match it.',
        });
      }
      status = derived;
    }
  }
  const allowed = Object.hasOwn(FLOW_SCOPE_EXTRACTIONS, step.type)
    ? FLOW_SCOPE_EXTRACTIONS[step.type as keyof typeof FLOW_SCOPE_EXTRACTIONS].map(
        (extraction) => extraction.attribute,
      )
    : [];
  const extractions: Record<string, unknown> = { ...simulated.extractions };
  for (const name of Object.keys(extractions)) {
    if (!allowed.includes(name)) {
      problems.push({
        pointer: at('extractions', name),
        detail: 'This verification type exposes no such extracted value to a flow.',
      });
    }
  }
  const birthdate = extractions.birthdate;
  if (allowed.includes('age-years') && extractions['age-years'] === undefined) {
    if (typeof birthdate === 'string') {
      extractions['age-years'] = ageYears(birthdate, now);
    }
  }
  const maxAttempts = maxAttemptsOf(step);
  const attempts =
    simulated.attempts ?? (status === 'failed' ? maxAttempts : status === 'pending' ? 0 : 1);
  if (attempts > maxAttempts) {
    problems.push({ pointer: at('attempts'), detail: 'More attempts than the step allows.' });
  }
  const failures = status === 'failed' ? attempts : Math.max(0, attempts - 1);
  return {
    status,
    facts: {
      ...extractions,
      status: status === 'pending' ? (simulated.status ?? null) : status,
      attempts,
      'attempts-remaining': Math.max(0, maxAttempts - failures),
      checks,
    },
    reviewPaths,
  };
}

const FLOW_PROVISIONAL: ReadonlySet<string> = new Set(
  SIGNAL_REGISTRY.filter((signal) => signal.flowProvisional).map((signal) => signal.name),
);

const isRunWorkflow = (step: FlowV2Step | undefined): boolean =>
  step?.type === 'action' && step.action.kind === 'run_workflow';

/** Each simulated verification resolved, and every scope member the version does not hold. */
function resolveScope(
  flow: FlowV2,
  scope: SimulatedScope,
  context: SimulationContext,
): Map<string, ResolvedVerification> {
  const problems: SimulationScopeProblem[] = [];
  const steps = new Map(flow.steps.map((step) => [step.id, step]));
  const config = configOf(context.verificationConfig);
  const verifications = new Map<string, ResolvedVerification>();
  for (const [stepId, simulated] of Object.entries(scope.verifications ?? {})) {
    const step = steps.get(stepId);
    if (step === undefined || stepVerificationType(step) === null) {
      problems.push({
        pointer: pointer('verifications', stepId),
        detail: 'Names no verification step of this version.',
      });
      continue;
    }
    verifications.set(stepId, resolveVerification(step, simulated, config, context.now, problems));
  }
  for (const name of Object.keys(scope.signals ?? {})) {
    if (!FLOW_PROVISIONAL.has(name)) {
      problems.push({
        pointer: pointer('signals', name),
        detail: 'Only a flow-provisional signal can be set: no other reaches a flow.',
      });
    }
  }
  for (const stepId of Object.keys(scope.workflows ?? {})) {
    if (!isRunWorkflow(steps.get(stepId))) {
      problems.push({
        pointer: pointer('workflows', stepId),
        detail: 'Names no run_workflow step of this version.',
      });
    }
  }
  if (problems.length > 0) {
    throw new SimulationScopeError(problems);
  }
  return verifications;
}

/** Where a fact comes from when the scope description does not name it (C150.10). */
function sourceOfRoot(path: string): ScopeSource {
  if (path.startsWith('inquiry.fields.')) return 'person';
  if (path === 'inquiry.tags') return 'operator';
  if (path.startsWith('verifications.')) return 'verification';
  if (path.startsWith('device.') || path.startsWith('session.locale')) return 'client';
  return 'server';
}

const JSON_COPY = <T>(value: T): T => structuredClone(value);

/**
 * The path and the outcome of `flow` over `scope` (C156.4).
 * @throws {SimulationScopeError} when the scope names a step, check, extraction, signal or
 *   workflow the version does not hold, or a status its checks contradict.
 */
export function simulateFlow(
  flow: FlowV2,
  scope: SimulatedScope,
  context: SimulationContext,
): TemplateSimulation {
  const verifications = resolveScope(flow, scope, context);
  const steps = new Map(flow.steps.map((step) => [step.id, step]));
  const config = configOf(context.verificationConfig);
  const checks = Object.fromEntries(
    Object.entries(config).map(([apiType, typeConfig]) => [
      fromApiVerificationType(apiType as ApiVerificationType),
      typeConfig.checks,
    ]),
  );
  const now = context.now.toISOString();
  const values: Record<string, unknown> = {
    inquiry: {
      status: scope.inquiry?.status ?? 'pending',
      fields: JSON_COPY(scope.fields ?? {}),
      tags: [...(scope.inquiry?.tags ?? [])],
      'created-at': now,
      'started-at': now,
    },
    verifications: {},
    account: JSON_COPY(scope.account ?? {}),
    device: { kind: null, platform: null, ...scope.device },
    signals: JSON_COPY(scope.signals ?? {}),
    lists: JSON_COPY(scope.lists ?? {}),
    workflows: {},
    session: {
      locale: null,
      resumed: false,
      handoff: { state: null },
      ...JSON_COPY(scope.session ?? {}),
    },
  };
  const inquiry = values.inquiry as { fields: Record<string, unknown>; tags: string[] };
  const verificationFacts = values.verifications as Record<string, unknown>;
  const workflowFacts = values.workflows as Record<string, unknown>;
  const review = new Set<string>();
  const record: FlowStepRecordEntry[] = [];
  const out: SimulatedStep[] = [];
  const descriptions = new Map<string, readonly ScopePathDescription[]>();
  let halted: string | null = null;
  let waiting: SimulatedStep | null = null;

  const evaluator = () =>
    flowConditionEvaluator(flow, {
      values: values as AssembledScope['values'],
      reviewClassPaths: review,
    });
  const options = (more: Partial<NextPositionOptions> = {}): NextPositionOptions => {
    const visits: Record<string, number> = {};
    for (const entry of record) visits[entry.stepId] = (visits[entry.stepId] ?? 0) + 1;
    return { visits, moves: record.length, ...more };
  };
  const push = (
    step: FlowV2Step | undefined,
    stepId: string,
    port: string | null,
    notes: readonly string[] = [],
  ): SimulatedStep => {
    const entry: SimulatedStep = {
      'step-id': stepId,
      'step-type': step?.type ?? 'unknown',
      port,
      route: null,
      waited: false,
      notes: [...notes],
      facts: [],
    };
    out.push(entry);
    record.push({ stepId, stepType: entry['step-type'], exitPort: port, notes: entry.notes });
    return entry;
  };
  const factsOf = (branch: FlowV2Step): SimulatedStep['facts'] => {
    if (branch.type !== 'branch') return [];
    let described = descriptions.get(branch.id);
    if (described === undefined) {
      described = flowScopeAt(flow, branch.id, {
        fieldSchemas: context.fieldSchemas,
        checks,
      }).paths;
      descriptions.set(branch.id, described);
    }
    const paths = [...new Set(branch.routes.flatMap((route) => conditionPaths(route.condition)))];
    return paths.map((path) => {
      const description = described.find((candidate) => candidate.path === path);
      return {
        path,
        tier: description?.tier ?? null,
        stage: description?.stage ?? null,
        source: description?.source ?? sourceOfRoot(path),
      };
    });
  };
  const recordTaken = (taken: RouteTaken): void => {
    const branch = steps.get(taken.branchId);
    const routeKey = taken.port.startsWith('route:') ? taken.port.slice('route:'.length) : null;
    const route = {
      key: routeKey,
      'condition-result': taken.onNull === null ? routeKey !== null : null,
      'on-null': taken.onNull,
      'null-paths': [...taken.nullPaths],
    };
    const resumed = waiting?.['step-id'] === taken.branchId ? waiting : null;
    waiting = null;
    const entry = resumed ?? push(branch, taken.branchId, null);
    entry.port = taken.port;
    entry.route = route;
    entry.facts = branch === undefined ? [] : factsOf(branch);
    entry.waited = resumed !== null;
    entry.notes = [...(resumed === null ? [] : [ENGINE_NOTES.waitedForFacts]), ...taken.notes];
    const index = out.indexOf(entry);
    record[index] = {
      stepId: taken.branchId,
      stepType: entry['step-type'],
      exitPort: taken.port,
      notes: entry.notes,
    };
  };
  const hasEdge = (from: string, port: string): boolean =>
    flow.edges.some((edge) => edge.from === from && edge.port === port);

  /** Leaves a person's or a verification's step; `null` when the path stops there. */
  const leaveStep = (step: FlowV2Step): { port: string; notes: string[] } | null => {
    if (stepVerificationType(step) === null) {
      return { port: 'next', notes: [] };
    }
    const resolved = verifications.get(step.id);
    if (resolved === undefined || resolved.status === 'pending') {
      return null;
    }
    verificationFacts[step.id] = resolved.facts;
    for (const path of resolved.reviewPaths) review.add(path);
    if (resolved.status !== 'failed') {
      return { port: 'next', notes: [] };
    }
    if (!hasEdge(step.id, 'exhausted')) {
      return null;
    }
    const onFallback = (step as { onFallback?: string }).onFallback;
    return {
      port: 'exhausted',
      notes: onFallback === 'continue' ? [FLOW_STEP_NOTES.fallbackContinue] : [],
    };
  };

  /** Runs an action as simulated: never a request, never a workflow. `null`: it waits. */
  const runAction = (step: Extract<FlowV2Step, { type: 'action' }>) => {
    const { action } = step;
    switch (action.kind) {
      case 'run_workflow': {
        const simulated = scope.workflows?.[step.id];
        if (simulated === undefined) return null;
        const completed = simulated.status === 'completed';
        workflowFacts[step.id] = {
          status: simulated.status,
          'error-type': completed
            ? null
            : (simulated['error-type'] ??
              (simulated.status === 'timed-out'
                ? 'timeout'
                : simulated.status === 'canceled'
                  ? 'run_canceled'
                  : 'run_errored')),
          outputs: completed ? JSON_COPY(simulated.outputs ?? {}) : null,
        };
        return { port: completed ? 'next' : 'error', notes: [] as string[] };
      }
      case 'tag_inquiry': {
        try {
          let tags = [...inquiry.tags];
          for (const tag of action.add ?? []) tags = addTag(tags, tag);
          for (const tag of action.remove ?? []) tags = removeTag(tags, tag);
          inquiry.tags = tags;
          return { port: 'next', notes: [] };
        } catch (thrown) {
          if (thrown instanceof DomainError) return { port: 'error', notes: [] };
          throw thrown;
        }
      }
      case 'flag_for_review':
        return { port: 'next', notes: [...(flagForReview(action).notes ?? [])] };
      case 'copy_extractions': {
        const from = verificationFacts[action.fromStep] as Record<string, unknown> | undefined;
        if (from?.status !== 'passed' && from?.status !== 'needs_review') {
          return { port: 'error', notes: [] };
        }
        for (const [field, attribute] of Object.entries(action.mapping)) {
          const value = from[attribute];
          if (value !== null && value !== undefined) inquiry.fields[field] = value;
        }
        return { port: 'next', notes: [] };
      }
      case 'update_account_fields':
        return { port: 'next', notes: [] };
    }
  };

  let walk: NextPosition = resumeAt(flow, values, flow.entry, evaluator(), options());
  for (;;) {
    for (const taken of walk.taken) recordTaken(taken);
    if (walk.kind === 'terminal') {
      push(steps.get(walk.stepId), walk.stepId, null);
      break;
    }
    if (walk.kind === 'halted') {
      halted = walk.reason;
      if (walk.reason === 'scope_path_missing') {
        push(steps.get(walk.stepId), walk.stepId, null, [FLOW_STEP_NOTES.scopePathMissing]);
      } else if (walk.reason === 'flow_loop_limit') {
        push(steps.get(walk.stepId), walk.stepId, null, [FLOW_STEP_NOTES.flowLoopLimit]);
      }
      break;
    }
    if (walk.kind === 'wait') {
      // The deadline passes with the unknown facts still unknown: their routes follow `onNull`.
      waiting = push(steps.get(walk.stepId), walk.stepId, null);
      walk = resumeAt(flow, values, walk.stepId, evaluator(), options({ waited: [walk.stepId] }));
      continue;
    }
    const step = steps.get(walk.stepId);
    if (step === undefined) break;
    const left = step.type === 'action' ? runAction(step) : leaveStep(step);
    if (left === null) {
      push(step, step.id, null);
      break;
    }
    push(step, step.id, left.port, left.notes);
    walk = nextPosition(flow, values, step.id, left.port, evaluator(), options());
  }

  const outcomes: Record<string, string> = {};
  for (const [stepId, resolved] of verifications) outcomes[stepId] = resolved.status;
  const flags = [
    ...new Set(
      record
        .flatMap((entry) => entry.notes)
        .filter((note) => note.startsWith(ENGINE_NOTES.flagForReviewPrefix)),
    ),
  ];
  const decided = flowOutcome(record, outcomes, flags);
  return {
    simulated: true,
    steps: out,
    outcome: {
      status: decided.status,
      'flow-outcome': {
        'verification-types-on-path': [...decided.outcome.verificationTypesOnPath],
        'fallbacks-taken': [...decided.outcome.fallbacksTaken],
        flags: [...decided.outcome.flags],
      },
    },
    halted,
  };
}
