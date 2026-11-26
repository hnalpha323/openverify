/**
 * C151.2, C151.3, C150.3-C150.5 (owner `flow-spec-logic`; review H16): the pure walk the server
 * engine and simulate share, and the outcome rules. The evaluator is a parameter, so neither
 * client bundle carries it (ADR 0008): the server passes `@openverify/workflow-engine`'s
 * `evaluateFlowCondition` through an adapter that gives each null its reason class.
 *
 * The walk leaves `from` through `port` and passes branches until it reaches a step a person sees
 * (`step`), an `action` the engine runs, a branch that waits for facts (`wait`), a terminal step,
 * or a halt: `flow_loop_limit` past C151.2's caps, `scope_path_missing` when a condition reads a
 * path the scope no longer has (never `else`: the person's part ends and the inquiry goes to
 * review, C150.4), or `edge_missing` for a port with no edge (a graph the rules refuse).
 */
import { checkErrorClassOf } from '@openverify/core';
import type { FlowV2 } from './schemas/flow.js';
import type { BranchStep } from './schemas/steps.js';
import { edgeTargets, isTerminalStep, portKey, stepsById } from './step-members.js';

/** The assembled scope's values by root (C150.2). */
export type FlowScopeValues = Readonly<Record<string, unknown>>;

/**
 * A condition's result: a value, a `null` met with the reason class Phase 7's `ON_NULL_DEFAULTS`
 * gives it (a `needs_review`-class null always flags review), or a path the scope no longer has.
 * An adapter reads an evaluation error (a type the dialect refuses at run time) as a `null` of the
 * review class: it never chooses a route.
 */
export type ConditionResult =
  | { readonly outcome: 'value'; readonly value: boolean }
  | { readonly outcome: 'null'; readonly paths: readonly string[]; readonly reviewClass: boolean }
  | { readonly outcome: 'missing'; readonly path: string };

export type ConditionEvaluator = (
  condition: Readonly<Record<string, unknown>>,
  scope: FlowScopeValues,
) => ConditionResult;

/** A branch passed on the walk: the route taken, any `onNull` used and the paths that read null. */
export interface RouteTaken {
  readonly branchId: string;
  readonly port: string;
  readonly onNull: string | null;
  readonly nullPaths: readonly string[];
  readonly review: boolean;
  /** The codes the engine writes on the branch's step record (`FLOW_STEP_NOTES`). */
  readonly notes: readonly string[];
}

/** C151.2's caps (ours, provisional): past either the flow halts with `flow_loop_limit`. */
export const FLOW_LOOP_LIMITS = Object.freeze({ entriesPerStep: 20, moves: 200 });

/** The step record's note codes the walk and the outcome rules share (C151.1, C151.3). */
export const FLOW_STEP_NOTES = Object.freeze({
  onNullReview: 'on-null-review',
  reviewClassNull: 'review-class-null',
  scopePathMissing: 'scope_path_missing',
  flowLoopLimit: 'flow_loop_limit',
  fallbackContinue: 'fallback-continue',
  positionBackfilled: 'position_backfilled',
  /**
   * C207.9 (Workflow 10C): the step was left through `exhausted` by a client-unable report, a
   * self-asserted claim; its reason and platform ride beside it ({@link CLIENT_UNABLE_NOTE_PREFIXES}).
   */
  clientUnable: 'client-unable',
} as const);

/**
 * C207.9 (Workflow 10C): the notes that carry a client-unable exit's reason
 * (`client-unable-reason:<reason>`) and the reporting client's platform
 * (`client-unable-platform:<android|ios|web>`), both client-reported.
 */
export const CLIENT_UNABLE_NOTE_PREFIXES = Object.freeze({
  reason: 'client-unable-reason:',
  platform: 'client-unable-platform:',
} as const);

/** What the step record says so far: entries per step id and moves, for the caps. */
export interface NextPositionOptions {
  readonly visits?: Readonly<Record<string, number>>;
  readonly moves?: number;
  /** Branches whose wait is over: their nulls follow `onNull` instead of waiting (C150.5). */
  readonly waited?: readonly string[];
}

