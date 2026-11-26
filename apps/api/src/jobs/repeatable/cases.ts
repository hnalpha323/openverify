/**
 * C132.6, C133.6 (Workflow 8B): the repeatable case sweeps. Owner `api-queues-sla`; `foundation-8b`
 * froze the names, the deps and their registration (`caseRepeatableJobs` in `./index.ts`, with the
 * worker's case options). Each takes its rows `FOR UPDATE SKIP LOCKED`, so two workers never take one
 * case, and handles each row in a savepoint: a row that fails rolls back alone, is logged by its ids
 * (never a value), and is retried by the next pass, while the others commit.
 *
 * - `case-sla` (every 30 s, decision 60): each running SLA due at `now` (`lockDueCaseSlas`, batches
 *   of 500) expires, with its history row and `case.sla-expired` staged in the same transaction: once
 *   per epoch (the state leaves `running`, so a second sweeper finds nothing), never for a case in an
 *   `end` status (C133.6), with a breach notification for the assignee (C133.7). The breach email is
 *   not sent here: no mailer reaches the sweeps (Stage 1b amendment 30).
 * - `case-reassign` (every 60 s): a case assigned to a user who was deactivated or lost `cases:write`
 *   or the template returns to its queue's policy or to nobody, with its history and `case.assigned`
 *   (`assignee-id: null`), then `case.assigned` again when the policy assigns (C132.6). A member's row
 *   is kept (Stage 1b amendment 23): a policy reads eligibility live, so it never chooses them.
 */
import {
  cases,
  getCaseAssignmentPolicyRow,
  getCaseRow,
  listDrainableAssignmentPolicies,
  listWaitingCasesOfPolicy,
  lockDueCaseSlas,
  lockStrandedCases,
  type Db,
  type DrainableAssignmentPolicy,
} from '@openverify/db';
import { and, eq, isNull, ne } from 'drizzle-orm';
import type { StagedEvent, TransactionalEventPublisher } from '../../events/index.js';
import type { Clock } from '../../ports.js';
import { assignByPolicyInTx, writeAssignmentInTx } from '../../services/cases/assignment/apply.js';
import { notifyUser, stageCaseEvent, type QueueWork } from '../../services/cases/queues/work.js';
import {
  slaOf,
  slaTargetOf,
  systemWork,
  writeSlaChangeInTx,
} from '../../services/cases/sla/policy-sla.js';
import { expireSla } from '../../services/cases/sla/sla-state.js';
import {
  CASE_TRANSACTION_ATTEMPTS,
  isRetryableTransactionError,
} from '../../services/cases/shared.js';
import type { WorkerLogger } from '../logger.js';

/** What the case sweeps read; the worker builds it once with its event publisher. */
export interface CaseSweepDeps {
  db: Db;
  clock: Clock;
  logger: WorkerLogger;
  /** Stages `case.sla-expired` and `case.assigned` in each change's transaction. */
  events: TransactionalEventPublisher;
}

/** C133.6: a sweep's batch (decision 60). */
export const CASE_SLA_SWEEP_BATCH = 500;

/** C132.6: the re-assignment sweep's batch (ours, provisional: the SLA sweep's). */
export const CASE_REASSIGN_SWEEP_BATCH = 500;

interface Row {
  environmentId: string;
  organizationId: string;
  caseId: string;
}

/**
 * One pass: `lock` takes the rows in one transaction, and `handle` runs each in a savepoint; the
 * events of the rows that committed are dispatched after the commit.
 */
async function sweep<Locked extends Row>(
  deps: CaseSweepDeps,
  what: string,
  lock: (tx: Db) => Promise<Locked[]>,
  handle: (work: QueueWork, row: Locked) => Promise<void>,
): Promise<void> {
  const at = deps.clock.now();
  const dispatched: StagedEvent[] = [];
  await deps.db.transaction(async (tx) => {
    for (const row of await lock(tx)) {
      const staged: StagedEvent[] = [];
      try {
        await tx.transaction((savepoint) =>
          handle(
            systemWork(savepoint, row.environmentId, row.organizationId, at, {
              publisher: deps.events,
              staged,
            }),
            row,
          ),
        );
        dispatched.push(...staged);
      } catch (error) {
        deps.logger.error(
          { environmentId: row.environmentId, caseId: row.caseId, error: (error as Error).name },
          `${what}: a case was left for the next pass`,
        );
      }
    }
  });
  await deps.events.dispatch(dispatched);
}

export const runCaseSlaSweep: (deps: CaseSweepDeps) => Promise<void> = (deps) =>
  sweep(
    deps,
    'case-sla',
    (tx) => lockDueCaseSlas(tx, { now: deps.clock.now(), limit: CASE_SLA_SWEEP_BATCH }),
    async (work, due) => {
      const row = await getCaseRow(work.tx, work.environmentId, due.caseId);
      if (row === null) {
        return;
      }
      const target = await slaTargetOf(work.tx, row);
      if (target === null) {
        return;
      }
      const change = expireSla(slaOf(row), target, work.at);
      if (change.changed) {
        await writeSlaChangeInTx(work, row, change);
      }
    },
  );

