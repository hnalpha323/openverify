/**
 * C132.1 (Workflow 8B): what `routes/server/case-queues.ts` calls: queues and their members. Owner
 * `api-queues-sla`; `foundation-8b` (Stage 1b (Q)) froze each name and its route.
 *
 * - A member is an active user of the organisation holding `cases:write` (`case_assignee_ineligible`,
 *   the same refusal whether or not the id names anyone); `max-open` defaults to 50 and `paused` to
 *   false. A queue's policy is one of its environment.
 * - Archiving is permanent (C132.1): the queue's unassigned cases go back to no queue, each with its
 *   history row and `case.queue-updated`; an archived queue takes no change (409) and no new case.
 * - Replacing the members gives back, in the same transaction, the open cases of this queue assigned
 *   to a member who left (C132.6's "left a queue"): each is unassigned (`case.assigned` to nobody) and
 *   offered to the queue's policy again. Deactivation and lost permissions are the sweep's.
 * - Lock order: the queue row, then its cases (the entry path takes a case, then its queue, and only
 *   for an unassigned case, which neither change here locks while it is being entered).
 */
import {
  newId,
  type CaseQueueDocument,
  type CaseQueueListDocument,
  type CaseQueueMemberInput,
  type CreateCaseQueueBody,
  type ListCaseQueuesQuery,
  type SetCaseQueueMembersBody,
  type UpdateCaseQueueBody,
} from '@openverify/contracts';
import { CASE_LIMITS } from '@openverify/core';
import {
  appendCaseHistory,
  createCaseQueueRow,
  getCaseAssignmentPolicyRow,
  getCaseQueueRow,
  getCaseRow,
  listCaseQueueMembersOf,
  listCaseQueueRows,
  lockCaseQueueRow,
  lockQueueCasesAssignedTo,
  lockUnassignedQueueCases,
  replaceCaseQueueMembers,
  updateCaseQueueRow,
  updateCaseRow,
  type CaseQueueRow,
  type Db,
} from '@openverify/db';
import { ConflictError, NotFoundError, UnprocessableContentError } from '../../../errors.js';
import type { ApiDependencies } from '../../context.js';
import { nextLink, pageRequest, withCursor } from '../../pagination.js';
import type { CaseActing } from '../service.js';
import { caseChange, createdAtOf, dateOf, filterList, type CaseUnit } from '../shared.js';
import {
  assertMayHoldCases,
  assignByPolicyInTx,
  writeAssignmentInTx,
} from '../assignment/apply.js';
import { queueAudit } from './audit.js';
import { caseQueueResource } from './resources.js';
import { notifyUser, stageCaseEvent, workOfUnit } from './work.js';

const PATH = '/api/v1/case-queues';
const ATTRIBUTES = '/data/attributes';

async function documentOf(
  db: Db,
  environmentId: string,
  row: CaseQueueRow,
): Promise<CaseQueueDocument> {
  const members = await listCaseQueueMembersOf(db, environmentId, [row.id]);
  return { data: caseQueueResource(row, members) };
}

const membersOf = (members: readonly CaseQueueMemberInput[]) =>
  members.map((member) => ({
    userId: member['user-id'],
    maxOpen: member['max-open'] ?? CASE_LIMITS['member-max-open-default'].value,
    paused: member.paused ?? false,
  }));

async function assertMembers(
  db: Db,
  acting: CaseActing,
  members: readonly CaseQueueMemberInput[],
): Promise<void> {
  await assertMayHoldCases(
    db,
    acting.ctx.environmentId,
    acting.ctx.organizationId,
    members.map((member) => member['user-id']),
    (index) => `${ATTRIBUTES}/members/${String(index)}/user-id`,
  );
}

async function assertPolicy(db: Db, environmentId: string, policyId: string | null | undefined) {
  if (policyId === null || policyId === undefined) {
    return;
  }
  if ((await getCaseAssignmentPolicyRow(db, environmentId, policyId)) === null) {
    throw new UnprocessableContentError('The policy is not one of this environment.', [
      {
        location: 'body',
        pointer: `${ATTRIBUTES}/case-assignment-policy-id`,
        detail: 'Names no assignment policy of this environment.',
      },
    ]);
  }
}

