import { describe, expect, it } from 'vitest';
import type { BusinessCalendar } from './business-time.js';
import {
  NO_SLA,
  clearSla,
  expireSla,
  pauseSla,
  recomputeSla,
  reopenSla,
  resolveSla,
  resumeSla,
  slaDurationSeconds,
  slaOnStatusChange,
  slaSecondsProblem,
  slaSecondsTarget,
  startSla,
  type CaseSla,
  type SlaChange,
  type SlaTarget,
} from './sla-state.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const T0 = new Date('2026-11-02T09:00:00Z');
const plus = (ms: number, from: Date = T0) => new Date(from.getTime() + ms);

const FOUR_HOURS: SlaTarget = { targetMs: 4 * HOUR, calendar: null };

const RUNNING: CaseSla = {
  state: 'running',
  epoch: 1,
  consumedMs: 0,
  segmentStartedAt: T0,
  expiresAt: plus(4 * HOUR),
  expiredAt: null,
  metAt: null,
};

const PAUSED: CaseSla = {
  state: 'paused',
  epoch: 2,
  consumedMs: HOUR,
  segmentStartedAt: null,
  expiresAt: null,
  expiredAt: null,
  metAt: null,
};

/** The state a change leaves, or a failure naming that nothing changed. */
function after(change: SlaChange): CaseSla {
  if (!change.changed) {
    throw new Error('expected a change');
  }
  return change.sla;
}

describe('starting an SLA (C133.5)', () => {
  it('runs from now with a new epoch and nothing consumed', () => {
    expect(startSla(NO_SLA, FOUR_HOURS, T0, { paused: false })).toEqual({
      changed: true,
      sla: RUNNING,
      history: 'sla-started',
      fires: false,
    });
  });

  it('starts paused in a pausing status, with no deadline', () => {
    expect(after(startSla(NO_SLA, FOUR_HOURS, T0, { paused: true }))).toEqual({
      ...NO_SLA,
      state: 'paused',
      epoch: 1,
    });
  });

  it('re-arms an expired or met SLA with the next epoch, forgetting the old outcome', () => {
    const expired: CaseSla = { ...RUNNING, state: 'expired', epoch: 4, expiredAt: plus(5 * HOUR) };
    expect(after(startSla(expired, FOUR_HOURS, plus(6 * HOUR), { paused: false }))).toEqual({
      state: 'running',
      epoch: 5,
      consumedMs: 0,
      segmentStartedAt: plus(6 * HOUR),
      expiresAt: plus(10 * HOUR),
      expiredAt: null,
      metAt: null,
    });
  });
});

describe('pausing and resuming (C133.5)', () => {
  it('consumes the running segment on a pause and clears the deadline', () => {
    expect(pauseSla(RUNNING, FOUR_HOURS, plus(HOUR))).toEqual({
      changed: true,
      sla: { ...PAUSED, epoch: 2 },
      history: 'sla-paused',
      fires: false,
    });
  });

  it('resumes with what remains', () => {
    expect(resumeSla(PAUSED, FOUR_HOURS, plus(3 * HOUR))).toEqual({
      changed: true,
      sla: {
        ...RUNNING,
        epoch: 3,
        consumedMs: HOUR,
        segmentStartedAt: plus(3 * HOUR),
        expiresAt: plus(6 * HOUR),
      },
      history: 'sla-resumed',
      fires: false,
    });
  });

  it('expires and fires when a pause comes at or after a deadline the sweep has not reached', () => {
    expect(pauseSla(RUNNING, FOUR_HOURS, plus(4 * HOUR))).toEqual({
      changed: true,
      sla: {
        ...RUNNING,
        state: 'expired',
        consumedMs: 4 * HOUR,
        segmentStartedAt: null,
        expiredAt: plus(4 * HOUR),
      },
      history: 'sla-expired',
      fires: true,
    });
  });

  it('expires and fires on a resume with nothing left', () => {
    const spent: CaseSla = { ...PAUSED, consumedMs: 4 * HOUR };
    expect(resumeSla(spent, FOUR_HOURS, plus(5 * HOUR))).toMatchObject({
      changed: true,
      sla: { state: 'expired', expiredAt: plus(5 * HOUR), expiresAt: plus(5 * HOUR) },
      history: 'sla-expired',
      fires: true,
    });
  });

  it('changes nothing when there is nothing to pause or resume', () => {
    for (const sla of [NO_SLA, PAUSED, { ...RUNNING, state: 'met' as const }]) {
      expect(pauseSla(sla, FOUR_HOURS, plus(HOUR))).toEqual({ changed: false });
    }
    for (const sla of [NO_SLA, RUNNING, { ...RUNNING, state: 'expired' as const }]) {
      expect(resumeSla(sla, FOUR_HOURS, plus(HOUR))).toEqual({ changed: false });
    }
  });
});

