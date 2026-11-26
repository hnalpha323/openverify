/**
 * What the v2 step types add to their v1 forms (C147.3), and the small facts about steps that the
 * client view, the projection, the graph rules and the walk share. Internal to `v2/`.
 */
import type { FlowV2 } from './schemas/flow.js';
import {
  VERIFICATION_STEP_TYPES,
  type FlowV2Step,
  type VerificationStepType,
} from './schemas/steps.js';

/** The additive v2 members of the v1 step types (C147.3, C150.6, C150.7, C148.7, C153.2). */
export const V2_STEP_MEMBERS = Object.freeze([
  'onFallback',
  'captureMethodsByDevice',
  'prefillFrom',
  'decisionBasis',
  'contestRoute',
  'biometricBasis',
] as const);
export type V2StepMember = (typeof V2_STEP_MEMBERS)[number];

/** A copy of `step` without the named members, every other member in its order. */
export function withoutMembers(step: object, members: readonly string[]): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(step)) {
    if (!members.includes(key)) {
      kept[key] = value;
    }
  }
  return kept;
}

const VERIFICATION_TYPES: ReadonlySet<string> = new Set(VERIFICATION_STEP_TYPES);
const TERMINAL_TYPES: ReadonlySet<string> = new Set(['completion', 'failure']);

export function isVerificationStep(
  step: FlowV2Step,
): step is Extract<FlowV2Step, { type: VerificationStepType }> {
  return VERIFICATION_TYPES.has(step.type);
}

export function isTerminalStep(step: FlowV2Step): boolean {
  return TERMINAL_TYPES.has(step.type);
}

/** The flow's steps by id. */
export function stepsById(flow: FlowV2): ReadonlyMap<string, FlowV2Step> {
  return new Map(flow.steps.map((step) => [step.id, step]));
}

/** The edges leaving each step, by `<step id>\u0000<port>`; the first edge wins a duplicate. */
export function edgeTargets(flow: FlowV2): ReadonlyMap<string, string> {
  const targets = new Map<string, string>();
  for (const edge of flow.edges) {
    const key = portKey(edge.from, edge.port);
    if (!targets.has(key)) {
      targets.set(key, edge.to);
    }
  }
  return targets;
}

export const portKey = (stepId: string, port: string): string => `${stepId}\u0000${port}`;
