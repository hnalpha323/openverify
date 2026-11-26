/**
 * C132.2-C132.4, C132.6 (Workflow 8B, `api-queues-sla`): writing an assignment, and running a policy.
 *
 * - Every assignment writes the assignee, `assigned-at` and the assigner (a policy by its `cap_` id, a
 *   user, a key or a run), and a history row with the strategy and its inputs (ids and counts, never
 *   a value), and starts a policy SLA whose version starts it on assignment. Unassigning clears the
 *   three and names, in the history row, what was there. `case.assigned` is the caller's to stage,
 *   because `assignOnEntry`'s caller stages its own.
 * - A policy runs under a lock (C132.3): the queue row when the case is in a queue (whose policy
 *   applies), else the policy row (the version's policy, its own cursor). The candidates are the
 *   policy's agents, or the queue's members, read under that lock with their open cases;
 *   `case-logic`'s `selectAssignee` chooses, and round-robin's cursor is stored on the row locked.
 *   An assigned, resolved or redacted case, an archived queue, or no policy, assigns nobody.
 */
import {
  manualAssigneeIneligibility,
  selectAssignee,
  type CaseAssignerType,
  type CaseAssignmentCandidate,
  type CaseAssignmentInputs,
  type CaseAssignmentStrategy,
} from '@openverify/core';
import {
  auditLogs,
  caseInquiries,
  getCaseAssignmentPolicyRow,
  getCaseRow,
  getCaseTemplateVersionRow,
  listCaseQueueMembers,
  lockCaseAssignmentPolicyRow,
  lockCaseQueueRow,
  readCaseAssigneeFacts,
  updateCaseAssignmentPolicyRow,
  updateCaseQueueRow,
  updateCaseRow,
  appendCaseHistory,
  type Case,
  type CaseQueueMemberRow,
  type Db,
} from '@openverify/db';
import { and, asc, desc, eq } from 'drizzle-orm';
import { CaseProblemError } from '../problems.js';
import { startPolicySlaInTx } from '../sla/policy-sla.js';
import type { QueueWork } from '../queues/work.js';

const INELIGIBLE = 'That person cannot be assigned this case.';

/** C132.3: the refusal of a person, the same whatever the reason and whether they exist. */
export const assigneeIneligible = (pointer: string) =>
  new CaseProblemError('case_assignee_ineligible', INELIGIBLE, {
    errors: [{ location: 'body', pointer, detail: 'cannot be assigned this case' }],
  });

/**
 * C132.1, C132.2: each of `userIds` is an active user of the organisation holding `cases:write`.
 * @throws {CaseProblemError} `case_assignee_ineligible` naming the first who is not.
 */
export async function assertMayHoldCases(
  db: Db,
  environmentId: string,
  organizationId: string,
  userIds: readonly string[],
  pointerOf: (index: number) => string,
): Promise<void> {
  const facts = await readCaseAssigneeFacts(db, {
    environmentId,
    organizationId,
    caseTemplateId: null,
    userIds,
  });
  const byId = new Map(facts.map((fact) => [fact.userId, fact]));
  for (const [index, userId] of userIds.entries()) {
    const fact = byId.get(userId);
    if (fact === undefined || manualAssigneeIneligibility(fact) !== null) {
      throw assigneeIneligible(pointerOf(index));
    }
  }
}

/** The candidates a policy weighs, in the order of `userIds`; an unknown id is an inactive one. */
export async function candidatesFor(
  db: Db,
  input: {
    environmentId: string;
    organizationId: string;
    caseTemplateId: string;
    userIds: readonly string[];
    members: readonly CaseQueueMemberRow[];
  },
): Promise<CaseAssignmentCandidate[]> {
  const facts = await readCaseAssigneeFacts(db, input);
  const byId = new Map(facts.map((fact) => [fact.userId, fact]));
  const members = new Map(input.members.map((member) => [member.userId, member]));
  return input.userIds.map((userId) => {
    const fact = byId.get(userId);
    const member = members.get(userId);
    return {
      userId,
      active: fact?.active ?? false,
      holdsCasesWrite: fact?.holdsCasesWrite ?? false,
      seesTemplate: fact?.seesTemplate ?? false,
      paused: member?.paused ?? false,
      openCount: fact?.openCount ?? 0,
      maxOpen: member?.maxOpen ?? null,
      lastAssignedAt: fact?.lastAssignedAt ?? null,
    };
  });
}