const SCOPE_CHECK_STATUSES: ReadonlySet<string> = new Set(['passed', 'failed', 'not_applicable']);

/**
 * A check's status as the scope reads it (C150.2, H03): `passed`, `failed` and `not_applicable`
 * as they are; a check still `pending`, a `not_applicable` one with a reason in
 * `CHECK_ERROR_REASONS` or any `*_unavailable` reason, and any other status read `null`, so an
 * outage needs the route's `onNull` and never reads as "not failed".
 */
export function checkScopeStatus(
  status: string,
  reasons: readonly string[],
): 'passed' | 'failed' | 'not_applicable' | null {
  if (!SCOPE_CHECK_STATUSES.has(status)) return null;
  if (status === 'not_applicable' && checkErrorClassOf(reasons) !== null) return null;
  return status as 'passed' | 'failed' | 'not_applicable';
}

export type NextPosition =
  | { readonly kind: 'step'; readonly stepId: string; readonly taken: readonly RouteTaken[] }
  | { readonly kind: 'action'; readonly stepId: string; readonly taken: readonly RouteTaken[] }
  | {
      readonly kind: 'wait';
      readonly stepId: string;
      readonly facts: readonly string[];
      readonly maxSeconds: number;
      readonly taken: readonly RouteTaken[];
    }
  | {
      readonly kind: 'terminal';
      readonly stepId: string;
      readonly terminal: 'completion' | 'failure';
      readonly taken: readonly RouteTaken[];
    }
  | {
      readonly kind: 'halted';
      readonly reason: 'flow_loop_limit' | 'scope_path_missing' | 'edge_missing';
      readonly stepId: string;
      readonly taken: readonly RouteTaken[];
    };

/** A path of the scope, read member by member as own properties; absent reads `null`. */
function readFact(scope: FlowScopeValues, path: string): unknown {
  let current: unknown = scope;
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null || !Object.hasOwn(current, segment)) {
      return null;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current ?? null;
}

type BranchAnswer =
  { readonly port: string; readonly taken: RouteTaken } | { readonly missing: true };

/** C150.1, C150.3: the routes in order, then `else`; nulls by `onNull` and their review class. */
function routeBranch(
  branch: BranchStep,
  scope: FlowScopeValues,
  evaluate: ConditionEvaluator,
): BranchAnswer {
  const nullPaths: string[] = [];
  let reviewClass = false;
  for (const route of branch.routes) {
    const result = evaluate(route.condition, scope);
    if (result.outcome === 'missing') return { missing: true };
    if (result.outcome === 'value') {
      if (result.value) {
        return { port: `route:${route.key}`, taken: taken(branch.id, `route:${route.key}`, null) };
      }
      continue;
    }
    nullPaths.push(...result.paths.filter((path) => !nullPaths.includes(path)));
    reviewClass ||= result.reviewClass;
    // No onNull is refused at publish (`on_null_missing`); a stored one without it fails safe.
    const onNull = route.onNull ?? 'review';
    if (onNull === 'skip-route') continue;
    const port = onNull === 'else' || onNull === 'review' ? 'else' : onNull;
    return { port, taken: taken(branch.id, port, onNull) };
  }
  // Every route false or skipped: `else`, reached through `skip-route` when a null was skipped.
  return {
    port: 'else',
    taken: taken(branch.id, 'else', nullPaths.length > 0 ? 'skip-route' : null),
  };

  function taken(branchId: string, port: string, onNull: string | null): RouteTaken {
    const notes = [
      ...(onNull === 'review' ? [FLOW_STEP_NOTES.onNullReview] : []),
      ...(reviewClass ? [FLOW_STEP_NOTES.reviewClassNull] : []),
    ];
    return {
      branchId,
      port,
      onNull,
      nullPaths: [...nullPaths],
      review: notes.length > 0,
      notes,
    };
  }
}

interface Walk {
  readonly flow: FlowV2;
  readonly scope: FlowScopeValues;
  readonly evaluate: ConditionEvaluator;
  readonly visits: Map<string, number>;
  readonly waited: ReadonlySet<string>;
  moves: number;
  readonly taken: RouteTaken[];
}

