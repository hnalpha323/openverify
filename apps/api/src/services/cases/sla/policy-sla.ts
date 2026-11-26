/**
 * C133.1, C133.4, C133.5 (Workflow 8B, `api-queues-sla`): a case's SLA as its columns hold it, on
 * `case-logic`'s pure transitions.
 *
 * - A case pins what its SLA counts to (Stage 1b amendment 27): the target in business milliseconds,
 *   the calendar (`null` is around the clock) and `on-reopen`, beside the policy and its revision, so
 *   a later policy edit moves only cases that start after it.
 * - A policy's SLA starts as the pinned version's `sla-starts-on` says (on creation, on entering a
 *   queue, on the first assignment), only on a case that never had one: a public
 *   `sla-expires-in-seconds`, or a clear, already decided this case's deadline (ours).
 * - Every change writes its history row (PII-free: the state, the epoch, the deadline, ids); when a
 *   change fires on an unresolved case, `case.sla-expired` is staged in the same transaction and the
 *   assignee is told (C133.6, C133.7).
 * - Business time that cannot be measured is a problem, never a guess: a target the calendar cannot
 *   reach within ten years is `sla_out_of_range`, a zone the runtime no longer knows `calendar_invalid`.
 */
import type { CaseSlaStartsOn } from '@openverify/core';
import {
  caseSlaOf,
  getCaseCalendarRow,
  getCaseRow,
  getCaseSlaPolicyRow,
  updateCaseRow,
  appendCaseHistory,
  type Case,
  type CaseSlaColumns,
  type CaseTemplateVersionRow,
  type Db,
} from '@openverify/db';
import { CaseProblemError } from '../problems.js';
import { notifyUser, stageCaseEvent, SYSTEM_ACTOR, type QueueWork } from '../queues/work.js';
import {
  BusinessTimeError,
  type BusinessCalendar,
  type BusinessCalendarOrAllHours,
} from './business-time.js';
import { startSla, type CaseSla, type SlaChange, type SlaTarget } from './sla-state.js';

const MINUTE_MS = 60_000;

/** A stored calendar as business time reads it; a weekday it does not name is closed. */
export function businessCalendarOf(row: {
  readonly timeZone: string;
  readonly week: Readonly<Record<string, readonly { start: string; end: string }[]>>;
  readonly holidays: readonly { date: string }[];
  readonly closures: readonly { start: string; end: string }[];
}): BusinessCalendar {
  const day = (name: string) => [...(row.week[name] ?? [])];
  return {
    timeZone: row.timeZone,
    week: {
      monday: day('monday'),
      tuesday: day('tuesday'),
      wednesday: day('wednesday'),
      thursday: day('thursday'),
      friday: day('friday'),
      saturday: day('saturday'),
      sunday: day('sunday'),
    },
    holidays: row.holidays.map(({ date }) => ({ date })),
    closures: row.closures.map(({ start, end }) => ({ start, end })),
  };
}

/** The calendar a case's SLA counts on, `null` around the clock. */
export async function slaCalendarOf(
  db: Db,
  environmentId: string,
  caseCalendarId: string | null,
): Promise<BusinessCalendarOrAllHours> {
  if (caseCalendarId === null) {
    return null;
  }
  const row = await getCaseCalendarRow(db, environmentId, caseCalendarId);
  if (row === null) {
    throw new Error(`The calendar ${caseCalendarId} of a running SLA was not found`);
  }
  return businessCalendarOf(row);
}

/** The SLA columns as `case-logic` reads them. */
export function slaOf(row: Case): CaseSla {
  const columns = caseSlaOf(row);
  return {
    state: columns.state,
    epoch: columns.epoch,
    consumedMs: columns.consumedMs,
    segmentStartedAt: columns.segmentStartedAt,
    expiresAt: columns.expiresAt,
    expiredAt: columns.expiredAt,
    metAt: columns.metAt,
  };
}

/** What a case's SLA counts to, or `null` when it has none. */
export async function slaTargetOf(db: Db, row: Case): Promise<SlaTarget | null> {
  if (row.slaTargetMs === null) {
    return null;
  }
  return {
    targetMs: row.slaTargetMs,
    calendar: await slaCalendarOf(db, row.environmentId, row.slaCaseCalendarId),
  };
}

/** Business time that cannot be measured, as the problem a caller can act on. */
export function slaProblemOf(error: unknown, pointer?: string): unknown {
  if (!(error instanceof BusinessTimeError)) {
    return error;
  }
  const errors =
    pointer === undefined ? undefined : [{ location: 'body', pointer, detail: error.message }];
  return error.code === 'business_time_scan_exceeded'
    ? new CaseProblemError(
        'sla_out_of_range',
        'This target cannot be reached on its calendar within ten years.',
        errors === undefined ? {} : { errors },
      )
    : new CaseProblemError(
        'calendar_invalid',
        'This calendar cannot be read: its zone is not one the runtime knows.',
        { members: { dates: [] }, ...(errors === undefined ? {} : { errors }) },
      );
}

