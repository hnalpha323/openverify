/**
 * C140.3 (Workflow 8B, `api-case-workflows`): the eight case steps, each through the C131-C136
 * services in the effect's transaction, as the run (`./unit.ts`), so each is exactly once (C117.5):
 * the case write, its history, its events, its audit entry, the effect row and the step's completion
 * commit together, a lost claim rolls them all back, and a repeated attempt answers the first result.
 *
 * - `create_case`: the one creation path (`createCaseWithDeps`), under the shared `case-create`
 *   budget (C143.3), shared with `POST /cases` and the graph's bulk action: past it, or when the
 *   limiter cannot answer, it never fails open and makes nothing, answering `rate_limited` as a
 *   retryable failure. The engine retries only an entry that allows it, and the case entries allow
 *   none (`createCaseActionEntries`), so today the step ends `rate_limited` rather than deferring:
 *   defer mode waits on the entry's retry (a contract deviation). The case carries its step
 *   (C117.5), and under a transaction's trigger it is that transaction's child (C127.7).
 * - `assign_case`: a person by C132.3's manual rule, or a policy the step names (C140.3), which may
 *   find nobody: then the case waits for a pull, and the output says so with a `null` assignee.
 * - `update_case_status`: the template's machine (C131.1); a resolution decides nothing else (C131.3).
 * - `add_case_comment`, `add_case_to_queue`, `attach_objects_to_case`: the single routes' services.
 * - `set_case_sla`, `clear_case_sla`: the public wall-clock deadline (C133.1) in minutes, hours or
 *   days. A deadline a pausing status would hold back has no instant to answer, so the step refuses
 *   it rather than answer one (`action_refused`).
 * - A change that changes nothing is `no_change`. Every refusal is thrown, so nothing commits.
 */
import {
  addCaseCommentConfigSchema,
  addCaseToQueueConfigSchema,
  assignCaseConfigSchema,
  attachObjectsToCaseConfigSchema,
  clearCaseSlaConfigSchema,
  createCaseConfigSchema,
  setCaseSlaConfigSchema,
  updateCaseStatusConfigSchema,
  type CASE_SLA_UNITS,
  type CaseActionKey,
} from '@openverify/workflow-engine/actions';
import { CASE_LIMITS, type ApiScope } from '@openverify/core';
import type { SetCaseStatusBody } from '@openverify/contracts';
import {
  caseComments,
  countCaseObjects,
  getCaseAssignmentPolicyRow,
  getCaseTemplateVersionRow,
  recordTransactionChild,
  type Case,
  type Db,
} from '@openverify/db';
import { and, desc, eq } from 'drizzle-orm';
import type { StagedEvent } from '../../../events/index.js';
import { assignByPolicyInTx } from '../../../services/cases/assignment/apply.js';
import { assignCaseInTx } from '../../../services/cases/assignment/service.js';
import { setCaseQueueInTx } from '../../../services/cases/bulk/apply.js';
import { createCaseWithDeps } from '../../../services/cases/create.js';
import { setPublicSlaInTx } from '../../../services/cases/public-sla.js';
import { queueAudit } from '../../../services/cases/queues/audit.js';
import { notifyUser, stageCaseEvent, workOfUnit } from '../../../services/cases/queues/work.js';
import { addCaseObjectsInTx, setCaseStatusInTx } from '../../../services/cases/service.js';
import { statusDefinitionOf, type CaseUnit } from '../../../services/cases/shared.js';
import { addCommentInTx, emitCaseEvent } from '../../../services/cases/writes.js';
import {
  ActionStepError,
  type ActionContext,
  type ActionResult,
  type TransactionActionHandler,
} from '../../engine/action-port.js';
import { consumeBudget, workflowPolicyRule } from '../https/budgets.js';
import { triggerTransactionOf } from '../children.js';
import { apiDepsOf, configOf } from '../shared.js';
import {
  assertActiveQueue,
  caseNow,
  copyInto,
  lockedCase,
  refusingCase,
  runCaseUnit,
} from './unit.js';

const SECONDS: Readonly<Record<(typeof CASE_SLA_UNITS)[number], number>> = {
  minutes: 60,
  hours: 3_600,
  days: 86_400,
};

