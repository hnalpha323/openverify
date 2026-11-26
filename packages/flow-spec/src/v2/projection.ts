/**
 * C151.6 (owner `flow-spec-logic`; decisions 2 and 73; V02, V03; the owner's decision after
 * Workflow 9A's stop): the v1 projection of a position, the `flow` member every client receives.
 * Its golden test produces every fixture of `contracts/fixtures/api/flow-projections/`, which the
 * Android host test `FlowCoordinatorProjectionTest` drives today's SDK over.
 *
 * In order, the projection lists:
 * - the person-visible steps the path has exited **that today's SDK passes as done**: a consent
 *   once it is recorded, and a verification step that left through `next` with a latest decided
 *   status of `passed`, `skipped` or `needs_review` (`FlowCoordinator.kt:560`, `:652-653`, `:701`,
 *   `:866`). Anything else exited is left out: a verification exited without passing (V02), a
 *   handoff (the position cannot show the SDK's `handoff.done`), a screen, a branch, an action;
 * - the current step;
 * - the run of steps the path then reaches through `next` alone.
 *
 * It ends at a terminal step, which is listed, or at the placeholder `continue-1` in place of the
 * first step with no v1 form: a screen, a branch (a wait included), an action, a share consent, a consent with
 * custom consent copy (V11), and a verification step with an `exhausted` edge (the owner's option
 * (i)). A step that would repeat, a step with no `next` edge, an unknown current step and a step
 * whose id is the placeholder's end it the same way, failing safe: today's SDK stops on its
 * unsupported screen there, never on "Completed". No condition, step name, description or v2
 * member is ever sent.
 */
import type { FlowV2 } from './schemas/flow.js';
import {
  SERVER_CONTINUATION_STEP_TYPE,
  type FlowProjection,
  type ProjectedStep,
} from './schemas/projection.js';
import type { FlowV2Step } from './schemas/steps.js';
import {
  V2_STEP_MEMBERS,
  edgeTargets,
  isTerminalStep,
  isVerificationStep,
  portKey,
  stepsById,
  withoutMembers,
} from './step-members.js';

/** Where the inquiry is and what it has done, as the projection reads it. */
export interface ProjectionPosition {
  readonly current: string;
  /** The exited steps in order, with the port each left through. */
  readonly exited: readonly { readonly stepId: string; readonly port: string }[];
  /** The latest decided status of each entered verification step, by step id. */
  readonly verificationStatuses: Readonly<Record<string, string>>;
  readonly consentRecorded: boolean;
  /** C162.9 (V11): the version's consent step uses custom consent copy. */
  readonly customConsentCopy: boolean;
}

/** The decided statuses today's SDK passes as done (`FlowCoordinator.kt:652-653`, `:701`). */
const DONE_STATUSES: ReadonlySet<string> = new Set(['passed', 'skipped', 'needs_review']);
const PLACEHOLDER_ID = 'continue-1';
const PLACEHOLDER: ProjectedStep = { id: PLACEHOLDER_ID, type: SERVER_CONTINUATION_STEP_TYPE };

export function projection(flow: FlowV2, position: ProjectionPosition): FlowProjection {
  const steps = stepsById(flow);
  const targets = edgeTargets(flow);
  const hasV1Form = (step: FlowV2Step): boolean => {
    switch (step.type) {
      case 'screen':
      case 'branch':
      case 'action':
      case 'share_consent': // Workflow 11A (C238.3): server-composed, v2-only.
        return false;
      case 'consent':
        return !position.customConsentCopy;
      default:
        return !(isVerificationStep(step) && targets.has(portKey(step.id, 'exhausted')));
    }
  };
  const passedAsDone = (step: FlowV2Step, port: string): boolean => {
    if (port !== 'next' || !hasV1Form(step)) return false;
    if (step.type === 'consent') return position.consentRecorded;
    return (
      isVerificationStep(step) &&
      DONE_STATUSES.has(position.verificationStatuses[step.id] ?? 'none')
    );
  };

  const listed: ProjectedStep[] = [];
  const ids = new Set<string>([PLACEHOLDER_ID]);
  const list = (step: FlowV2Step): void => {
    listed.push(withoutMembers(step, V2_STEP_MEMBERS) as ProjectedStep);
    ids.add(step.id);
  };

  for (const { stepId, port } of position.exited) {
    const step = steps.get(stepId);
    if (step !== undefined && !ids.has(step.id) && passedAsDone(step, port)) {
      list(step);
    }
  }

  let step = steps.get(position.current);
  for (;;) {
    if (step === undefined || ids.has(step.id) || !hasV1Form(step)) {
      listed.push(PLACEHOLDER);
      break;
    }
    list(step);
    if (isTerminalStep(step)) {
      break;
    }
    const next = targets.get(portKey(step.id, 'next'));
    step = next === undefined ? undefined : steps.get(next);
  }

  return {
    metadata: {
      specVersion: 1,
      id: flow.metadata.id,
      version: flow.metadata.version,
      name: flow.metadata.name,
    },
    steps: listed,
    transitions: [],
  };
}