describe('resolving (C133.5)', () => {
  it('is met before the deadline, which it keeps', () => {
    expect(resolveSla(RUNNING, FOUR_HOURS, plus(2 * HOUR))).toEqual({
      changed: true,
      sla: {
        ...RUNNING,
        state: 'met',
        consumedMs: 2 * HOUR,
        segmentStartedAt: null,
        metAt: plus(2 * HOUR),
      },
      history: 'sla-met',
      fires: false,
    });
  });

  it('stays a breach when the deadline passed first, and never fires for a resolving case', () => {
    expect(resolveSla(RUNNING, FOUR_HOURS, plus(4 * HOUR))).toEqual({
      changed: true,
      sla: {
        ...RUNNING,
        state: 'expired',
        consumedMs: 4 * HOUR,
        segmentStartedAt: null,
        expiredAt: plus(4 * HOUR),
      },
      history: 'sla-expired',
      fires: false,
    });
  });

  it('meets a paused SLA, stating the deadline what remained would give', () => {
    expect(resolveSla(PAUSED, FOUR_HOURS, plus(5 * HOUR))).toEqual({
      changed: true,
      sla: { ...PAUSED, state: 'met', expiresAt: plus(8 * HOUR), metAt: plus(5 * HOUR) },
      history: 'sla-met',
      fires: false,
    });
  });

  it('leaves none, met and expired as they are', () => {
    const expired: CaseSla = { ...RUNNING, state: 'expired', expiredAt: plus(4 * HOUR) };
    const met: CaseSla = { ...RUNNING, state: 'met', metAt: plus(HOUR) };
    for (const sla of [NO_SLA, expired, met]) {
      expect(resolveSla(sla, FOUR_HOURS, plus(5 * HOUR))).toEqual({ changed: false });
    }
  });
});

