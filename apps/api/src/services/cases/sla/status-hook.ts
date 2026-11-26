/**
 * C133.4, C133.5 (Workflow 8B): the SLA on every status change of a case: pause on entering a pausing
 * status, resume on leaving it, `met` on a resolution before the deadline, the pinned `on-reopen`.
 * `api-cases` calls it in the transaction of every status change, after the case row's lock. Owner
 * `api-queues-sla`, on `case-logic`'s pure `slaOnStatusChange`; `foundation-8b` froze the signature.
 *
 * The change is written with its history row, named as the system's (the status change's own row
 * names who changed the status). A change that fires on an unresolved case (a pause at or after a
 * deadline the sweep has not reached yet) stages `case.sla-expired` in this transaction, once per
 * epoch, with the caller's publisher, so it is dispatched with the status change's own events after
 * the commit (K8-23). A caller that hands none stages it through the outbox, which the dispatcher's
 * and the trigger sweeps enqueue (C5), at most one sweep period later.
 */
import type { CaseStatusCategory } from '@openverify/core';
import { getCaseRow, type Db } from '@openverify/db';
import {
  createOutboxOnlyPublisher,
  type StagedEvent,
  type TransactionalEventPublisher,
} from '../../../events/index.js';
import { organizationOf } from '../queues/work.js';
import { measured, slaOf, slaTargetOf, systemWork, writeSlaChangeInTx } from './policy-sla.js';
import { slaOnStatusChange } from './sla-state.js';

export interface CaseStatusChange {
  environmentId: string;
  caseId: string;
  from: { status: string; category: CaseStatusCategory };
  to: { status: string; category: CaseStatusCategory; pausesSla: boolean };
  at: Date;
  /** K8-23: the caller's publisher and staged list; the outbox when left out. */
  events?: { publisher: TransactionalEventPublisher; staged: StagedEvent[] };
}

export const applySlaOnStatusChangeInTx: (
  tx: Db,
  change: CaseStatusChange,
) => Promise<void> = async (tx, change) => {
  const row = await getCaseRow(tx, change.environmentId, change.caseId);
  if (row === null || row.slaState === 'none') {
    return;
  }
  const target = await slaTargetOf(tx, row);
  if (target === null) {
    return;
  }
  const result = measured(() =>
    slaOnStatusChange(slaOf(row), target, {
      from: change.from.category,
      to: { category: change.to.category, pausesSla: change.to.pausesSla },
      at: change.at,
      onReopen: row.slaOnReopen,
    }),
  );
  if (!result.changed) {
    return;
  }
  const work = systemWork(
    tx,
    change.environmentId,
    await organizationOf(tx, change.environmentId),
    change.at,
    change.events ?? { publisher: createOutboxOnlyPublisher(tx), staged: [] },
  );
  await writeSlaChangeInTx(work, row, result);
};
