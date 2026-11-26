/**
 * C150.7 (Workflow 9A; Phase 8 C128, not legal advice): when the flow reaches a `failure` step on an
 * adverse path, the decision record of kind `flow-failure` (actor `inquiry-flow`, the inquiry's id)
 * with the routes taken, the facts as codes with their tiers, `solely-automated: true`, the step's
 * basis and contest route, and Phase 8's gates: in production a missing basis or contest route (and,
 * on a biometric path, a missing `biometricBasis`), or a missing consent for an `explicit-consent`
 * basis, sends the inquiry to `needs_review` instead of failing it, recorded on the record. A failure
 * reached on verification outcomes only (their status and attempts) writes no record. Owner:
 * `api-flow-actions`; `api-flow-engine` calls it in the transaction that reaches the failure step,
 * under the inquiry's lock, before it moves the inquiry.
 *
 * What the path read: for each branch passed, the conditions of the routes tried up to the one
 * taken (routes are tried in order, so each earlier route's facts decided too), and every route's
 * for `else`. Each fact is recorded as its scope path (a code) with its tier and stage, never a
 * value; a fact whose tier the scope cannot name is recorded as a beta heuristic (`H`), never as
 * more certain than it is.
 *
 * The gates are Phase 8's (`adverseRefusal`, C128.3, C128.4: a production failure without its basis
 * or contest route, a biometric one without its biometric basis, an `explicit-consent` biometric
 * basis without the recorded consents), plus the flow's own: an `explicit-consent` decision basis
 * needs `consent.automated-decision` recorded (`automated_decision_consent_missing`). Whether the
 * path is biometric follows C128.4's cases as Phase 8 reads a template: a read of a selfie step's
 * facts, or an inquiry or check status on a template that holds a selfie step.
 *
 * The record is written through the repository Phase 8's `recordInquiryDecisionInTx` writes
 * through: that function's actor is an `AuditActor` and it takes no `flow` member, and the actor
 * here is the inquiry's own flow (`inquiry-flow`), which no request principal can be.
 */
import type { DecisionMeta } from '@openverify/contracts';
import { contestRouteSchema } from '@openverify/contracts';
import type { SignalTier } from '@openverify/core';
import {
  createInquiryDecision,
  getEffectiveConsent,
  getEnvironment,
  getInquiry,
  getInquiryTemplateVersion,
  type Db,
  type DecisionEvidence,
} from '@openverify/db';
import {
  flowScopeAt,
  isFlowV2,
  safeParseAnyFlow,
  type FlowV2,
  type ScopePathDescription,
} from '@openverify/flow-spec';
import type { FlowInquiryRef } from '../flow-engine/advance.js';
import { ulidIdGenerator, type Clock, type IdGenerator } from '../ports.js';
import { adverseRefusal } from '../workflows/actions/decisions/gate.js';

/** One exit on the way to the failure step, from the step record, oldest first. */
export interface FlowPathExit {
  stepId: string;
  /** `route:<key>`, `else`, `next`, `error`, `exhausted`, `button:<key>`. */
  port: string;
  /** The `onNull` a branch's route resolved with, else `null`. */
  onNull: string | null;
}

export interface FlowFailurePath {
  templateVersionId: string;
  failureStepId: string;
  exits: readonly FlowPathExit[];
}

/**
 * `fail`: the inquiry fails; `review`: a gate stopped an adverse failure and the inquiry goes to
 * `needs_review`. `decision` is the record written (`null` on verification outcomes only), and
 * `errorCode` the gate that stopped it.
 */
export interface FlowFailureVerdict {
  outcome: 'fail' | 'review';
  decision: DecisionMeta | null;
  errorCode: string | null;
}

export interface FlowFailureDeps {
  clock: Clock;
  ids?: IdGenerator | undefined;
}

const NO_RECORD: FlowFailureVerdict = { outcome: 'fail', decision: null, errorCode: null };