export interface AssignmentChange {
  /** `null` unassigns. */
  assigneeId: string | null;
  assigner: { type: CaseAssignerType; id: string } | null;
  strategy: CaseAssignmentStrategy;
  /** Ids and counts the history row keeps beside the strategy. */
  inputs?: CaseAssignmentInputs;
  /** Why an unassignment happened, when it was not by hand. */
  reason?: string;
  updater?: { type: Case['updaterType']; id: string } | null;
}

/**
 * Writes an assignment of a locked case, its history row, and a policy SLA that starts on
 * assignment. Answers whether anything changed: the same assignee is no change.
 */
export async function writeAssignmentInTx(
  work: QueueWork,
  row: Case,
  change: AssignmentChange,
): Promise<boolean> {
  if (row.assigneeId === change.assigneeId) {
    return false;
  }
  const assigned = change.assigneeId !== null;
  await updateCaseRow(work.tx, work.environmentId, row.id, {
    assigneeId: change.assigneeId,
    assignerType: assigned ? (change.assigner?.type ?? null) : null,
    assignerId: assigned ? (change.assigner?.id ?? null) : null,
    assignedAt: assigned ? work.at : null,
    ...(change.updater === undefined || change.updater === null
      ? {}
      : { updaterType: change.updater.type, updaterId: change.updater.id }),
  });
  await appendCaseHistory(work.tx, work.environmentId, [
    assigned
      ? {
          caseId: row.id,
          kind: 'assigned',
          ...work.actor,
          from: { 'assignee-id': row.assigneeId },
          to: { 'assignee-id': change.assigneeId, strategy: change.strategy, ...change.inputs },
          requestId: work.requestId,
        }
      : {
          caseId: row.id,
          kind: 'unassigned',
          ...work.actor,
          from: { 'assignee-id': row.assigneeId },
          to:
            change.reason === undefined ? { strategy: change.strategy } : { reason: change.reason },
          requestId: work.requestId,
        },
  ]);
  if (assigned) {
    const version = await getCaseTemplateVersionRow(
      work.tx,
      work.environmentId,
      row.caseTemplateVersionId,
    );
    if (version !== null) {
      await startPolicySlaInTx(work, row.id, version, ['assigned']);
    }
  }
  return true;
}

/** C132.3 inquiry-creator: the user whose audit entry created the case's first held inquiry. */
async function inquiryCreatorOf(db: Db, environmentId: string, caseId: string) {
  const [first] = await db
    .select({ inquiryId: caseInquiries.inquiryId })
    .from(caseInquiries)
    .where(and(eq(caseInquiries.environmentId, environmentId), eq(caseInquiries.caseId, caseId)))
    .orderBy(asc(caseInquiries.createdAt), asc(caseInquiries.inquiryId))
    .limit(1);
  if (first === undefined) {
    return null;
  }
  const [created] = await db
    .select({ actorType: auditLogs.actorType, actorId: auditLogs.actorId })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.environmentId, environmentId),
        eq(auditLogs.resourceType, 'inquiry'),
        eq(auditLogs.resourceId, first.inquiryId),
        eq(auditLogs.action, 'inquiry.created'),
      ),
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(1);
  return created?.actorType === 'user' ? created.actorId : null;
}

/**
 * C132.2, C132.3: runs the case's policy (its queue's, else its version's, or the one a step names,
 * C140.3) on an unassigned, open, unredacted case the caller has locked, and assigns as it chooses.
 * Answers the user assigned, or `null`. Locks the queue row (or the policy row, for a case with no
 * queue or a named policy) after the case's.
 */
