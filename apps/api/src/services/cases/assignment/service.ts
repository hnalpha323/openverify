/**
 * C132.3, C132.4 (Workflow 8B): what `routes/server/case-assignment.ts` calls: a manual assignment and
 * the pull. Owner `api-queues-sla`; `foundation-8b` froze the names and routes.
 *
 * - The route asks `cases:write`; assigning anyone but oneself, or unassigning another's case, also
 *   needs `cases:assign` (C129.5), checked before any address is looked up, so a caller without it
 *   cannot learn whether an address belongs to someone.
 * - The assignee must be an active user of the organisation holding `cases:write` who may see the
 *   template (`case-logic`'s `manualAssigneeIneligibility`); queues and capacity do not bind a
 *   person's choice. Every refusal is the same `case_assignee_ineligible`.
 * - The pull is a user's: the most urgent unassigned case of the queues they are a member of (or of
 *   those they name), that they may see (C129.4), `FOR UPDATE SKIP LOCKED`.
 * - Each assignment stages `case.assigned` (to nobody for an unassignment, C132.6), notifies a new
 *   assignee other than the actor, and is audited with its strategy and assignee id only (P19).
 */
import {
  normalizeEmail,
  pullNextCaseId,
  readCaseAssigneeFacts,
  listMemberCaseQueueIds,
  users,
  getCaseRow,
} from '@openverify/db';
import type {
  AssignCaseBody,
  CaseDocument,
  NextCaseBody,
  NextCaseDocument,
} from '@openverify/contracts';
import { manualAssigneeIneligibility } from '@openverify/core';
import { and, eq } from 'drizzle-orm';
import {
  ForbiddenError,
  NotFoundError,
  PermissionDeniedError,
  UnprocessableContentError,
} from '../../../errors.js';
import type { ApiDependencies } from '../../context.js';
import { caseResource } from '../resources.js';
import type { CaseActing } from '../service.js';
import { caseChange, lockWritableCase, readerOf, type CaseUnit } from '../shared.js';
import { queueAudit } from '../queues/audit.js';
import { notifyUser, stageCaseEvent, workOfUnit } from '../queues/work.js';
import { assigneeIneligible, writeAssignmentInTx } from './apply.js';

/** Who a manual assignment names: a user id (`null` unassigns) or an address. */
export type AssignTarget = { userId: string | null } | { userEmailAddress: string };

const pointerOf = (target: AssignTarget) =>
  'userEmailAddress' in target ? '/meta/user-email-address' : '/meta/user-id';

async function documentOf(deps: ApiDependencies, acting: CaseActing, id: string) {
  const row = await getCaseRow(deps.db, acting.ctx.environmentId, id);
  if (row === null) {
    throw new NotFoundError(`Case ${id} was not found.`);
  }
  return { data: await caseResource(deps.db, acting.ctx.environmentId, row, acting.mask) };
}

/** The organisation's user an address or an id names, or `null`. */
async function userNamed(unit: CaseUnit, target: AssignTarget): Promise<string | null> {
  const [user] = await unit.tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.organizationId, unit.acting.ctx.organizationId),
        'userEmailAddress' in target
          ? eq(users.email, normalizeEmail(target.userEmailAddress))
          : eq(users.id, target.userId ?? ''),
      ),
    )
    .limit(1);
  return user?.id ?? null;
}

/** The caller's own address, when the caller is a user. */
async function ownAddress(unit: CaseUnit): Promise<string | null> {
  if (unit.acting.actor.type !== 'user') {
    return null;
  }
  const [user] = await unit.tx
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, unit.acting.actor.id))
    .limit(1);
  return user?.email ?? null;
}

/**
 * C132.3 manual: assigns (or with `userId: null` unassigns) a case in `unit`. `mayAssignOthers` is
 * whether the actor holds `cases:assign` (a run's grant, or the principal's permission). Answers
 * whether anything changed.
 * @throws {PermissionDeniedError} naming `cases:assign` for anyone but oneself without it.
 * @throws {CaseProblemError} `case_assignee_ineligible`, `case_redacted`, `case_version_conflict`.
 */