/** Runs `measure`, turning a business-time error into its problem. */
export function measured<T>(measure: () => T, pointer?: string): T {
  try {
    return measure();
  } catch (error) {
    throw slaProblemOf(error, pointer);
  }
}

/**
 * Writes an SLA change of a case (its columns, keeping or replacing what it counts to), its history
 * row, and, when it fires on an unresolved case, `case.sla-expired` and the assignee's breach
 * notification. Answers whether the change fired.
 */
export async function writeSlaChangeInTx(
  work: QueueWork,
  row: Case,
  change: Extract<SlaChange, { changed: true }>,
  options: {
    pinned?: Pick<
      CaseSlaColumns,
      'targetMs' | 'policyId' | 'policyRevision' | 'calendarId' | 'onReopen'
    >;
    to?: Readonly<Record<string, string | number | null>>;
    updater?: { type: Case['updaterType']; id: string | null } | null;
  } = {},
): Promise<boolean> {
  const current = caseSlaOf(row);
  const { sla } = change;
  await updateCaseRow(work.tx, work.environmentId, row.id, {
    sla: {
      ...sla,
      targetMs: options.pinned?.targetMs ?? current.targetMs,
      policyId: options.pinned === undefined ? current.policyId : options.pinned.policyId,
      policyRevision:
        options.pinned === undefined ? current.policyRevision : options.pinned.policyRevision,
      calendarId: options.pinned === undefined ? current.calendarId : options.pinned.calendarId,
      onReopen: options.pinned?.onReopen ?? current.onReopen,
    },
    ...(options.updater === undefined || options.updater === null
      ? {}
      : { updaterType: options.updater.type, updaterId: options.updater.id }),
  });
  await appendCaseHistory(work.tx, work.environmentId, [
    {
      caseId: row.id,
      kind: change.history,
      ...work.actor,
      to: {
        state: sla.state,
        epoch: sla.epoch,
        'expires-at': sla.expiresAt?.toISOString() ?? null,
        ...(options.to ?? {}),
      },
      requestId: work.requestId,
    },
  ]);
  const fires = change.fires && row.statusCategory !== 'end';
  if (fires) {
    await stageCaseEvent(work, row.id, 'case.sla-expired');
    if (row.assigneeId !== null) {
      await notifyUser(work, row.id, 'sla-breached', row.assigneeId);
    }
  }
  return fires;
}

/** Why a policy's SLA may start now (C130.2's `sla-starts-on`). */
export type SlaStartTrigger = CaseSlaStartsOn;

/**
 * C133.1: starts the pinned version's SLA policy on `caseId` when `triggers` holds the version's
 * `sla-starts-on` and the case never had an SLA, paused when its status pauses one. Answers whether
 * it started. The case row is the caller's to have locked.
 */
export async function startPolicySlaInTx(
  work: QueueWork,
  caseId: string,
  version: Pick<CaseTemplateVersionRow, 'slaPolicyId' | 'slaStartsOn' | 'statuses'>,
  triggers: readonly SlaStartTrigger[],
): Promise<boolean> {
  if (version.slaPolicyId === null || !triggers.includes(version.slaStartsOn)) {
    return false;
  }
  const row = await getCaseRow(work.tx, work.environmentId, caseId);
  if (row === null) {
    return false;
  }
  if (row.slaState !== 'none' || row.slaEpoch !== 0 || row.redactedAt !== null) {
    return false;
  }
  const policy = await getCaseSlaPolicyRow(work.tx, work.environmentId, version.slaPolicyId);
  if (policy === null) {
    return false;
  }
  const target: SlaTarget = {
    targetMs: policy.targetMinutes * MINUTE_MS,
    calendar: await slaCalendarOf(work.tx, work.environmentId, policy.caseCalendarId),
  };
  const status = version.statuses.find((each) => (each as { key?: unknown }).key === row.status) as
    { 'pauses-sla'?: boolean } | undefined;
  const change = measured(() =>
    startSla(slaOf(row), target, work.at, { paused: status?.['pauses-sla'] === true }),
  );
  if (!change.changed) {
    return false;
  }
  await writeSlaChangeInTx(work, row, change, {
    pinned: {
      targetMs: target.targetMs,
      policyId: policy.id,
      policyRevision: policy.revision,
      calendarId: policy.caseCalendarId,
      onReopen: policy.onReopen,
    },
    to: { 'case-sla-policy-id': policy.id, revision: policy.revision },
  });
  return true;
}

/** The system's work in `tx` for an environment, its events staged with `events`. */
export function systemWork(
  tx: Db,
  environmentId: string,
  organizationId: string,
  at: Date,
  events: QueueWork['events'],
): QueueWork {
  return { tx, environmentId, organizationId, at, requestId: null, actor: SYSTEM_ACTOR, events };
}