function walkFrom(walk: Walk, start: string | undefined, counted: boolean): NextPosition {
  const steps = stepsById(walk.flow);
  const targets = edgeTargets(walk.flow);
  let stepId = start;
  let count = counted;
  let previous = start ?? '';
  for (;;) {
    const step = stepId === undefined ? undefined : steps.get(stepId);
    if (step === undefined) {
      return { kind: 'halted', reason: 'edge_missing', stepId: previous, taken: walk.taken };
    }
    if (count) {
      const entries = (walk.visits.get(step.id) ?? 0) + 1;
      walk.moves += 1;
      if (entries > FLOW_LOOP_LIMITS.entriesPerStep || walk.moves > FLOW_LOOP_LIMITS.moves) {
        return { kind: 'halted', reason: 'flow_loop_limit', stepId: step.id, taken: walk.taken };
      }
      walk.visits.set(step.id, entries);
    }
    count = true;
    if (isTerminalStep(step)) {
      return {
        kind: 'terminal',
        stepId: step.id,
        terminal: step.type === 'failure' ? 'failure' : 'completion',
        taken: walk.taken,
      };
    }
    if (step.type === 'action') {
      return { kind: 'action', stepId: step.id, taken: walk.taken };
    }
    if (step.type !== 'branch') {
      return { kind: 'step', stepId: step.id, taken: walk.taken };
    }
    const { waitFor } = step;
    if (
      waitFor !== undefined &&
      !walk.waited.has(step.id) &&
      waitFor.facts.some((fact) => readFact(walk.scope, fact) === null)
    ) {
      return {
        kind: 'wait',
        stepId: step.id,
        facts: waitFor.facts,
        maxSeconds: waitFor.maxSeconds,
        taken: walk.taken,
      };
    }
    const answer = routeBranch(step, walk.scope, walk.evaluate);
    if ('missing' in answer) {
      return { kind: 'halted', reason: 'scope_path_missing', stepId: step.id, taken: walk.taken };
    }
    walk.taken.push(answer.taken);
    previous = step.id;
    stepId = targets.get(portKey(step.id, answer.port));
  }
}

function startWalk(
  flow: FlowV2,
  scope: FlowScopeValues,
  evaluate: ConditionEvaluator,
  options: NextPositionOptions,
): Walk {
  return {
    flow,
    scope,
    evaluate,
    visits: new Map(Object.entries(options.visits ?? {})),
    waited: new Set(options.waited ?? []),
    moves: options.moves ?? 0,
    taken: [],
  };
}

/** Walks from `from`'s exited `port` through branches to the next step a person sees (C151.2). */
export function nextPosition(
  flow: FlowV2,
  scope: FlowScopeValues,
  from: string,
  port: string,
  evaluate: ConditionEvaluator,
  options: NextPositionOptions = {},
): NextPosition {
  const target = edgeTargets(flow).get(portKey(from, port));
  if (target === undefined) {
    return { kind: 'halted', reason: 'edge_missing', stepId: from, taken: [] };
  }
  return walkFrom(startWalk(flow, scope, evaluate, options), target, true);
}

/**
 * Enters the walk at `stepId`, which the step record already holds (so it is not counted again):
 * a waiting branch whose facts arrived or whose wait is over (name it in `options.waited`), or a
 * step to show again.
 */
export function resumeAt(
  flow: FlowV2,
  scope: FlowScopeValues,
  stepId: string,
  evaluate: ConditionEvaluator,
  options: NextPositionOptions = {},
): NextPosition {
  return walkFrom(startWalk(flow, scope, evaluate, options), stepId, false);
}

/** One entry of the step record (C151.1) as the outcome rules read it. */
export interface FlowStepRecordEntry {
  readonly stepId: string;
  readonly stepType: string;
  readonly exitPort: string | null;
  readonly notes: readonly string[];
}

/** C151.13: PII-free, served on the inquiry and in `inquiry.completed`'s `meta`. */
export interface FlowOutcome {
  readonly verificationTypesOnPath: readonly string[];
  readonly fallbacksTaken: readonly string[];
  readonly flags: readonly string[];
}

