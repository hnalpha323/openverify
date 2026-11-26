/**
 * C151.8, C151.13 (Workflow 9A, api-flow-engine, checkpoint "outcome"): the inquiry's flow
 * attributes, with their public names:
 *
 * - `previous-step-name`: the person-visible step left last; `next-step-name`: the step the person
 *   is on, `null` once the flow ended. Step ids are visible to the person and to operators, but a
 *   step reached through a sensitive exit (a screen button other than `next`, or a route that read
 *   a PII-marked path, C151.1) can reveal a masked value (review P15), so without PII visibility
 *   such a step's name is `null`. "Reached through" means every exit since the person-visible step
 *   before it: that step's own exit and the branches and actions passed after it.
 * - `flow-outcome` (C151.13, review H09): PII-free codes, `null` until the person's part ended;
 *   also `inquiry.completed`'s `meta` ({@link inquiryCompletedMeta}).
 *
 * The record's sensitive marks are read, never served: no route serves the step record (C151.1).
 */
import type { FlowOutcome } from '@openverify/contracts';
import { listInquiryFlowSteps, type Db, type Inquiry, type InquiryFlowStep } from '@openverify/db';
import type { PiiMask } from '../auth/pii.js';

/** The inquiry attributes the engine fills (public names, C151.8, C151.13). */
export interface FlowInquiryAttributes {
  'previous-step-name': string | null;
  'next-step-name': string | null;
  'flow-outcome': FlowOutcome | null;
}

const isPersonVisible = (entry: InquiryFlowStep): boolean =>
  entry.stepType !== 'branch' && entry.stepType !== 'action';

/** Whether the entry at `index` was reached through a sensitive exit (see the module comment). */
function reachedSensitively(record: readonly InquiryFlowStep[], index: number): boolean {
  for (let before = index - 1; before >= 0; before -= 1) {
    const entry = record[before];
    if (entry === undefined) break;
    if (entry.sensitive) return true;
    if (isPersonVisible(entry)) break;
  }
  return false;
}

/** The PII-free flow outcome in its public form; `null` while the person's part goes on. */
export function publicOutcome(inquiry: Pick<Inquiry, 'flowOutcome'>): FlowOutcome | null {
  const stored = inquiry.flowOutcome;
  return stored === null
    ? null
    : {
        'verification-types-on-path': [...stored.verificationTypesOnPath],
        'fallbacks-taken': [...stored.fallbacksTaken],
        flags: [...stored.flags],
      };
}

/** The flow attributes of `inquiry`, masked for `mask`. */
export async function flowInquiryAttributes(
  db: Db,
  inquiry: Inquiry,
  mask: Pick<PiiMask, 'visible'>,
): Promise<FlowInquiryAttributes> {
  const outcome = publicOutcome(inquiry);
  if (inquiry.flowStepId === null) {
    return { 'previous-step-name': null, 'next-step-name': null, 'flow-outcome': outcome };
  }
  const record = await listInquiryFlowSteps(db, inquiry.environmentId, inquiry.id);
  const shown = (stepId: string | null, index: number): string | null =>
    stepId === null || (!mask.visible && index >= 0 && reachedSensitively(record, index))
      ? null
      : stepId;
  const previous = inquiry.flowPreviousStepId;
  const previousIndex =
    previous === null
      ? -1
      : record.findLastIndex((entry) => entry.stepId === previous && entry.exitPort !== null);
  const next = inquiry.flowState === 'ended' ? null : inquiry.flowStepId;
  return {
    'previous-step-name': shown(previous, previousIndex),
    'next-step-name': shown(next, record.length - 1),
    'flow-outcome': outcome,
  };
}

/** `inquiry.completed`'s `meta` (C151.13), or `undefined` for an inquiry with no flow outcome. */
export function inquiryCompletedMeta(
  inquiry: Pick<Inquiry, 'flowOutcome'>,
): { 'flow-outcome': FlowOutcome } | undefined {
  const outcome = publicOutcome(inquiry);
  return outcome === null ? undefined : { 'flow-outcome': outcome };
}