/** C133.1: a step's SLA in seconds; a rendered value that is not a whole number is refused. */
function slaSecondsOf(sla: { value: number | string; unit: (typeof CASE_SLA_UNITS)[number] }) {
  const value = typeof sla.value === 'number' ? sla.value : Number(sla.value);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ActionStepError('action_input_invalid');
  }
  return value * SECONDS[sla.unit];
}

const outcomeOf = (changed: boolean) => (changed ? 'applied' : 'no_change');

const written = (caseId: string) => [{ subjectId: caseId, source: 'written' as const }];

/** C122.4: a step acts within its run's frozen grant. */
function assertGrantHolds(context: ActionContext, scope: ApiScope): void {
  if (!context.grant.scopes.includes(scope)) {
    throw new ActionStepError('run_grant_insufficient');
  }
}

/** The step's unit, and the result once `work` has written through it. */
async function inUnit(
  tx: Db,
  context: ActionContext,
  work: (unit: CaseUnit) => Promise<Omit<Extract<ActionResult, { kind: 'succeeded' }>, 'kind'>>,
): Promise<ActionResult> {
  const staged: StagedEvent[] = [];
  const result = await work(runCaseUnit(tx, context, staged));
  return { kind: 'succeeded', ...result, staged: [...staged, ...(result.staged ?? [])] };
}

function caseStep(
  key: CaseActionKey,
  execute: (tx: Db, context: ActionContext) => Promise<ActionResult>,
): TransactionActionHandler {
  return { key, version: 1, shape: 'transaction', execute };
}

const CREATE_CASE = caseStep('create_case', async (tx, context) => {
  const config = configOf(context, createCaseConfigSchema);
  const deps = apiDepsOf(context);
  const { environmentId } = context;
  await consumeBudget(
    deps.rateLimiter,
    `case-create:${environmentId}`,
    workflowPolicyRule('case-create'),
  );
  const queueId = config['case-queue-id'];
  if (queueId !== undefined) {
    await assertActiveQueue(tx, context, queueId);
  }
  const { ctx, actor, mask } = context.acting;
  const created = await refusingCase(() =>
    createCaseWithDeps(tx, deps, {
      environmentId,
      caseTemplateId: config['case-template-id'],
      creator: { type: 'workflow-run', id: context.runId },
      ...(queueId === undefined ? {} : { caseQueueId: queueId }),
      fields: config.fields ?? {},
      tags: config.tags ?? [],
      objectIds: config['object-ids'] ?? [],
      slaExpiresInSeconds: config.sla === undefined ? null : slaSecondsOf(config.sla),
      workflowRunStepId: context.stepId,
      requestId: null,
      acting: { ctx, actor, mask, principal: null },
    }),
  );
  return inUnit(tx, context, async (unit) => {
    const transactionId = triggerTransactionOf(context);
    if (transactionId !== null) {
      await recordTransactionChild(tx, environmentId, {
        transactionId,
        childType: 'case',
        childId: created.id,
        workflowRunId: context.runId,
      });
    }
    await unit.audit({
      action: 'case.created',
      resourceType: 'case',
      resourceId: created.id,
      metadata: {
        'case-template-id': config['case-template-id'],
        'held-object-count': created.heldObjects.length,
      },
    });
    const row = await caseNow(unit, created.id);
    const copy = copyInto(context, 'fields', created.id);
    return {
      output: { 'case-id': created.id, name: row.name, status: row.status, outcome: 'applied' },
      staged: created.staged,
      subjects: written(created.id),
      ...(copy === undefined ? {} : { copy }),
    };
  });
});

/** C132.2, C140.3: the named policy's choice on an unassigned, open case. */
async function assignByPolicy(unit: CaseUnit, row: Case, policyId: string) {
  const policy = await getCaseAssignmentPolicyRow(unit.tx, unit.acting.ctx.environmentId, policyId);
  if (policy === null) {
    throw new ActionStepError('object_not_found');
  }
  if (row.assigneeId !== null) {
    return { assigneeId: row.assigneeId, changed: false };
  }
  const work = workOfUnit(unit);
  const assigneeId = await refusingCase(() => assignByPolicyInTx(work, row.id, { policyId }));
  if (assigneeId === null) {
    return { assigneeId: null, changed: false };
  }
  await stageCaseEvent(work, row.id, 'case.assigned');
  await notifyUser(work, row.id, 'assigned', assigneeId);
  await unit.audit(
    queueAudit('case.assigned', row.id, {
      strategy: policy.distribution,
      'assignee-id': assigneeId,
    }),
  );
  return { assigneeId, changed: true };
}