export const runCaseReassignSweep: (deps: CaseSweepDeps) => Promise<void> = (deps) =>
  sweep(
    deps,
    'case-reassign',
    (tx) => lockStrandedCases(tx, { limit: CASE_REASSIGN_SWEEP_BATCH }),
    async (work, stranded) => {
      const row = await getCaseRow(work.tx, work.environmentId, stranded.caseId);
      if (row === null) {
        return;
      }
      if (row.assigneeId === null) {
        return;
      }
      await writeAssignmentInTx(work, row, {
        assigneeId: null,
        assigner: null,
        strategy: 'manual',
        reason: 'assignee-ineligible',
      });
      await stageCaseEvent(work, row.id, 'case.assigned');
      const assignee = await assignByPolicyInTx(work, row.id);
      if (assignee !== null) {
        await stageCaseEvent(work, row.id, 'case.assigned');
        await notifyUser(work, row.id, 'assigned', assignee);
      }
    },
  );

/** K8-24: the policies a drain pass walks, and the waiting cases it weighs for each (ours). */
export const CASE_ASSIGNMENT_DRAIN_POLICIES = 100;
export const CASE_ASSIGNMENT_DRAIN_CASES = 50;

type Drained = 'assigned' | 'nobody' | 'taken';

/**
 * K8-24 (Workflow 8D; C132.2, plan items 76 and 105): `case-assignment-drain`, every 60 seconds:
 * each policy with sources assigns the waiting cases they hold (unassigned, open, unredacted), in
 * its order (`listWaitingCasesOfPolicy`: its sources' priority, its `sort`, age, id), while an agent
 * has room, so a case waiting when no one could take it is placed once someone can.
 *
 * - Each case is its own transaction, in the lock order of every other assignment: the case row
 *   first (`FOR UPDATE SKIP LOCKED`, so a case another drain, a pull or an entry holds is passed
 *   by), then its queue's row and the policy's (`assignByPolicyInTx` with the policy named), under
 *   which the agents' open counts are read; so no case goes to two agents and no agent passes its
 *   capacity. A deadlock or a serialisation failure runs the case again, three times in all.
 * - It assigns through the policy path: assigner `case-assignment-policy`, the history row,
 *   `case.assigned` and the assignee's notification (with its email, K8-20).
 * - A round-robin or fewest-open policy that places nobody has no agent with room, so its pass
 *   stops; a creator policy goes on, because its answer is about one case.
 */
export async function runCaseAssignmentDrain(deps: CaseSweepDeps): Promise<void> {
  const at = deps.clock.now();
  const policies = await listDrainableAssignmentPolicies(deps.db, CASE_ASSIGNMENT_DRAIN_POLICIES);
  for (const policy of policies) {
    const row = await getCaseAssignmentPolicyRow(
      deps.db,
      policy.environmentId,
      policy.caseAssignmentPolicyId,
    );
    if (row === null) {
      continue;
    }
    const byRoom = row.distribution === 'round-robin' || row.distribution === 'fewest-open';
    const waiting = await listWaitingCasesOfPolicy(deps.db, {
      environmentId: policy.environmentId,
      caseAssignmentPolicyId: policy.caseAssignmentPolicyId,
      limit: CASE_ASSIGNMENT_DRAIN_CASES,
    });
    for (const caseId of waiting) {
      let drained: Drained;
      try {
        drained = await drainCase(deps, policy, caseId, at);
      } catch (error) {
        deps.logger.error(
          { environmentId: policy.environmentId, caseId, error: (error as Error).name },
          'case-assignment-drain: a case was left for the next pass',
        );
        continue;
      }
      if (drained === 'nobody' && byRoom) {
        break;
      }
    }
  }
}

async function drainCase(
  deps: CaseSweepDeps,
  policy: DrainableAssignmentPolicy,
  caseId: string,
  at: Date,
): Promise<Drained> {
  for (let attempt = 1; ; attempt += 1) {
    const staged: StagedEvent[] = [];
    try {
      const drained = await deps.db.transaction(async (tx): Promise<Drained> => {
        const [held] = await tx
          .select({ id: cases.id })
          .from(cases)
          .where(
            and(
              eq(cases.environmentId, policy.environmentId),
              eq(cases.id, caseId),
              isNull(cases.assigneeId),
              ne(cases.statusCategory, 'end'),
              isNull(cases.redactedAt),
            ),
          )
          .for('update', { skipLocked: true });
        if (held === undefined) {
          return 'taken';
        }
        const work = systemWork(tx, policy.environmentId, policy.organizationId, at, {
          publisher: deps.events,
          staged,
        });
        const assignee = await assignByPolicyInTx(work, caseId, {
          policyId: policy.caseAssignmentPolicyId,
        });
        if (assignee === null) {
          return 'nobody';
        }
        await stageCaseEvent(work, caseId, 'case.assigned');
        await notifyUser(work, caseId, 'assigned', assignee);
        return 'assigned';
      });
      await deps.events.dispatch(staged);
      return drained;
    } catch (error) {
      if (attempt >= CASE_TRANSACTION_ATTEMPTS || !isRetryableTransactionError(error)) {
        throw error;
      }
    }
  }
}