describe('reopening (C133.5, decision 58)', () => {
  const MET: CaseSla = {
    ...RUNNING,
    state: 'met',
    epoch: 3,
    consumedMs: 2 * HOUR,
    segmentStartedAt: null,
    metAt: plus(2 * HOUR),
  };
  const REOPENED_AT = plus(24 * HOUR);

  it('continues the consumed time', () => {
    expect(
      reopenSla(MET, FOUR_HOURS, REOPENED_AT, { onReopen: 'continue', paused: false }),
    ).toEqual({
      changed: true,
      sla: {
        state: 'running',
        epoch: 4,
        consumedMs: 2 * HOUR,
        segmentStartedAt: REOPENED_AT,
        expiresAt: plus(2 * HOUR, REOPENED_AT),
        expiredAt: null,
        metAt: null,
      },
      history: 'sla-resumed',
      fires: false,
    });
  });

  it('continues paused into a pausing status', () => {
    expect(reopenSla(MET, FOUR_HOURS, REOPENED_AT, { onReopen: 'continue', paused: true })).toEqual(
      {
        changed: true,
        sla: { ...NO_SLA, state: 'paused', epoch: 4, consumedMs: 2 * HOUR },
        history: 'sla-paused',
        fires: false,
      },
    );
  });

  it('restarts from nothing under a restart policy', () => {
    expect(
      reopenSla(MET, FOUR_HOURS, REOPENED_AT, { onReopen: 'restart', paused: false }),
    ).toMatchObject({
      changed: true,
      sla: { state: 'running', epoch: 4, consumedMs: 0, expiresAt: plus(4 * HOUR, REOPENED_AT) },
      history: 'sla-started',
    });
  });

  it('keeps a breach under continue, and starts again under restart', () => {
    const expired: CaseSla = { ...RUNNING, state: 'expired', expiredAt: plus(4 * HOUR) };
    expect(
      reopenSla(expired, FOUR_HOURS, REOPENED_AT, { onReopen: 'continue', paused: false }),
    ).toEqual({ changed: false });
    expect(
      reopenSla(expired, FOUR_HOURS, REOPENED_AT, { onReopen: 'restart', paused: false }),
    ).toMatchObject({ changed: true, sla: { state: 'running', epoch: 2 }, history: 'sla-started' });
  });

  it('starts nothing that was never set', () => {
    expect(
      reopenSla(NO_SLA, FOUR_HOURS, REOPENED_AT, { onReopen: 'restart', paused: false }),
    ).toEqual({ changed: false });
  });
});

describe('recomputing on a calendar edit or a new target (decision 59)', () => {
  it('keeps what was consumed and moves the deadline', () => {
    expect(
      recomputeSla(RUNNING, FOUR_HOURS, { targetMs: 6 * HOUR, calendar: null }, plus(HOUR)),
    ).toEqual({
      changed: true,
      sla: {
        ...RUNNING,
        epoch: 2,
        consumedMs: HOUR,
        segmentStartedAt: plus(HOUR),
        expiresAt: plus(6 * HOUR),
      },
      history: 'sla-recomputed',
      fires: false,
    });
  });

  it('changes nothing when the deadline does not move', () => {
    expect(recomputeSla(RUNNING, FOUR_HOURS, FOUR_HOURS, plus(HOUR))).toEqual({ changed: false });
  });

  it('expires and fires when the new target is already spent', () => {
    expect(
      recomputeSla(RUNNING, FOUR_HOURS, { targetMs: HOUR, calendar: null }, plus(2 * HOUR)),
    ).toMatchObject({
      changed: true,
      sla: { state: 'expired', expiredAt: plus(2 * HOUR), expiresAt: plus(HOUR) },
      history: 'sla-expired',
      fires: true,
    });
    expect(
      recomputeSla(PAUSED, FOUR_HOURS, { targetMs: HOUR, calendar: null }, plus(2 * HOUR)),
    ).toMatchObject({ changed: true, sla: { state: 'expired' }, fires: true });
  });

  it('leaves a paused SLA that still has time, and every settled one, as it is', () => {
    expect(
      recomputeSla(PAUSED, FOUR_HOURS, { targetMs: 2 * HOUR, calendar: null }, plus(2 * HOUR)),
    ).toEqual({ changed: false });
    expect(recomputeSla(NO_SLA, FOUR_HOURS, FOUR_HOURS, plus(HOUR))).toEqual({ changed: false });
  });
});

