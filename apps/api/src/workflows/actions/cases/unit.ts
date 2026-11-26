/**
 * C140.3 (Workflow 8B): what the case steps share. A step acts through the case services
 * (`services/cases/`, `api-cases` and `api-queues-sla`) in one {@link CaseUnit} on the effect's
 * transaction, as the run (`workflow-run`, its id), so the case's history, its events and its audit
 * entries name the run, and the effect row, the step's completion and every case write commit
 * together or not at all (C117.5).
 *
 * - A run reads every template (`readerOfActor` reads a run as the system, C129.4), under the mask of
 *   its grant.
 * - A refusal is the step's error: a case problem by its code, a redacted case `subject_redacted`, a
 *   field or a value the template refuses `action_input_invalid`. Thrown, so nothing the step wrote
 *   commits.
 * - A value a template carried into a case's fields or a comment is a copy of the trigger's subject,
 *   which the effect row records (C120.9, P20), as `update_object` records one.
 */
import { isJsonRecord, parseTemplate } from '@openverify/workflow-engine';
import {
  getCaseQueueRow,
  getCaseRow,
  type Case,
  type Db,
  type WorkflowEffectCopy,
} from '@openverify/db';
import { UnprocessableContentError } from '../../../errors.js';
import type { StagedEvent } from '../../../events/index.js';
import { CaseProblemError } from '../../../services/cases/problems.js';
import { caseUnitIn, lockWritableCase, type CaseUnit } from '../../../services/cases/shared.js';
import { ActionStepError, type ActionContext } from '../../engine/action-port.js';
import { apiDepsOf, stepErrorOf } from '../shared.js';

/** A step's unit of case work: the run as the actor, its events in `staged`. */
export function runCaseUnit(tx: Db, context: ActionContext, staged: StagedEvent[]): CaseUnit {
  const { ctx, actor, mask } = context.acting;
  return caseUnitIn(
    tx,
    apiDepsOf(context),
    { ctx, actor, mask, principal: null },
    staged,
    context.now,
  );
}

/** A case service's refusal as the step's error; `null` for what is no refusal. */
export function caseStepErrorOf(error: unknown): ActionStepError | null {
  if (error instanceof CaseProblemError && error.code === 'case_redacted') {
    return new ActionStepError('subject_redacted');
  }
  if (error instanceof UnprocessableContentError && error.code === undefined) {
    return new ActionStepError('action_input_invalid');
  }
  return stepErrorOf(error);
}

/** Runs `work`, and turns a case service's refusal into the step's error. */
export async function refusingCase<Result>(work: () => Promise<Result>): Promise<Result> {
  try {
    return await work();
  } catch (error) {
    throw caseStepErrorOf(error) ?? error;
  }
}

/** The case under the step's lock, open to change, or the step's error. */
export const lockedCase = (unit: CaseUnit, caseId: string): Promise<Case> =>
  refusingCase(() => lockWritableCase(unit, caseId));

/** C132.1: an active queue of this environment; one it does not hold is not found. */
export async function assertActiveQueue(
  tx: Db,
  context: Pick<ActionContext, 'environmentId'>,
  queueId: string,
): Promise<void> {
  const queue = await getCaseQueueRow(tx, context.environmentId, queueId);
  if (queue === null) {
    throw new ActionStepError('object_not_found');
  }
  if (queue.status !== 'active') {
    throw new ActionStepError('action_refused');
  }
}

/** The case as it is now, in the step's transaction. */
export async function caseNow(unit: CaseUnit, caseId: string): Promise<Case> {
  const row = await getCaseRow(unit.tx, unit.acting.ctx.environmentId, caseId);
  if (row === null) {
    throw new ActionStepError('object_not_found');
  }
  return row;
}

function readsAPath(value: unknown): boolean {
  if (typeof value === 'string') {
    const parsed = parseTemplate(value);
    return parsed.ok && parsed.template.references.length > 0;
  }
  if (Array.isArray(value)) {
    return value.some(readsAPath);
  }
  return isJsonRecord(value) && Object.values(value as object).some(readsAPath);
}

/**
 * C120.9 (P20): when the step's `member`, as written, reads a path, what it wrote into `targetId` is
 * a copy of the trigger's subject.
 */
export function copyInto(
  context: ActionContext,
  member: string,
  targetId: string,
): WorkflowEffectCopy | undefined {
  const written = context.step.type === 'action' ? context.step.config[member] : undefined;
  const source = isJsonRecord(context.state.trigger) ? context.state.trigger.id : undefined;
  return readsAPath(written) && typeof source === 'string'
    ? { targetId, sourceSubjectIds: [source] }
    : undefined;
}