const AUTOMATED_DECISION_CONSENT = 'consent.automated-decision';
const OUTCOME_PATH = /^verifications\.[^.]+\.(?:status|attempts|attempts-remaining)$/;
const CHECK_PATH = /^verifications\.[^.]+\.checks\.[^.]+\.status$/;
const CODE = /^[a-z][a-z0-9_.:/-]{0,127}$/;

type Branch = Extract<FlowV2['steps'][number], { type: 'branch' }>;
type Failure = Extract<FlowV2['steps'][number], { type: 'failure' }>;

/** The paths a condition's `var`s read, in order (C114: `{"var": path}` or `[path, default]`). */
function readsOf(node: unknown): string[] {
  if (Array.isArray(node)) {
    return node.flatMap(readsOf);
  }
  if (typeof node !== 'object' || node === null) {
    return [];
  }
  return Object.entries(node).flatMap(([operator, raw]) => {
    if (operator !== 'var') {
      return readsOf(raw);
    }
    const path: unknown = Array.isArray(raw) ? (raw as unknown[])[0] : raw;
    return typeof path === 'string' ? [path] : [];
  });
}

/** The routes whose conditions decided an exit through `port`. */
function routesDeciding(branch: Branch, port: string): Branch['routes'] {
  if (!port.startsWith('route:')) {
    return branch.routes;
  }
  const key = port.slice('route:'.length);
  const index = branch.routes.findIndex((route) => route.key === key);
  return index < 0 ? branch.routes : branch.routes.slice(0, index + 1);
}

interface Read {
  path: string;
  description: ScopePathDescription | undefined;
}

/** The evidence kind of a scope path (C150.7's kinds; core's `DECISION_EVIDENCE_KINDS`). */
function kindOf(path: string): string {
  if (OUTCOME_PATH.test(path)) return 'verification';
  if (CHECK_PATH.test(path)) return 'check';
  if (path.startsWith('verifications.')) return 'extraction';
  if (path.startsWith('signals.')) return 'signal';
  if (path.startsWith('lists.')) return 'list-match';
  if (path.startsWith('workflows.')) return 'workflow-output';
  if (path.startsWith('account.')) return 'account';
  if (path.startsWith('device.') || path.startsWith('session.')) return 'device';
  return 'field';
}

function evidenceOf({ path, description }: Read): DecisionEvidence {
  const outcome = OUTCOME_PATH.test(path);
  const tier: SignalTier = description?.tier ?? (outcome ? 'R' : 'H');
  return {
    kind: kindOf(path),
    id: null,
    // A path is a code; one that is not (an operator's odd field key) is named by its kind only.
    name: CODE.test(path) ? path : kindOf(path),
    status: null,
    tier,
    stage: description?.stage ?? (outcome ? 'ga' : 'beta'),
    confidence: null,
  };
}

/** C128.4 as Phase 8 reads a template: a selfie step's fact, or a status on a selfie template. */
function biometricPath(flow: FlowV2, reads: readonly Read[]): boolean {
  const selfies = new Set(flow.steps.filter(({ type }) => type === 'selfie').map(({ id }) => id));
  return reads.some(({ path }) => {
    const [, stepId] = /^verifications\.([^.]+)\./.exec(path) ?? [];
    if (stepId !== undefined && selfies.has(stepId)) return true;
    return selfies.size > 0 && (path === 'inquiry.status' || CHECK_PATH.test(path));
  });
}

/** The facts the path's branches read, each once, in the order they were met. */
function pathReads(flow: FlowV2, exits: readonly FlowPathExit[]): Read[] {
  const steps = new Map(flow.steps.map((step) => [step.id, step]));
  const seen = new Map<string, Read>();
  for (const exit of exits) {
    const step = steps.get(exit.stepId);
    if (step?.type !== 'branch') continue;
    const scope = new Map(flowScopeAt(flow, step.id).paths.map((path) => [path.path, path]));
    for (const route of routesDeciding(step, exit.port)) {
      for (const path of readsOf(route.condition)) {
        if (!seen.has(path)) seen.set(path, { path, description: scope.get(path) });
      }
    }
  }
  return [...seen.values()];
}