const ASSIGN_CASE = caseStep('assign_case', (tx, context) => {
  const config = configOf(context, assignCaseConfigSchema);
  const caseId = config['case-id'];
  return inUnit(tx, context, async (unit) => {
    const row = await lockedCase(unit, caseId);
    const userId = config['user-id'];
    const policyId = config['assignment-policy-id'];
    let answer: { assigneeId: string | null; changed: boolean };
    if (userId !== undefined) {
      assertGrantHolds(context, 'cases:assign');
      const changed = await refusingCase(() =>
        assignCaseInTx(unit, caseId, { userId }, { mayAssignOthers: true }),
      );
      answer = { assigneeId: userId, changed };
    } else if (policyId !== undefined) {
      answer = await assignByPolicy(unit, row, policyId);
    } else {
      throw new ActionStepError('action_input_invalid');
    }
    return {
      output: {
        'case-id': caseId,
        'assignee-id': answer.assigneeId,
        outcome: outcomeOf(answer.changed),
      },
      subjects: written(caseId),
    };
  });
});

/** The comment this run's step just wrote on the case: the run's newest. */
async function commentWrittenBy(unit: CaseUnit, caseId: string, runId: string) {
  const [comment] = await unit.tx
    .select({ id: caseComments.id })
    .from(caseComments)
    .where(
      and(
        eq(caseComments.environmentId, unit.acting.ctx.environmentId),
        eq(caseComments.caseId, caseId),
        eq(caseComments.commenterType, 'workflow-run'),
        eq(caseComments.commenterId, runId),
      ),
    )
    .orderBy(desc(caseComments.id))
    .limit(1);
  return comment?.id ?? null;
}

const UPDATE_CASE_STATUS = caseStep('update_case_status', (tx, context) => {
  const config = configOf(context, updateCaseStatusConfigSchema);
  const caseId = config['case-id'];
  const meta: SetCaseStatusBody['meta'] = {
    status: config.status,
    ...(config.resolution === undefined ? {} : { resolution: config.resolution }),
    ...(config.comment === undefined ? {} : { comment: config.comment }),
    ...(config['status-tag'] === undefined ? {} : { 'status-tag': config['status-tag'] }),
  };
  return inUnit(tx, context, async (unit) => {
    const changed = await refusingCase(() => setCaseStatusInTx(unit, caseId, meta));
    const row = await caseNow(unit, caseId);
    const commentId =
      changed && config.comment !== undefined
        ? await commentWrittenBy(unit, caseId, context.runId)
        : null;
    const copy = commentId === null ? undefined : copyInto(context, 'comment', commentId);
    return {
      output: {
        'case-id': caseId,
        status: row.status,
        'status-category': row.statusCategory,
        resolution: row.resolution,
        outcome: outcomeOf(changed),
      },
      subjects: written(caseId),
      ...(copy === undefined ? {} : { copy }),
    };
  });
});

const ADD_CASE_COMMENT = caseStep('add_case_comment', (tx, context) => {
  const config = configOf(context, addCaseCommentConfigSchema);
  const caseId = config['case-id'];
  if (config.message.length > CASE_LIMITS['comment-characters'].value) {
    throw new ActionStepError('action_input_invalid');
  }
  return inUnit(tx, context, async (unit) => {
    const row = await lockedCase(unit, caseId);
    const comment = await refusingCase(() =>
      addCommentInTx(unit, row, config.message, { workflowRunStepId: context.stepId }),
    );
    await unit.audit({
      action: 'case.comment-added',
      resourceType: 'case',
      resourceId: caseId,
      metadata: { 'comment-id': comment.id, 'mention-count': comment.mentions.length },
    });
    const copy = copyInto(context, 'message', comment.id);
    return {
      output: { 'case-id': caseId, 'comment-id': comment.id, outcome: 'applied' },
      subjects: written(caseId),
      ...(copy === undefined ? {} : { copy }),
    };
  });
});

/** C131.5: a change with no event of its own is `case.updated`, audited by the attributes it set. */
async function caseUpdated(unit: CaseUnit, caseId: string, attribute: string): Promise<void> {
  await emitCaseEvent(unit, caseId, 'case.updated');
  await unit.audit({
    action: 'case.updated',
    resourceType: 'case',
    resourceId: caseId,
    metadata: { attributes: [attribute] },
  });
}

