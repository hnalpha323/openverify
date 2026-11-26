/**
 * C137.4, C132.5 (Workflow 8B, `api-cases`): what a bulk action does to one case, in that case's own
 * unit, through the same services as the single routes. Each answers whether the case changed, and a
 * refusal throws the single route's problem, which the job records by its code.
 *
 * - `set-queue` moves the case as `PATCH case-queue-id` does, with `case.queue-updated` and the
 *   queue's policy on entry (C132.2).
 * - `assign` replaces the assignee (C132.5) by C132.3's manual rule: the user is an active person of
 *   the organisation who holds `cases:write` and may see the template (422
 *   `case_assignee_ineligible`, which never says whether the id exists elsewhere); `null` unassigns.
 */
import { manualAssigneeIneligibility } from '@openverify/core';
import {
  hiddenCaseObjectIds,
  roleAssignmentReaches,
  roles,
  updateCaseRow,
  userRoles,
  users,
} from '@openverify/db';
import { and, eq, sql } from 'drizzle-orm';
import { assignOnEntry } from '../assignment/on-entry.js';
import { assertQueueIn } from '../create.js';
import { CaseProblemError } from '../problems.js';
import { historyActor, lockWritableCase, type CaseUnit } from '../shared.js';
import { emitCaseEvent, notify } from '../writes.js';

/** C132.1: the case's queue, `null` taking it out of every queue. */
export async function setCaseQueueInTx(
  unit: CaseUnit,
  id: string,
  queueId: string | null,
): Promise<boolean> {
  const { environmentId } = unit.acting.ctx;
  const row = await lockWritableCase(unit, id);
  if (row.caseQueueId === queueId) {
    return false;
  }
  if (queueId !== null) {
    await assertQueueIn(unit.tx, environmentId, queueId, '/meta/case-queue-id');
  }
  await updateCaseRow(unit.tx, environmentId, id, {
    caseQueueId: queueId,
    updaterType: unit.acting.actor.type,
    updaterId: unit.acting.actor.id,
  });
  await unit.history([
    {
      caseId: id,
      kind: 'queue-changed',
      ...historyActor(unit.acting),
      from: { 'case-queue-id': row.caseQueueId },
      to: { 'case-queue-id': queueId },
      requestId: unit.acting.ctx.requestId ?? null,
    },
  ]);
  await emitCaseEvent(unit, id, 'case.queue-updated');
  if (queueId !== null) {
    const assignee = await assignOnEntry(unit.tx, {
      environmentId,
      caseId: id,
      caseTemplateVersionId: row.caseTemplateVersionId,
      caseQueueId: queueId,
      at: unit.at,
    });
    if (assignee !== null) {
      await emitCaseEvent(unit, id, 'case.assigned');
      await notify(unit, id, 'assigned', [assignee]);
    }
  }
  return true;
}

/** C132.3's manual rule, read for one user and one case. */
async function manualCandidate(unit: CaseUnit, caseId: string, userId: string) {
  const [user] = await unit.tx
    .select({
      active: sql<boolean>`${users.status} = 'active'`,
      // C167.2 (Workflow 9B): a role reaching this environment.
      writes: sql<boolean>`exists (select 1 from ${userRoles} ur join ${roles} r on r.id = ur.role_id
        where ur.user_id = ${users.id} and 'cases:write' = any(r.permissions)
          and ${roleAssignmentReaches(sql`ur`, unit.acting.ctx.environmentId)})`,
    })
    .from(users)
    .where(and(eq(users.organizationId, unit.acting.ctx.organizationId), eq(users.id, userId)))
    .limit(1);
  if (user === undefined) {
    return null;
  }
  const hidden = await hiddenCaseObjectIds(
    unit.tx,
    unit.acting.ctx.environmentId,
    { kind: 'user', userId },
    [caseId],
  );
  return {
    userId,
    active: user.active,
    holdsCasesWrite: user.writes,
    seesTemplate: !hidden.has(caseId),
    paused: false,
    openCount: 0,
    maxOpen: null,
    lastAssignedAt: null,
  };
}

/** C132.5: assigns `userId`, replacing any assignee, or unassigns with `null`. */
export async function assignCaseManuallyInTx(
  unit: CaseUnit,
  id: string,
  userId: string | null,
): Promise<boolean> {
  const { environmentId } = unit.acting.ctx;
  const row = await lockWritableCase(unit, id);
  if (row.assigneeId === userId) {
    return false;
  }
  if (userId !== null) {
    const candidate = await manualCandidate(unit, id, userId);
    if (candidate === null || manualAssigneeIneligibility(candidate) !== null) {
      throw new CaseProblemError(
        'case_assignee_ineligible',
        'This person cannot be assigned this case.',
      );
    }
  }
  await updateCaseRow(unit.tx, environmentId, id, {
    assigneeId: userId,
    assignerType: userId === null ? null : unit.acting.actor.type,
    assignerId: userId === null ? null : unit.acting.actor.id,
    assignedAt: userId === null ? null : unit.at,
    updaterType: unit.acting.actor.type,
    updaterId: unit.acting.actor.id,
  });
  await unit.history([
    {
      caseId: id,
      kind: userId === null ? 'unassigned' : 'assigned',
      ...historyActor(unit.acting),
      from: { 'assignee-id': row.assigneeId },
      to: { 'assignee-id': userId, strategy: 'manual' },
      requestId: unit.acting.ctx.requestId ?? null,
    },
  ]);
  await emitCaseEvent(unit, id, 'case.assigned');
  if (userId !== null) {
    await notify(unit, id, 'assigned', [userId]);
  }
  return true;
}