export async function assignByPolicyInTx(
  work: QueueWork,
  caseId: string,
  options: { policyId?: string } = {},
): Promise<string | null> {
  const { tx, environmentId } = work;
  const row = await getCaseRow(tx, environmentId, caseId);
  if (row === null) {
    return null;
  }
  if (row.assigneeId !== null || row.statusCategory === 'end' || row.redactedAt !== null) {
    return null;
  }
  const version = await getCaseTemplateVersionRow(tx, environmentId, row.caseTemplateVersionId);
  let members: CaseQueueMemberRow[] = [];
  let cursorOwner: { kind: 'queue' | 'policy'; id: string };
  let policyId: string | null;
  let queueCursor: string | null = null;
  if (options.policyId !== undefined) {
    // C140.3: a policy a step names, on its own cursor; the queue's members are its agents when it
    // lists none, read under the queue's lock as an entry reads them.
    policyId = options.policyId;
    cursorOwner = { kind: 'policy', id: policyId };
    if (row.caseQueueId !== null) {
      const queue = await lockCaseQueueRow(tx, environmentId, row.caseQueueId);
      if (queue?.status === 'active') {
        members = await listCaseQueueMembers(tx, environmentId, queue.id);
      }
    }
  } else if (row.caseQueueId !== null) {
    const queue = await lockCaseQueueRow(tx, environmentId, row.caseQueueId);
    if (queue === null) {
      return null;
    }
    if (queue.status !== 'active') {
      return null;
    }
    policyId = queue.caseAssignmentPolicyId ?? version?.assignmentPolicyId ?? null;
    members = await listCaseQueueMembers(tx, environmentId, queue.id);
    cursorOwner = { kind: 'queue', id: queue.id };
    queueCursor = queue.roundRobinCursor;
  } else {
    policyId = version?.assignmentPolicyId ?? null;
    cursorOwner = { kind: 'policy', id: policyId ?? '' };
  }
  if (policyId === null) {
    return null;
  }
  const policy =
    cursorOwner.kind === 'policy'
      ? await lockCaseAssignmentPolicyRow(tx, environmentId, policyId)
      : await getCaseAssignmentPolicyRow(tx, environmentId, policyId);
  if (policy === null) {
    return null;
  }
  const cursor = cursorOwner.kind === 'queue' ? queueCursor : policy.roundRobinCursor;
  const userIds = policy.agentIds ?? members.map(({ userId }) => userId);
  const candidates = await candidatesFor(tx, {
    environmentId,
    organizationId: work.organizationId,
    caseTemplateId: row.caseTemplateId,
    userIds,
    members,
  });
  const creatorUserId =
    policy.distribution === 'inquiry-creator'
      ? await inquiryCreatorOf(tx, environmentId, row.id)
      : row.creatorType === 'user'
        ? row.creatorId
        : null;
  const selection = selectAssignee(policy.distribution, {
    candidates,
    limits: { maxCapacity: policy.maxCapacity },
    cursor,
    creatorUserId,
  });
  if (policy.distribution === 'round-robin' && selection.cursor !== cursor) {
    if (cursorOwner.kind === 'queue') {
      await updateCaseQueueRow(tx, environmentId, cursorOwner.id, {
        roundRobinCursor: selection.cursor,
      });
    } else {
      await updateCaseAssignmentPolicyRow(tx, environmentId, policy.id, {
        roundRobinCursor: selection.cursor,
      });
    }
  }
  if (!selection.assigned) {
    return null;
  }
  await writeAssignmentInTx(
    { ...work, actor: { actorType: 'case-assignment-policy', actorId: policy.id } },
    row,
    {
      assigneeId: selection.userId,
      assigner: { type: 'case-assignment-policy', id: policy.id },
      strategy: selection.strategy,
      inputs: selection.inputs,
    },
  );
  return selection.userId;
}