describe('the sweep and clearing (C133.6, C133.1)', () => {
  it('expires a due running SLA once, in its epoch', () => {
    const change = expireSla(RUNNING, FOUR_HOURS, plus(4 * HOUR + MINUTE));
    expect(change).toEqual({
      changed: true,
      sla: {
        ...RUNNING,
        state: 'expired',
        consumedMs: 4 * HOUR + MINUTE,
        segmentStartedAt: null,
        expiredAt: plus(4 * HOUR + MINUTE),
      },
      history: 'sla-expired',
      fires: true,
    });
    expect(expireSla(after(change), FOUR_HOURS, plus(5 * HOUR))).toEqual({ changed: false });
  });

  it('leaves an SLA that is not due, or not running', () => {
    expect(expireSla(RUNNING, FOUR_HOURS, plus(4 * HOUR - 1))).toEqual({ changed: false });
    expect(expireSla(PAUSED, FOUR_HOURS, plus(10 * HOUR))).toEqual({ changed: false });
  });

  it('clears with a new epoch, so a due sweep finds nothing', () => {
    expect(clearSla(RUNNING)).toEqual({
      changed: true,
      sla: { ...NO_SLA, epoch: 2 },
      history: 'sla-cleared',
      fires: false,
    });
    expect(clearSla(NO_SLA)).toEqual({ changed: false });
    expect(clearSla({ ...NO_SLA, epoch: 7 })).toEqual({ changed: false });
  });
});

describe('a status change (C133.5, through applySlaOnStatusChangeInTx)', () => {
  const change = (
    from: 'initial' | 'intermediate' | 'end',
    to: 'initial' | 'intermediate' | 'end',
    pausesSla = false,
  ) => ({ from, to: { category: to, pausesSla }, at: plus(HOUR), onReopen: 'continue' as const });

  it('pauses on entering a pausing status, and resumes on leaving it', () => {
    expect(slaOnStatusChange(RUNNING, FOUR_HOURS, change('initial', 'intermediate', true))).toEqual(
      pauseSla(RUNNING, FOUR_HOURS, plus(HOUR)),
    );
    expect(slaOnStatusChange(PAUSED, FOUR_HOURS, change('intermediate', 'initial'))).toEqual(
      resumeSla(PAUSED, FOUR_HOURS, plus(HOUR)),
    );
  });

  it('resolves on entering an end status, and reopens on leaving one', () => {
    expect(slaOnStatusChange(RUNNING, FOUR_HOURS, change('initial', 'end'))).toEqual(
      resolveSla(RUNNING, FOUR_HOURS, plus(HOUR)),
    );
    const met = after(resolveSla(RUNNING, FOUR_HOURS, plus(HOUR)));
    expect(slaOnStatusChange(met, FOUR_HOURS, change('end', 'intermediate', true))).toEqual(
      reopenSla(met, FOUR_HOURS, plus(HOUR), { onReopen: 'continue', paused: true }),
    );
  });

  it('changes nothing between two end statuses, or between two that do not pause', () => {
    const met = after(resolveSla(RUNNING, FOUR_HOURS, plus(HOUR)));
    expect(slaOnStatusChange(met, FOUR_HOURS, change('end', 'end'))).toEqual({ changed: false });
    expect(slaOnStatusChange(RUNNING, FOUR_HOURS, change('initial', 'intermediate'))).toEqual({
      changed: false,
    });
    expect(
      slaOnStatusChange(PAUSED, FOUR_HOURS, change('intermediate', 'intermediate', true)),
    ).toEqual({ changed: false });
    expect(slaOnStatusChange(NO_SLA, FOUR_HOURS, change('initial', 'end'))).toEqual({
      changed: false,
    });
  });
});

describe('a business calendar under the SLA', () => {
  const office: BusinessCalendar = {
    timeZone: 'America/New_York',
    week: {
      monday: [{ start: '09:00', end: '17:00' }],
      tuesday: [{ start: '09:00', end: '17:00' }],
      wednesday: [{ start: '09:00', end: '17:00' }],
      thursday: [{ start: '09:00', end: '17:00' }],
      friday: [{ start: '09:00', end: '17:00' }],
      saturday: [],
      sunday: [],
    },
    holidays: [],
    closures: [],
  };
  const target: SlaTarget = { targetMs: 2 * HOUR, calendar: office };

  it('counts business hours through a start, a pause and a resume', () => {
    // Friday 16:00 EST: an hour on Friday, then Monday from 09:00.
    const started = after(
      startSla(NO_SLA, target, new Date('2026-11-06T21:00:00Z'), { paused: false }),
    );
    expect(started.expiresAt).toEqual(new Date('2026-11-09T15:00:00Z'));
    const paused = after(pauseSla(started, target, new Date('2026-11-09T14:30:00Z')));
    expect(paused.consumedMs).toBe(90 * MINUTE);
    const resumed = after(resumeSla(paused, target, new Date('2026-11-10T13:00:00Z')));
    expect(resumed.expiresAt).toEqual(new Date('2026-11-10T14:30:00Z'));
  });
});