export async function assignCaseInTx(
  unit: CaseUnit,
  id: string,
  target: AssignTarget,
  options: { mayAssignOthers: boolean; lockVersion?: number | undefined },
): Promise<boolean> {
  const row = await lockWritableCase(unit, id, options.lockVersion);
  const self = unit.acting.actor.type === 'user' ? unit.acting.actor.id : null;
  if (!options.mayAssignOthers) {
    const own = await ownAddress(unit);
    const naming =
      'userEmailAddress' in target
        ? own !== null && normalizeEmail(target.userEmailAddress) === own
        : target.userId === null
          ? row.assigneeId === null || row.assigneeId === self
          : target.userId === self;
    if (!naming) {
      throw new PermissionDeniedError(
        'Assigning a case to anyone but yourself needs cases:assign.',
        ['cases:assign'],
      );
    }
  }
  let assigneeId: string | null = null;
  if (!('userId' in target && target.userId === null)) {
    const found = await userNamed(unit, target);
    const [fact] =
      found === null
        ? []
        : await readCaseAssigneeFacts(unit.tx, {
            environmentId: unit.acting.ctx.environmentId,
            organizationId: unit.acting.ctx.organizationId,
            caseTemplateId: row.caseTemplateId,
            userIds: [found],
          });
    if (fact === undefined || manualAssigneeIneligibility(fact) !== null) {
      throw assigneeIneligible(pointerOf(target));
    }
    assigneeId = fact.userId;
  }
  const work = workOfUnit(unit);
  const changed = await writeAssignmentInTx(work, row, {
    assigneeId,
    assigner: { type: unit.acting.actor.type, id: unit.acting.actor.id },
    strategy: 'manual',
    updater: { type: unit.acting.actor.type, id: unit.acting.actor.id },
  });
  if (!changed) {
    return false;
  }
  await stageCaseEvent(work, id, 'case.assigned');
  if (assigneeId !== null && assigneeId !== self) {
    await notifyUser(work, id, 'assigned', assigneeId);
  }
  await unit.audit(
    queueAudit('case.assigned', id, { strategy: 'manual', 'assignee-id': assigneeId }),
  );
  return true;
}

/**
 * `POST /cases/:id/assign`: `meta.user-id` (`null` unassigns) or `meta.user-email-address`, resolved
 * within the organisation; `lock-version` answers `case_version_conflict` (C131.2).
 */
export async function assignCase(
  deps: ApiDependencies,
  acting: CaseActing,
  id: string,
  body: AssignCaseBody,
): Promise<CaseDocument> {
  const meta = body.meta;
  const target: AssignTarget =
    meta['user-email-address'] === undefined
      ? { userId: meta['user-id'] ?? null }
      : { userEmailAddress: meta['user-email-address'] };
  await caseChange(deps, acting, (unit) =>
    assignCaseInTx(unit, id, target, {
      mayAssignOthers: acting.principal.permissions.has('cases:assign'),
      lockVersion: meta['lock-version'],
    }),
  );
  return documentOf(deps, acting, id);
}

/**
 * `POST /cases/next`: the most urgent unassigned case of the caller's queues (or of the queues named,
 * each of which the caller is a member of), assigned to the caller; `data: null` when none waits.
 */
export async function nextCase(
  deps: ApiDependencies,
  acting: CaseActing,
  body: NextCaseBody | undefined,
): Promise<NextCaseDocument> {
  const { principal } = acting;
  if (principal.kind !== 'user') {
    throw new ForbiddenError('Only a user takes the next case: a key is a member of no queue.');
  }
  const { environmentId } = acting.ctx;
  const memberOf = await listMemberCaseQueueIds(deps.db, environmentId, principal.userId);
  const named = body?.meta?.['case-queue-ids'];
  if (named !== undefined) {
    const outside = named.flatMap((queueId, index) =>
      memberOf.includes(queueId)
        ? []
        : [
            {
              location: 'body',
              pointer: `/meta/case-queue-ids/${String(index)}`,
              detail: 'Names no active queue the caller is a member of.',
            },
          ],
    );
    if (outside.length > 0) {
      throw new UnprocessableContentError(
        'A queue named is not an active queue the caller is a member of.',
        outside,
      );
    }
  }
  const queueIds = named ?? memberOf;
  const taken = await caseChange(deps, acting, async (unit) => {
    const id = await pullNextCaseId(unit.tx, environmentId, queueIds, readerOf(principal));
    if (id === null) {
      return null;
    }
    const row = await lockWritableCase(unit, id);
    const work = workOfUnit(unit);
    await writeAssignmentInTx(work, row, {
      assigneeId: principal.userId,
      assigner: { type: 'user', id: principal.userId },
      strategy: 'pull',
      inputs: { 'case-queue-id': row.caseQueueId },
      updater: { type: 'user', id: principal.userId },
    });
    await stageCaseEvent(work, id, 'case.assigned');
    await unit.audit(
      queueAudit('case.assigned', id, { strategy: 'pull', 'assignee-id': principal.userId }),
    );
    return id;
  });
  if (taken === null) {
    return { data: null };
  }
  return documentOf(deps, acting, taken);
}