/** `GET /case-queues`: newest first (C1); `filter[member-id]` reads a person's queues. */
export async function listCaseQueues(
  deps: ApiDependencies,
  acting: CaseActing,
  query: ListCaseQueuesQuery,
): Promise<CaseQueueListDocument> {
  const { environmentId } = acting.ctx;
  const { start, end } = createdAtOf(query);
  const page = await withCursor(() =>
    listCaseQueueRows(
      deps.db,
      environmentId,
      {
        statuses: filterList(query['filter[status]']),
        memberIds: filterList(query['filter[member-id]']),
        createdAtStart: dateOf(start),
        createdAtEnd: dateOf(end),
      },
      pageRequest(query),
    ),
  );
  const members = await listCaseQueueMembersOf(
    deps.db,
    environmentId,
    page.items.map(({ id }) => id),
  );
  return {
    data: page.items.map((row) =>
      caseQueueResource(
        row,
        members.filter(({ caseQueueId }) => caseQueueId === row.id),
      ),
    ),
    links: {
      next: nextLink(
        PATH,
        {
          'filter[status]': query['filter[status]'],
          'filter[member-id]': query['filter[member-id]'],
          'filter[created-at-start]': start,
          'filter[created-at-end]': end,
        },
        query,
        page.next,
      ),
    },
  };
}

/** `POST /case-queues`: each member must hold `cases:write` (`case_assignee_ineligible`). */
export async function createCaseQueue(
  deps: ApiDependencies,
  acting: CaseActing,
  body: CreateCaseQueueBody,
): Promise<CaseQueueDocument> {
  const attributes = body.data.attributes;
  const { environmentId } = acting.ctx;
  const members = attributes.members ?? [];
  const row = await caseChange(deps, acting, async (unit) => {
    await assertPolicy(unit.tx, environmentId, attributes['case-assignment-policy-id']);
    await assertMembers(unit.tx, acting, members);
    const created = await createCaseQueueRow(unit.tx, environmentId, {
      id: newId('cqueue'),
      name: attributes.name,
      caseAssignmentPolicyId: attributes['case-assignment-policy-id'] ?? null,
    });
    await replaceCaseQueueMembers(unit.tx, environmentId, created.id, membersOf(members));
    await unit.audit(
      queueAudit('case-queue.created', created.id, {
        'member-count': members.length,
        'case-assignment-policy-id': created.caseAssignmentPolicyId,
      }),
    );
    return created;
  });
  return documentOf(deps.db, environmentId, row);
}

export async function getCaseQueue(
  deps: ApiDependencies,
  acting: CaseActing,
  id: string,
): Promise<CaseQueueDocument> {
  const row = await getCaseQueueRow(deps.db, acting.ctx.environmentId, id);
  if (row === null) {
    throw new NotFoundError(`Case queue ${id} was not found.`);
  }
  return documentOf(deps.db, acting.ctx.environmentId, row);
}

/** The queue under its lock, refusing an archived one. */
async function lockActiveQueue(unit: CaseUnit, id: string): Promise<CaseQueueRow> {
  const row = await lockCaseQueueRow(unit.tx, unit.acting.ctx.environmentId, id);
  if (row === null) {
    throw new NotFoundError(`Case queue ${id} was not found.`);
  }
  if (row.status === 'archived') {
    throw new ConflictError('An archived queue takes no change.');
  }
  return row;
}

/** C132.1: an archived queue's unassigned cases go back to no queue. Answers how many. */
async function returnUnassignedCases(unit: CaseUnit, queueId: string): Promise<number> {
  const { environmentId } = unit.acting.ctx;
  const ids = await lockUnassignedQueueCases(unit.tx, environmentId, queueId);
  const work = workOfUnit(unit);
  for (const id of ids) {
    await updateCaseRow(unit.tx, environmentId, id, {
      caseQueueId: null,
      updaterType: unit.acting.actor.type,
      updaterId: unit.acting.actor.id,
    });
    await appendCaseHistory(unit.tx, environmentId, [
      {
        caseId: id,
        kind: 'queue-changed',
        ...work.actor,
        from: { 'case-queue-id': queueId },
        to: { 'case-queue-id': null, reason: 'queue-archived' },
        requestId: work.requestId,
      },
    ]);
    await stageCaseEvent(work, id, 'case.queue-updated');
  }
  return ids.length;
}