const ADD_CASE_TO_QUEUE = caseStep('add_case_to_queue', async (tx, context) => {
  const config = configOf(context, addCaseToQueueConfigSchema);
  const caseId = config['case-id'];
  const queueId = config['case-queue-id'];
  return inUnit(tx, context, async (unit) => {
    await lockedCase(unit, caseId);
    await assertActiveQueue(tx, context, queueId);
    const changed = await refusingCase(() => setCaseQueueInTx(unit, caseId, queueId));
    if (changed) {
      await unit.audit({
        action: 'case.updated',
        resourceType: 'case',
        resourceId: caseId,
        metadata: { attributes: ['case-queue-id'] },
      });
    }
    return {
      output: { 'case-id': caseId, 'case-queue-id': queueId, outcome: outcomeOf(changed) },
      subjects: written(caseId),
    };
  });
});

const ATTACH_OBJECTS_TO_CASE = caseStep('attach_objects_to_case', (tx, context) => {
  const config = configOf(context, attachObjectsToCaseConfigSchema);
  const caseId = config['case-id'];
  return inUnit(tx, context, async (unit) => {
    await lockedCase(unit, caseId);
    const before = await countCaseObjects(tx, context.environmentId, caseId);
    const changed = await refusingCase(() =>
      addCaseObjectsInTx(unit, caseId, config['object-ids']),
    );
    const after = await countCaseObjects(tx, context.environmentId, caseId);
    return {
      output: { 'case-id': caseId, 'attached-count': after - before, outcome: outcomeOf(changed) },
      subjects: written(caseId),
    };
  });
});

/** Whether the case's status holds its SLA back (C133.5). */
async function pausesSla(unit: CaseUnit, row: Case): Promise<boolean> {
  const version = await getCaseTemplateVersionRow(
    unit.tx,
    unit.acting.ctx.environmentId,
    row.caseTemplateVersionId,
  );
  const status = version?.statuses.map(statusDefinitionOf).find(({ key }) => key === row.status);
  return status?.['pauses-sla'] ?? false;
}

const SET_CASE_SLA = caseStep('set_case_sla', (tx, context) => {
  const config = configOf(context, setCaseSlaConfigSchema);
  const caseId = config['case-id'];
  const seconds = slaSecondsOf(config.sla);
  return inUnit(tx, context, async (unit) => {
    const row = await lockedCase(unit, caseId);
    // K8-26: a pausing status holds the SLA paused, as `PATCH` does; its deadline waits for the case
    // to leave the status, so the output says `paused` with no deadline.
    const paused = await pausesSla(unit, row);
    const changed = await refusingCase(() => setPublicSlaInTx(unit, row, seconds, paused));
    if (changed) {
      await caseUpdated(unit, caseId, 'sla-expires-in-seconds');
    }
    const now = await caseNow(unit, caseId);
    const withoutDeadline = now.slaState === 'paused' || now.slaState === 'none';
    if (withoutDeadline !== (now.slaExpiresAt === null)) {
      throw new ActionStepError('action_refused');
    }
    return {
      output: {
        'case-id': caseId,
        'sla-expires-at': now.slaExpiresAt?.toISOString() ?? null,
        'sla-state': now.slaState,
        outcome: outcomeOf(changed),
      },
      subjects: written(caseId),
    };
  });
});

const CLEAR_CASE_SLA = caseStep('clear_case_sla', (tx, context) => {
  const config = configOf(context, clearCaseSlaConfigSchema);
  const caseId = config['case-id'];
  return inUnit(tx, context, async (unit) => {
    const row = await lockedCase(unit, caseId);
    const changed = await refusingCase(() => setPublicSlaInTx(unit, row, null, false));
    if (changed) {
      await caseUpdated(unit, caseId, 'sla-expires-in-seconds');
    }
    return {
      output: { 'case-id': caseId, outcome: outcomeOf(changed) },
      subjects: written(caseId),
    };
  });
});

/** The eight, by key (C140.3). */
export const CASE_STEP_HANDLERS: readonly TransactionActionHandler[] = [
  CREATE_CASE,
  ASSIGN_CASE,
  UPDATE_CASE_STATUS,
  ADD_CASE_COMMENT,
  ADD_CASE_TO_QUEUE,
  ATTACH_OBJECTS_TO_CASE,
  SET_CASE_SLA,
  CLEAR_CASE_SLA,
];
