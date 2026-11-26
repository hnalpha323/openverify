/**
 * A case's SLA state (plan C133.4, C133.5; decision 58, 60): pure transitions over the SLA columns of
 * a case. `api-queues-sla` reads the columns under the case row's lock, applies what these answer,
 * writes the history row they name and, when `fires` is set, stages `case.sla-expired` in the same
 * transaction. Every change to the deadline moves the epoch, so the `case-sla` sweep fires once per
 * epoch however many sweepers run.
 *
 * A public `sla-expires-in-seconds` deadline is a target on the `24x7` calendar, so it pauses and
 * resumes as a policy's does (ours).
 */
import {
  CASE_LIMITS,
  type CaseHistoryKind,
  type CaseSlaOnReopen,
  type CaseSlaState,
  type CaseStatusCategory,
} from '@openverify/core';
import {
  addBusinessTime,
  businessTimeBetween,
  type BusinessCalendarOrAllHours,
} from './business-time.js';

/** The SLA columns of a case (C133.4). */
export interface CaseSla {
  readonly state: CaseSlaState;
  readonly epoch: number;
  /** Business milliseconds used before the running segment. */
  readonly consumedMs: number;
  readonly segmentStartedAt: Date | null;
  /** The public `sla-expires-at`: `null` exactly when the state is `none` or `paused`. */
  readonly expiresAt: Date | null;
  readonly expiredAt: Date | null;
  readonly metAt: Date | null;
}

/** A case with no SLA. */
export const NO_SLA: CaseSla = Object.freeze({
  state: 'none',
  epoch: 0,
  consumedMs: 0,
  segmentStartedAt: null,
  expiresAt: null,
  expiredAt: null,
  metAt: null,
});

/** What the SLA counts towards: business milliseconds on a calendar, or `null` for `24x7`. */
export interface SlaTarget {
  readonly targetMs: number;
  readonly calendar: BusinessCalendarOrAllHours;
}

export type SlaHistoryKind = Extract<
  CaseHistoryKind,
  | 'sla-started'
  | 'sla-paused'
  | 'sla-resumed'
  | 'sla-recomputed'
  | 'sla-met'
  | 'sla-expired'
  | 'sla-cleared'
>;

export type SlaChange =
  | { readonly changed: false }
  | {
      readonly changed: true;
      readonly sla: CaseSla;
      readonly history: SlaHistoryKind;
      /** Stage `case.sla-expired` with this change (an unresolved case only, C133.6). */
      readonly fires: boolean;
    };

const UNCHANGED: SlaChange = Object.freeze({ changed: false });

const changed = (sla: CaseSla, history: SlaHistoryKind, fires = false): SlaChange => ({
  changed: true,
  sla,
  history,
  fires,
});

const time = (instant: Date): number => instant.getTime();

/** The business time a running SLA has used by `at`, the running segment included. */
const consumedBy = (sla: CaseSla, target: SlaTarget, at: Date): number =>
  sla.consumedMs +
  (sla.segmentStartedAt === null
    ? 0
    : businessTimeBetween(sla.segmentStartedAt, at, target.calendar));

/**
 * An SLA that runs from `at` with `consumedMs` used in a new epoch, or that has already run out: then
 * it expires at `at` and fires, in that new epoch, so no epoch fires twice.
 */
function runningFrom(
  sla: CaseSla,
  target: SlaTarget,
  at: Date,
  consumedMs: number,
  epoch: number,
  history: SlaHistoryKind,
): SlaChange {
  const remaining = target.targetMs - consumedMs;
  if (remaining <= 0) {
    return changed(
      {
        ...sla,
        state: 'expired',
        epoch,
        consumedMs,
        segmentStartedAt: null,
        expiresAt: at,
        expiredAt: at,
      },
      'sla-expired',
      true,
    );
  }
  return changed(
    {
      state: 'running',
      epoch,
      consumedMs,
      segmentStartedAt: at,
      expiresAt: addBusinessTime(at, remaining, target.calendar),
      expiredAt: null,
      metAt: null,
    },
    history,
  );
}

const pausedWith = (epoch: number, consumedMs: number): CaseSla => ({
  ...NO_SLA,
  state: 'paused',
  epoch,
  consumedMs,
});

/**
 * Starts (or re-arms) the SLA at `at`: a new epoch with nothing consumed (C133.5). A new
 * `sla-expires-in-seconds`, a new policy and a reopen under `restart` start one.
 */