const contestRouteOf = (step: Failure): Record<string, unknown> | null => {
  const route = step.contestRoute;
  if (route === undefined) return null;
  return contestRouteSchema.parse({
    ...(route.url === undefined ? {} : { url: route.url }),
    ...(route.contact === undefined ? {} : { contact: route.contact }),
    ...(route.caseTemplateId === undefined ? {} : { 'case-template-id': route.caseTemplateId }),
  });
};

async function automatedDecisionConsented(
  tx: Db,
  environmentId: string,
  inquiryId: string,
): Promise<boolean> {
  const consent = await getEffectiveConsent(tx, { environmentId, inquiryId, sessionId: null });
  return (
    consent !== null &&
    [...consent.textKeys, ...(consent.optionalTextKeys ?? [])].includes(AUTOMATED_DECISION_CONSENT)
  );
}

/** Records the failure's decision (C150.7) and answers whether the inquiry fails or goes to review. */
export async function recordFlowFailureInTx(
  tx: Db,
  deps: FlowFailureDeps,
  inquiry: FlowInquiryRef,
  path: FlowFailurePath,
): Promise<FlowFailureVerdict> {
  const { environmentId, inquiryId } = inquiry;
  const row = await getInquiry(tx, environmentId, inquiryId);
  if (row?.redactedAt !== null) {
    return NO_RECORD;
  }
  const version = await getInquiryTemplateVersion(tx, environmentId, path.templateVersionId);
  const parsed = safeParseAnyFlow(version?.flow);
  if (!parsed.success || !isFlowV2(parsed.data)) {
    return NO_RECORD;
  }
  const flow = parsed.data;
  const failure = flow.steps.find(
    (step): step is Failure => step.id === path.failureStepId && step.type === 'failure',
  );
  const reads = pathReads(flow, path.exits);
  if (failure === undefined || reads.every(({ path: read }) => OUTCOME_PATH.test(read))) {
    return NO_RECORD;
  }
  const environment = await getEnvironment(tx, environmentId);
  const biometric = biometricPath(flow, reads);
  const contestRoute = contestRouteOf(failure);
  const facts = {
    solelyAutomated: true,
    decisionBasis: failure.decisionBasis ?? null,
    contestRoute,
    biometricBasis: failure.biometricBasis ?? null,
  };
  const errorCode =
    (await adverseRefusal(
      tx,
      // An environment that is gone is held to production's gates (fail closed).
      { environmentId, environmentKind: environment?.kind ?? 'production' },
      { facts, biometric, inquiryId },
    )) ??
    (failure.decisionBasis === 'explicit-consent' &&
    !(await automatedDecisionConsented(tx, environmentId, inquiryId))
      ? 'automated_decision_consent_missing'
      : null);
  const steps = new Map(flow.steps.map((step) => [step.id, step.type]));
  const stored = await createInquiryDecision(tx, environmentId, {
    id: (deps.ids ?? ulidIdGenerator).newId('idec'),
    kind: 'flow-failure',
    subjectType: 'inquiry',
    subjectId: inquiryId,
    actorType: 'inquiry-flow',
    actorId: inquiryId,
    flow: {
      templateVersionId: path.templateVersionId,
      failureStepId: failure.id,
      routes: path.exits
        .filter(({ stepId }) => steps.get(stepId) === 'branch')
        .map(({ stepId, port, onNull }) => ({ stepId, port, onNull })),
    },
    ...facts,
    evidence: reads.map(evidenceOf),
    pendingEvidence: [],
    errorCode,
  });
  return {
    outcome: errorCode === null ? 'fail' : 'review',
    errorCode,
    decision: {
      id: stored.id,
      'solely-automated': stored.solelyAutomated,
      'decision-basis': stored.decisionBasis,
      'contest-route':
        stored.contestRoute === null ? null : contestRouteSchema.parse(stored.contestRoute),
    },
  };
}