export interface FlowOutcomeDecision {
  readonly status: 'pending' | 'completed' | 'failed' | 'needs_review';
  readonly outcome: FlowOutcome;
}

/** Each verification step type's public verification type, as the API spells it (C50.2). */
const API_VERIFICATION_TYPES: Readonly<Record<string, string>> = Object.freeze({
  government_id: 'government-id',
  selfie: 'selfie',
  document: 'document',
  phone_otp: 'phone-number',
  email_otp: 'email-address',
  database: 'database',
  aamva: 'aamva',
  nfc: 'government-id-nfc',
  crypto_wallet: 'crypto-wallet',
  database_business: 'database-business',
  business_website: 'business-website',
});

const DECIDED: ReadonlySet<string> = new Set(['passed', 'skipped', 'needs_review', 'failed']);
const REVIEW_NOTES: readonly string[] = [
  FLOW_STEP_NOTES.onNullReview,
  FLOW_STEP_NOTES.reviewClassNull,
  FLOW_STEP_NOTES.scopePathMissing,
  FLOW_STEP_NOTES.flowLoopLimit,
];
const UNVERIFIED_PATH = 'unverified-path';

/**
 * C151.3: the inquiry's outcome from the path taken (the step record, in order) and each entered
 * verification step's latest decided status (by step id). Only the verifications on the path
 * count. `failed` at a failure step, or when a verification failed and was not left through its
 * `exhausted` port (a failed verification is never counted passed, whatever follows);
 * `needs_review` at once on `scope_path_missing`; at a completion step, `pending` while an entered
 * verification is undecided, else `needs_review` when a verification is in review, a fallback was
 * taken without `fallback-continue`, a flag was raised (`flags`, such as `flag_for_review:<code>`)
 * or a branch noted review, else `completed`; `pending` everywhere else, a halt included.
 */
export function flowOutcome(
  stepRecord: readonly FlowStepRecordEntry[],
  verificationOutcomes: Readonly<Record<string, string>>,
  flags: readonly string[],
): FlowOutcomeDecision {
  const types: string[] = [];
  const fallbacks: string[] = [];
  const noted: string[] = [];
  let failed = false;
  let undecided = false;
  let review = false;
  for (const entry of stepRecord) {
    for (const note of entry.notes) {
      if (REVIEW_NOTES.includes(note) && !noted.includes(note)) noted.push(note);
    }
    const type = API_VERIFICATION_TYPES[entry.stepType];
    if (type === undefined) continue;
    if (!types.includes(type)) types.push(type);
    const status = verificationOutcomes[entry.stepId] ?? 'pending';
    if (entry.exitPort === 'exhausted') {
      if (!fallbacks.includes(entry.stepId)) fallbacks.push(entry.stepId);
      review ||= !entry.notes.includes(FLOW_STEP_NOTES.fallbackContinue);
    } else if (status === 'failed') {
      failed = true;
    }
    undecided ||= !DECIDED.has(status);
    review ||= status === 'needs_review';
  }
  const last = stepRecord.at(-1);
  const outcomeFlags = [...flags, ...noted];
  const decide = (status: FlowOutcomeDecision['status'], extra: readonly string[] = []) => ({
    status,
    outcome: {
      verificationTypesOnPath: types,
      fallbacksTaken: fallbacks,
      flags: [...outcomeFlags, ...extra],
    },
  });
  if (last?.stepType === 'failure' || failed) return decide('failed');
  if (noted.includes(FLOW_STEP_NOTES.scopePathMissing)) return decide('needs_review');
  if (last?.stepType !== 'completion' || undecided) return decide('pending');
  const unverified = types.length === 0 ? [UNVERIFIED_PATH] : [];
  const reviewed =
    review ||
    flags.length > 0 ||
    noted.includes(FLOW_STEP_NOTES.onNullReview) ||
    noted.includes(FLOW_STEP_NOTES.reviewClassNull);
  return decide(reviewed ? 'needs_review' : 'completed', unverified);
}