export function startSla(
  sla: CaseSla,
  target: SlaTarget,
  at: Date,
  options: { readonly paused: boolean },
): SlaChange {
  const epoch = sla.epoch + 1;
  if (options.paused) {
    return changed(pausedWith(epoch, 0), 'sla-started');
  }
  return runningFrom(sla, target, at, 0, epoch, 'sla-started');
}

/**
 * Entering a pausing status: the running segment is consumed and the deadline cleared. A pause at or
 * after a deadline the sweep has not reached yet is that deadline's expiry, and fires.
 */
export function pauseSla(sla: CaseSla, target: SlaTarget, at: Date): SlaChange {
  if (sla.state !== 'running') {
    return UNCHANGED;
  }
  const consumedMs = consumedBy(sla, target, at);
  if (sla.expiresAt !== null && time(at) >= time(sla.expiresAt)) {
    return changed(
      { ...sla, state: 'expired', consumedMs, segmentStartedAt: null, expiredAt: at },
      'sla-expired',
      true,
    );
  }
  return changed(pausedWith(sla.epoch + 1, consumedMs), 'sla-paused');
}

/** Leaving a pausing status: a new segment and a new deadline from what remains. */
export function resumeSla(sla: CaseSla, target: SlaTarget, at: Date): SlaChange {
  if (sla.state !== 'paused') {
    return UNCHANGED;
  }
  return runningFrom(sla, target, at, sla.consumedMs, sla.epoch + 1, 'sla-resumed');
}

/**
 * Entering an `end` status: `met` before the deadline, which it keeps; at or after it, `expired`
 * (the breach is a fact) without firing, because `case.sla-expired` never fires for a case in an
 * `end` status (C133.6). A paused SLA is met, and states the deadline what remained would have given
 * from `at` (ours: `sla-expires-at` is never null once met).
 */
export function resolveSla(sla: CaseSla, target: SlaTarget, at: Date): SlaChange {
  if (sla.state === 'paused') {
    return changed(
      {
        ...sla,
        state: 'met',
        expiresAt: addBusinessTime(
          at,
          Math.max(0, target.targetMs - sla.consumedMs),
          target.calendar,
        ),
        metAt: at,
      },
      'sla-met',
    );
  }
  if (sla.state !== 'running' || sla.expiresAt === null) {
    return UNCHANGED;
  }
  const consumedMs = consumedBy(sla, target, at);
  if (time(at) >= time(sla.expiresAt)) {
    return changed(
      { ...sla, state: 'expired', consumedMs, segmentStartedAt: null, expiredAt: at },
      'sla-expired',
    );
  }
  return changed(
    { ...sla, state: 'met', consumedMs, segmentStartedAt: null, metAt: at },
    'sla-met',
  );
}

/**
 * Leaving an `end` status, by the policy's `on-reopen` (decision 58): `continue` keeps the time used
 * (and an `expired` SLA stays expired), `restart` starts again. Into a pausing status it waits.
 */
export function reopenSla(
  sla: CaseSla,
  target: SlaTarget,
  at: Date,
  options: { readonly onReopen: CaseSlaOnReopen; readonly paused: boolean },
): SlaChange {
  if (sla.state !== 'met' && sla.state !== 'expired') {
    return UNCHANGED;
  }
  if (options.onReopen === 'restart') {
    return startSla(sla, target, at, { paused: options.paused });
  }
  if (sla.state === 'expired') {
    return UNCHANGED;
  }
  const epoch = sla.epoch + 1;
  if (options.paused) {
    return changed(pausedWith(epoch, sla.consumedMs), 'sla-paused');
  }
  return runningFrom(sla, target, at, sla.consumedMs, epoch, 'sla-resumed');
}

/**
 * A calendar edit or a new target on a running SLA (decision 59): the time used so far is measured on
 * the previous calendar, and what remains of the next target runs from `at` on the next one. A
 * target already spent expires and fires; its deadline is when the time used reached it. A paused SLA
 * has no deadline to move, unless the next target is already spent.
 */