describe('the public seconds and the Set Case SLA step (C133.1, C140.3)', () => {
  it('takes 1 to 7,776,000 whole seconds', () => {
    expect([1, 60, 7_776_000].map(slaSecondsProblem)).toEqual([null, null, null]);
    expect([0, -5, 7_776_001, 1.5, Number.NaN].map(slaSecondsProblem)).toEqual(
      Array.from({ length: 5 }, () => 'sla_out_of_range'),
    );
  });

  it('reads a step duration in seconds', () => {
    expect(slaDurationSeconds({ value: 90, unit: 'minutes' })).toBe(5400);
    expect(slaDurationSeconds({ value: 2, unit: 'hours' })).toBe(7200);
    expect(slaDurationSeconds({ value: 90, unit: 'days' })).toBe(7_776_000);
  });

  it('counts seconds on the 24x7 calendar', () => {
    expect(slaSecondsTarget(60)).toEqual({ targetMs: MINUTE, calendar: null });
  });
});

/** mulberry32, seeded, so a failure replays. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

describe('invariants over seeded random histories (C133.4)', () => {
  it('keeps the deadline null exactly while none or paused, the epoch rising, and fires once', () => {
    const random = generator(0xc1335);
    const problems: string[] = [];
    for (let history = 0; history < 200; history += 1) {
      let sla = NO_SLA;
      let now = T0.getTime();
      let firedInEpoch = -1;
      for (let step = 0; step < 25; step += 1) {
        now += Math.floor(random() * 3 * HOUR);
        const at = new Date(now);
        const operations = [
          () => startSla(sla, FOUR_HOURS, at, { paused: random() < 0.3 }),
          () => pauseSla(sla, FOUR_HOURS, at),
          () => resumeSla(sla, FOUR_HOURS, at),
          () => resolveSla(sla, FOUR_HOURS, at),
          () =>
            reopenSla(sla, FOUR_HOURS, at, {
              onReopen: random() < 0.5 ? 'continue' : 'restart',
              paused: random() < 0.3,
            }),
          () => expireSla(sla, FOUR_HOURS, at),
          () => clearSla(sla),
          () =>
            recomputeSla(
              sla,
              FOUR_HOURS,
              { targetMs: (1 + Math.floor(random() * 6)) * HOUR, calendar: null },
              at,
            ),
        ];
        const pick = operations[Math.floor(random() * operations.length)];
        if (pick === undefined) {
          continue;
        }
        const change = pick();
        if (!change.changed) {
          continue;
        }
        const next = change.sla;
        const label = `history ${String(history)} step ${String(step)} ${change.history}`;
        if ((next.expiresAt === null) !== (next.state === 'none' || next.state === 'paused')) {
          problems.push(`deadline ${label}`);
        }
        if (next.epoch < sla.epoch) {
          problems.push(`epoch ${label}`);
        }
        if (change.fires) {
          if (next.state !== 'expired' || firedInEpoch === next.epoch) {
            problems.push(`fires ${label}`);
          }
          firedInEpoch = next.epoch;
        }
        if ((next.state === 'running') !== (next.segmentStartedAt !== null)) {
          problems.push(`segment ${label}`);
        }
        if (next.consumedMs < 0) {
          problems.push(`consumed ${label}`);
        }
        sla = next;
      }
    }
    expect(problems).toEqual([]);
  });
});
