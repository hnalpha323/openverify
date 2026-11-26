/**
 * C133.1 (Workflow 8B, `api-cases`): the public deadline, `meta.sla-expires-in-seconds` on create and
 * `PATCH` (1 to 7,776,000 seconds, decision 55; `null` clears it), on `case-logic`'s pure transitions:
 * a wall-clock target on the 24x7 calendar that pauses in a pausing status as a policy's does, a new
 * one re-arming the SLA in a new epoch. A policy's SLA is `api-queues-sla`'s; this replaces it.
 */
import { caseSlaOf, updateCaseRow, type Case, type CaseSlaColumns } from '@openverify/db';
import {
  clearSla,
  slaSecondsProblem,
  slaSecondsTarget,
  startSla,
  type CaseSla,
  type SlaChange,
} from './sla/sla-state.js';
import { caseProblemAt } from './problems.js';
import { historyActor, type CaseUnit } from './shared.js';
import { emitCaseEvent } from './writes.js';

export const SLA_SECONDS_POINTER = '/meta/sla-expires-in-seconds';

/** @throws {CaseProblemError} `sla_out_of_range` for a value outside 1 to 7,776,000 whole seconds. */
export function assertSlaSeconds(
  seconds: number | null | undefined,
  pointer = SLA_SECONDS_POINTER,
): void {
  if (seconds !== undefined && seconds !== null && slaSecondsProblem(seconds) !== null) {
    throw caseProblemAt(
      'sla_out_of_range',
      'sla-expires-in-seconds takes 1 to 7,776,000 whole seconds (90 days).',
      pointer,
    );
  }
}

const slaOfColumns = (columns: CaseSlaColumns): CaseSla => ({
  state: columns.state,
  epoch: columns.epoch,
  consumedMs: columns.consumedMs,
  segmentStartedAt: columns.segmentStartedAt,
  expiresAt: columns.expiresAt,
  expiredAt: columns.expiredAt,
  metAt: columns.metAt,
});

/**
 * Sets (`seconds`) or clears (`null`) the public SLA of a locked case, with its history row and, when
 * the target is spent already, `case.sla-expired`. Answers whether anything changed.
 */
export async function setPublicSlaInTx(
  unit: CaseUnit,
  row: Case,
  seconds: number | null,
  paused: boolean,
): Promise<boolean> {
  assertSlaSeconds(seconds);
  const current = slaOfColumns(caseSlaOf(row));
  const change: SlaChange =
    seconds === null
      ? clearSla(current)
      : startSla(current, slaSecondsTarget(seconds), unit.at, { paused });
  if (!change.changed) {
    return false;
  }
  const { sla } = change;
  await updateCaseRow(unit.tx, unit.acting.ctx.environmentId, row.id, {
    sla: {
      ...sla,
      targetMs: seconds === null ? null : seconds * 1000,
      policyId: null,
      policyRevision: null,
      calendarId: null,
      onReopen: 'continue',
    },
    updaterType: unit.acting.actor.type,
    updaterId: unit.acting.actor.id,
  });
  await unit.history([
    {
      caseId: row.id,
      kind: change.history,
      ...historyActor(unit.acting),
      to: {
        state: sla.state,
        epoch: sla.epoch,
        'expires-at': sla.expiresAt?.toISOString() ?? null,
      },
      requestId: unit.acting.ctx.requestId ?? null,
    },
  ]);
  if (change.fires && row.statusCategory !== 'end') {
    await emitCaseEvent(unit, row.id, 'case.sla-expired');
  }
  return true;
}