export function recomputeSla(
  sla: CaseSla,
  previous: SlaTarget,
  next: SlaTarget,
  at: Date,
): SlaChange {
  if (sla.state === 'paused') {
    return sla.consumedMs >= next.targetMs
      ? changed({ ...sla, state: 'expired', expiresAt: at, expiredAt: at }, 'sla-expired', true)
      : UNCHANGED;
  }
  if (sla.state !== 'running' || sla.segmentStartedAt === null) {
    return UNCHANGED;
  }
  const consumedMs = consumedBy(sla, previous, at);
  if (consumedMs >= next.targetMs) {
    const reachedAt =
      sla.consumedMs >= next.targetMs
        ? sla.segmentStartedAt
        : addBusinessTime(sla.segmentStartedAt, next.targetMs - sla.consumedMs, previous.calendar);
    return changed(
      {
        ...sla,
        state: 'expired',
        consumedMs,
        segmentStartedAt: null,
        expiresAt: reachedAt,
        expiredAt: at,
      },
      'sla-expired',
      true,
    );
  }
  const expiresAt = addBusinessTime(at, next.targetMs - consumedMs, next.calendar);
  if (sla.expiresAt !== null && time(expiresAt) === time(sla.expiresAt)) {
    return UNCHANGED;
  }
  return changed(
    { ...sla, epoch: sla.epoch + 1, consumedMs, segmentStartedAt: at, expiresAt },
    'sla-recomputed',
  );
}

/**
 * The `case-sla` sweep: a running SLA whose deadline is due expires and fires (C133.6), once: the
 * state leaves `running`, so a second sweeper finds nothing. The epoch does not move, so the event
 * names the epoch whose deadline it was. The caller never sweeps a case in an `end` status.
 */
export function expireSla(sla: CaseSla, target: SlaTarget, at: Date): SlaChange {
  if (sla.state !== 'running' || sla.expiresAt === null || time(sla.expiresAt) > time(at)) {
    return UNCHANGED;
  }
  return changed(
    {
      ...sla,
      state: 'expired',
      consumedMs: consumedBy(sla, target, at),
      segmentStartedAt: null,
      expiredAt: at,
    },
    'sla-expired',
    true,
  );
}

/** `sla-expires-in-seconds: null` and Clear Case SLA (C133.1): a new epoch with no SLA. */
export function clearSla(sla: CaseSla): SlaChange {
  return sla.state === 'none'
    ? UNCHANGED
    : changed({ ...NO_SLA, epoch: sla.epoch + 1 }, 'sla-cleared');
}

/** A status change, as `applySlaOnStatusChangeInTx` sees it (C133.5). */
export interface SlaStatusChange {
  readonly from: CaseStatusCategory;
  readonly to: { readonly category: CaseStatusCategory; readonly pausesSla: boolean };
  readonly at: Date;
  readonly onReopen: CaseSlaOnReopen;
}

/**
 * What a status change does to the SLA (C133.5): entering `end` resolves it, leaving `end` reopens it,
 * a move between `end` statuses changes nothing; otherwise entering a pausing status pauses a running
 * SLA and entering one that does not pause resumes a paused one.
 */
export function slaOnStatusChange(
  sla: CaseSla,
  target: SlaTarget,
  change: SlaStatusChange,
): SlaChange {
  const leavesEnd = change.from === 'end';
  const entersEnd = change.to.category === 'end';
  if (leavesEnd && entersEnd) {
    return UNCHANGED;
  }
  if (entersEnd) {
    return resolveSla(sla, target, change.at);
  }
  if (leavesEnd) {
    return reopenSla(sla, target, change.at, {
      onReopen: change.onReopen,
      paused: change.to.pausesSla,
    });
  }
  return change.to.pausesSla ? pauseSla(sla, target, change.at) : resumeSla(sla, target, change.at);
}

const SLA_SECONDS = CASE_LIMITS['sla-seconds'].value;

/** C133.1: `sla-expires-in-seconds` from 1 to 7,776,000 whole seconds, else `sla_out_of_range`. */
export function slaSecondsProblem(seconds: number): 'sla_out_of_range' | null {
  return Number.isInteger(seconds) && seconds >= 1 && seconds <= SLA_SECONDS
    ? null
    : 'sla_out_of_range';
}

const UNIT_SECONDS = { minutes: 60, hours: 3600, days: 86_400 } as const;

/** The Set Case SLA step's `{ value, unit }` in seconds (C140.3); the service holds the 90 days. */
export function slaDurationSeconds(duration: {
  readonly value: number;
  readonly unit: 'minutes' | 'hours' | 'days';
}): number {
  return duration.value * UNIT_SECONDS[duration.unit];
}

/** A wall-clock deadline `seconds` from its start, on the `24x7` calendar (C133.1). */
export function slaSecondsTarget(seconds: number): SlaTarget {
  return { targetMs: seconds * 1000, calendar: null };
}
