/**
 * Test-only: the v1 rules as the web flow applied them before Phase 9, reproduced so the
 * equivalence test of C151.3 (review F07) can run every v1 fixture through them and through the
 * migrated flow's `nextPosition` and `flowOutcome`. It mirrors `apps/flow/src/flow/flow-position.ts`
 * (`resolveFlowPosition`: steps in list order, the first transition whose condition is absent or
 * true, a revisited step stops the walk, a walk past the last step completes) and
 * `apps/flow/src/flow/json-logic.ts` (loose `==`, `readVar`'s fallback, JSONLogic truthiness, an
 * unknown operator stops the walk), which `flow-renderer` retired in Phase 9 (C151.5) and Workflow
 * 9D removed from the tree (K9-34); this file is now the only copy of those rules.
 *
 * The person is modelled as finishing each step in turn: consent is given, and each verification
 * ends with the scenario's status (`passed` by default). A failed verification fails the inquiry,
 * as C50.5 does with no retry left. The outcome is v1's settlement over the steps visited: failed
 * at a failure step or a failed verification, in review when a visited verification is, else
 * completed. The context is `{ inquiry: { status: 'pending' } }`, the inquiry's status while the
 * person is in the flow.
 */
import type { Flow, FlowStep } from '../flow.js';

class UnsupportedCondition extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const truthy = (value: unknown): boolean =>
  Array.isArray(value) ? value.length > 0 : Boolean(value);

function child(value: unknown, key: string): unknown {
  if (Array.isArray(value))
    return /^\d+$/.test(key) ? (value as unknown[])[Number(key)] : undefined;
  return isRecord(value) && Object.hasOwn(value, key) ? value[key] : undefined;
}

function applyLogic(rule: unknown, data: unknown): unknown {
  if (Array.isArray(rule)) return rule.map((item) => applyLogic(item, data));
  if (!isRecord(rule)) return rule;
  const keys = Object.keys(rule);
  const [operator] = keys;
  if (keys.length !== 1 || operator === undefined) return rule;
  const raw = rule[operator];
  const args: readonly unknown[] = Array.isArray(raw) ? raw : [raw];
  const eager = (): unknown[] => args.map((arg) => applyLogic(arg, data));
  switch (operator) {
    case 'var': {
      const [path = '', fallback = null] = eager();
      if (path === '') return data;
      let current: unknown = data;
      for (const key of String(path).split('.')) {
        current = child(current, key);
        if (current === undefined) return fallback;
      }
      return current;
    }
    case 'and': {
      let value: unknown;
      for (const arg of args) {
        value = applyLogic(arg, data);
        if (!truthy(value)) return value;
      }
      return value;
    }
    case 'or': {
      let value: unknown;
      for (const arg of args) {
        value = applyLogic(arg, data);
        if (truthy(value)) return value;
      }
      return value;
    }
    case '==':
    case '!=': {
      const [left, right] = eager();
      // v1's JSONLogic `==` was JavaScript's loose equality.
      const equal = left == right;
      return operator === '==' ? equal : !equal;
    }
    case '===':
      return eager()[0] === eager()[1];
    case '!==':
      return eager()[0] !== eager()[1];
    case '!':
      return !truthy(eager()[0]);
    case '!!':
      return truthy(eager()[0]);
    case 'in': {
      const [needle, haystack] = eager();
      return Array.isArray(haystack)
        ? haystack.includes(needle)
        : typeof haystack === 'string' && typeof needle === 'string' && haystack.includes(needle);
    }
    default:
      throw new UnsupportedCondition(operator);
  }
}

export type V1Outcome = 'completed' | 'failed' | 'needs_review' | 'stopped';

export interface V1WalkResult {
  /** The steps the person saw, in order (terminal steps left out). */
  readonly path: readonly string[];
  readonly outcome: V1Outcome;
}

const VERIFICATION_TYPES = new Set([
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
]);

export const isV1VerificationStep = (step: FlowStep): boolean => VERIFICATION_TYPES.has(step.type);

export function v1Walk(flow: Flow, statuses: Readonly<Record<string, string>>): V1WalkResult {
  const context = { inquiry: { status: 'pending' } };
  const path: string[] = [];
  const visited = new Set<string>();
  let review = false;
  let index = 0;
  for (;;) {
    const step = flow.steps[index];
    if (step === undefined) return { path, outcome: review ? 'needs_review' : 'completed' };
    if (visited.has(step.id)) return { path, outcome: 'stopped' };
    visited.add(step.id);
    if (step.type === 'completion') return { path, outcome: review ? 'needs_review' : 'completed' };
    if (step.type === 'failure') return { path, outcome: 'failed' };
    path.push(step.id);
    if (isV1VerificationStep(step)) {
      const status = statuses[step.id] ?? 'passed';
      if (status === 'failed') return { path, outcome: 'failed' };
      review ||= status === 'needs_review';
    }
    let target: string | undefined;
    try {
      target = flow.transitions.find(
        (transition) =>
          transition.from === step.id &&
          (transition.condition === undefined || truthy(applyLogic(transition.condition, context))),
      )?.to;
    } catch (error) {
      if (error instanceof UnsupportedCondition) return { path, outcome: 'stopped' };
      throw error;
    }
    index = target === undefined ? index + 1 : flow.steps.findIndex(({ id }) => id === target);
  }
}