/** C132.1: archiving is permanent and gives the queue's unassigned cases back to no queue. */
export async function updateCaseQueue(
  deps: ApiDependencies,
  acting: CaseActing,
  id: string,
  body: UpdateCaseQueueBody,
): Promise<CaseQueueDocument> {
  const attributes = body.data.attributes;
  const { environmentId } = acting.ctx;
  const row = await caseChange(deps, acting, async (unit) => {
    await lockActiveQueue(unit, id);
    await assertPolicy(unit.tx, environmentId, attributes['case-assignment-policy-id']);
    const updated = await updateCaseQueueRow(unit.tx, environmentId, id, {
      ...(attributes.name === undefined ? {} : { name: attributes.name }),
      ...(attributes['case-assignment-policy-id'] === undefined
        ? {}
        : { caseAssignmentPolicyId: attributes['case-assignment-policy-id'] }),
      ...(attributes.status === 'archived' ? { archivedAt: unit.at } : {}),
    });
    if (updated === null) {
      throw new NotFoundError(`Case queue ${id} was not found.`);
    }
    const changed = Object.keys(attributes)
      .filter((key) => key !== 'status')
      .sort();
    if (changed.length > 0) {
      await unit.audit(queueAudit('case-queue.updated', id, { attributes: changed }));
    }
    if (attributes.status === 'archived') {
      const returned = await returnUnassignedCases(unit, id);
      await unit.audit(queueAudit('case-queue.archived', id, { 'returned-case-count': returned }));
    }
    return updated;
  });
  return documentOf(deps.db, environmentId, row);
}

/**
 * C132.1, C132.6: the whole list replaced; the open cases of this queue assigned to a member who left
 * are unassigned and offered to the queue's policy again.
 */
export async function setCaseQueueMembers(
  deps: ApiDependencies,
  acting: CaseActing,
  id: string,
  body: SetCaseQueueMembersBody,
): Promise<CaseQueueDocument> {
  const members = body.data.attributes.members;
  const { environmentId } = acting.ctx;
  const row = await caseChange(deps, acting, async (unit) => {
    const queue = await lockActiveQueue(unit, id);
    await assertMembers(unit.tx, acting, members);
    const { removedUserIds } = await replaceCaseQueueMembers(
      unit.tx,
      environmentId,
      id,
      membersOf(members),
    );
    const caseIds = await lockQueueCasesAssignedTo(unit.tx, environmentId, id, removedUserIds);
    const work = workOfUnit(unit);
    for (const caseId of caseIds) {
      const current = await getCaseRow(unit.tx, environmentId, caseId);
      if (current === null) {
        continue;
      }
      await writeAssignmentInTx(work, current, {
        assigneeId: null,
        assigner: null,
        strategy: 'manual',
        reason: 'member-left',
        updater: { type: unit.acting.actor.type, id: unit.acting.actor.id },
      });
      await stageCaseEvent(work, caseId, 'case.assigned');
      const assignee = await assignByPolicyInTx(work, caseId);
      if (assignee !== null) {
        await stageCaseEvent(work, caseId, 'case.assigned');
        await notifyUser(work, caseId, 'assigned', assignee);
      }
    }
    await unit.audit(
      queueAudit('case-queue.members-set', id, {
        'member-count': members.length,
        'removed-count': removedUserIds.length,
        'returned-case-count': caseIds.length,
      }),
    );
    return queue;
  });
  const fresh = (await getCaseQueueRow(deps.db, environmentId, row.id)) ?? row;
  return documentOf(deps.db, environmentId, fresh);
}
