/**
 * C251.1, C251.4 (Workflow 11B, `quotas`; review H12): one admission model over every capped queue,
 * asserted by counts and order, never by timing. A fake store stands in for Postgres here; the
 * Testcontainers suite (`admission.integration.test.ts`) runs the same rules over the real queries.
 */
import { describe, expect, it } from 'vitest';
import { metrics } from '../../metrics-registry.js';
import { fixedClock } from '../../test-support/fakes.js';
import { createAtCapWatch, QUEUE_AT_CAP_WARN_AFTER_MS } from './at-cap.js';
import {
  admitEnvironment,
  QUOTA_METRICS,
  recoverLostWork,
  sweepQueue,
  type AdmissionDeps,
  type HeldRow,
  type LostRows,
  type QueueRows,
} from './admission.js';
import type { CappedQueue } from '@openverify/contracts';

const A = 'env_01J00000000000000000000AAA';
const B = 'env_01J00000000000000000000BBB';
const C = 'env_01J00000000000000000000CCC';

interface FakeRow {
  id: string;
  environmentId: string;
  heldSince: Date;
  admittedAt: Date | null;
  done: boolean;
}

interface Job {
  environmentId: string;
  id: string;
}

/** An in-memory queue table and its slots, with the order the SQL keeps. */
function fakeQueue(queue: CappedQueue = 'report-run') {
  const rows: FakeRow[] = [];
  const served = new Map<string, Date>();
  const locks: string[] = [];
  let seq = 0;
  const key = (environmentId: string) => `${environmentId}|${queue}`;
  const held = (environmentId: string) =>
    rows
      .filter((row) => row.environmentId === environmentId && row.admittedAt === null && !row.done)
      .sort((x, y) => x.heldSince.getTime() - y.heldSince.getTime() || (x.id < y.id ? -1 : 1));
  const store: QueueRows<Job> = {
    queue,
    countInFlight: (_tx, environmentId) =>
      Promise.resolve(
        rows.filter(
          (row) => row.environmentId === environmentId && row.admittedAt !== null && !row.done,
        ).length,
      ),
    claimHeld: (_tx, environmentId, limit) =>
      Promise.resolve(
        held(environmentId)
          .slice(0, limit)
          .map((row): HeldRow<Job> => ({
            id: row.id,
            heldSince: row.heldSince,
            job: { environmentId, id: row.id },
          })),
      ),
    markAdmitted: (_tx, environmentId, ids, at) => {
      for (const row of rows) {
        if (row.environmentId === environmentId && ids.includes(row.id)) {
          row.admittedAt = at;
        }
      }
      return Promise.resolve();
    },
    release: (_db, environmentId, ids) => {
      for (const row of rows) {
        if (row.environmentId === environmentId && ids.includes(row.id)) {
          row.admittedAt = null;
        }
      }
      return Promise.resolve();
    },
    listHeldEnvironments: (_db, limit) => {
      const environments = [
        ...new Set(
          rows.filter((r) => r.admittedAt === null && !r.done).map((r) => r.environmentId),
        ),
      ];
      environments.sort((x, y) => {
        const sx = served.get(key(x))?.getTime() ?? -Infinity;
        const sy = served.get(key(y))?.getTime() ?? -Infinity;
        return sx - sy || (x < y ? -1 : 1);
      });
      return Promise.resolve(environments.slice(0, limit));
    },
  };
  return {
    store,
    rows,
    locks,
    served,
    slots: {
      lock: (_tx: unknown, environmentId: string, name: CappedQueue) => {
        locks.push(`${environmentId}|${name}`);
        return Promise.resolve();
      },
      touch: (_tx: unknown, environmentId: string, name: CappedQueue, now: Date) => {
        served.set(`${environmentId}|${name}`, now);
        return Promise.resolve();
      },
    },
    add(environmentId: string, count: number, at: Date) {
      const ids: string[] = [];
      for (let index = 0; index < count; index += 1) {
        seq += 1;
        const id = `row${String(seq).padStart(5, '0')}`;
        rows.push({ id, environmentId, heldSince: at, admittedAt: null, done: false });
        ids.push(id);
      }
      return ids;
    },
    finish(ids: readonly string[]) {
      for (const row of rows) {
        if (ids.includes(row.id)) {
          row.done = true;
        }
      }
    },
    admitted(environmentId: string) {
      return rows.filter((row) => row.environmentId === environmentId && row.admittedAt !== null);
    },
    heldCount(environmentId: string) {
      return held(environmentId).length;
    },
  };
}

interface Logged {
  level: 'info' | 'warn' | 'error';
  object: Record<string, unknown>;
  message: string;
}

function harness(options: { caps?: Record<string, number>; queue?: CappedQueue } = {}) {
  const queue = fakeQueue(options.queue);
  const clock = fixedClock(new Date('2026-11-13T10:00:00.000Z'));
  const logged: Logged[] = [];
  const enqueued: Job[] = [];
  let failing = new Set<string>();
  const db = {
    transaction: <T>(fn: (tx: unknown) => Promise<T>) => fn(db),
  };
  const deps: AdmissionDeps = {
    db: db as never,
    clock,
    logger: {
      info: (object, message) => logged.push({ level: 'info', object, message }),
      warn: (object, message) => logged.push({ level: 'warn', object, message }),
      error: (object, message) => logged.push({ level: 'error', object, message }),
    },
    slots: queue.slots,
    capOf: (_tx, environmentId) => Promise.resolve(options.caps?.[environmentId] ?? 50),
    watch: createAtCapWatch(clock),
  };
  const enqueue = (job: Job) => {
    if (failing.has(job.id)) {
      return Promise.reject(new Error('synthetic enqueue failure'));
    }
    enqueued.push(job);
    return Promise.resolve();
  };
  return {
    ...queue,
    clock,
    deps,
    logged,
    enqueued,
    enqueue,
    failOn(ids: readonly string[]) {
      failing = new Set(ids);
    },
    metrics(name: string) {
      return logged.filter((entry) => entry.object.metric === name).map((entry) => entry.object);
    },
  };
}

describe('admitEnvironment: one environment’s admission (C251.1)', () => {
  it('admits held work up to the cap, oldest first, and holds the rest', async () => {
    const h = harness();
    const t0 = h.clock.now();
    const ids = h.add(A, 60, t0);

    const result = await admitEnvironment(h.deps, h.store, h.enqueue, A);

    expect(result).toEqual({
      queue: 'report-run',
      environmentId: A,
      inFlight: 0,
      cap: 50,
      admitted: ids.slice(0, 50),
      failed: [],
    });
    expect(h.enqueued.map((job) => job.id)).toEqual(ids.slice(0, 50));
    expect(h.heldCount(A)).toBe(10);
    expect(h.locks).toEqual([`${A}|report-run`]);
  });

  it('admits nothing while the environment is at its cap, and the next held row once a slot frees', async () => {
    const h = harness();
    const first = h.add(A, 50, h.clock.now());
    await admitEnvironment(h.deps, h.store, h.enqueue, A);
    h.clock.advance(1_000);
    const late = h.add(A, 2, h.clock.now());

    const capped = await admitEnvironment(h.deps, h.store, h.enqueue, A);
    expect(capped).toMatchObject({ inFlight: 50, cap: 50, admitted: [] });

    h.finish(first.slice(0, 1));
    const freed = await admitEnvironment(h.deps, h.store, h.enqueue, A);
    expect(freed).toMatchObject({ inFlight: 49, admitted: [late[0]] });
    expect(h.heldCount(A)).toBe(1);
  });

  it('takes a lowered cap below what is already in flight as no room', async () => {
    const h = harness({ caps: { [A]: 3 } });
    h.add(A, 5, h.clock.now());
    await admitEnvironment(h.deps, h.store, h.enqueue, A);
    expect(h.admitted(A)).toHaveLength(3);
    const lowered: AdmissionDeps = { ...h.deps, capOf: () => Promise.resolve(1) };
    expect(await admitEnvironment(lowered, h.store, h.enqueue, A)).toMatchObject({
      inFlight: 3,
      cap: 1,
      admitted: [],
    });
  });

  it('releases a row whose enqueue failed, so the sweep tries it again, and logs ids only', async () => {
    const h = harness();
    const ids = h.add(A, 3, h.clock.now());
    h.failOn([ids[1] ?? '']);

    const result = await admitEnvironment(h.deps, h.store, h.enqueue, A);

    expect(result.admitted).toEqual([ids[0], ids[2]]);
    expect(result.failed).toEqual([ids[1]]);
    expect(h.heldCount(A)).toBe(1);
    expect(h.logged.filter((entry) => entry.level === 'warn')).toEqual([
      {
        level: 'warn',
        object: { queue: 'report-run', environmentId: A, id: ids[1], error: 'Error' },
        message: 'admitted job not enqueued; held again',
      },
    ]);
  });

  it('does not rotate the environment when a producer admits (only the sweep writes last_served_at)', async () => {
    const h = harness();
    h.add(A, 1, h.clock.now());
    await admitEnvironment(h.deps, h.store, h.enqueue, A);
    expect(h.served.size).toBe(0);
    await admitEnvironment(h.deps, h.store, h.enqueue, A, { rotate: true });
    expect(h.served.get(`${A}|report-run`)).toEqual(h.clock.now());
  });
});

describe('sweepQueue: the fair sweep (C251.1; review H12: counts and order)', () => {
  it('admits a quiet environment’s job in the same tick while a flooder is held at its cap', async () => {
    const h = harness();
    const t0 = h.clock.now();
    h.add(A, 400, t0);
    h.clock.advance(60_000);
    const quiet = h.add(B, 1, h.clock.now());

    const tick = await sweepQueue(h.deps, h.store, h.enqueue);

    expect(tick).toEqual({ queue: 'report-run', environments: 2, admitted: 51, failed: 0 });
    expect(h.admitted(A)).toHaveLength(50);
    expect(h.admitted(B).map((row) => row.id)).toEqual(quiet);
    // The quiet environment's job is admitted before the flooder's queue drains.
    expect(h.heldCount(A)).toBe(350);
  });

  it('holds the flooder at the install ceiling too, and still admits the other environment', async () => {
    const h = harness({ caps: { [A]: 1000 } });
    h.add(A, 1500, h.clock.now());
    h.clock.advance(1);
    const quiet = h.add(B, 2, h.clock.now());

    await sweepQueue(h.deps, h.store, h.enqueue);

    expect(h.admitted(A)).toHaveLength(1000);
    expect(h.heldCount(A)).toBe(500);
    expect(h.admitted(B).map((row) => row.id)).toEqual(quiet);
  });

  it('takes environments in turn: never served first, then the longest unserved', async () => {
    const h = harness({ caps: { [A]: 1, [B]: 1, [C]: 1 } });
    h.add(A, 3, h.clock.now());
    h.add(B, 3, h.clock.now());
    await sweepQueue(h.deps, h.store, h.enqueue);
    // C arrives later and was never served: it goes first on the next tick.
    h.add(C, 1, h.clock.now());
    h.clock.advance(15_000);
    const order: string[] = [];
    const enqueue = (job: Job) => {
      order.push(job.environmentId);
      return h.enqueue(job);
    };
    h.finish(h.admitted(A).map((row) => row.id));
    h.finish(h.admitted(B).map((row) => row.id));
    await sweepQueue(h.deps, h.store, enqueue);
    expect(order).toEqual([C, A, B]);
  });

  it('counts an environment visited at its cap as served, so it goes to the back (R004)', async () => {
    const h = harness({ caps: { [A]: 1 } });
    h.add(A, 2, h.clock.now());
    await sweepQueue(h.deps, h.store, h.enqueue);
    h.clock.advance(15_000);
    await sweepQueue(h.deps, h.store, h.enqueue);
    expect(h.served.get(`${A}|report-run`)).toEqual(h.clock.now());
    expect(h.admitted(A)).toHaveLength(1);
  });

  it('visits at most the rotation limit of environments a tick', async () => {
    const h = harness();
    h.add(A, 1, h.clock.now());
    h.add(B, 1, h.clock.now());
    h.add(C, 1, h.clock.now());
    expect(await sweepQueue(h.deps, h.store, h.enqueue, { environmentLimit: 2 })).toMatchObject({
      environments: 2,
      admitted: 2,
    });
  });
});

describe('the sweep’s metrics and warn line (C251.4; C250.7: ids and counts only)', () => {
  it('names the three metrics', () => {
    expect(QUOTA_METRICS).toEqual({
      inFlight: 'queue_in_flight',
      cap: 'queue_in_flight_cap',
      admissionWait: 'queue_admission_wait_ms',
      atCap: 'queue_at_cap_ms',
    });
  });

  it('reports in-flight and cap per environment and queue it visits, and the longest wait it ended', async () => {
    const h = harness({ caps: { [A]: 2 } });
    h.add(A, 1, h.clock.now());
    h.clock.advance(4_000);
    h.add(A, 2, h.clock.now());
    h.clock.advance(1_000);

    await sweepQueue(h.deps, h.store, h.enqueue);

    const labels = { environmentId: A, queue: 'report-run' };
    expect(h.metrics('queue_in_flight')).toEqual([
      { metric: 'queue_in_flight', value: 0, ...labels },
    ]);
    expect(h.metrics('queue_in_flight_cap')).toEqual([
      { metric: 'queue_in_flight_cap', value: 2, ...labels },
    ]);
    expect(h.metrics('queue_admission_wait_ms')).toEqual([
      { metric: 'queue_admission_wait_ms', value: 5_000, ...labels },
    ]);
  });

  it('reports no wait when it admitted nothing, and no metric from a producer’s admission', async () => {
    const h = harness({ caps: { [A]: 1 } });
    h.add(A, 2, h.clock.now());
    await admitEnvironment(h.deps, h.store, h.enqueue, A);
    expect(h.logged).toEqual([]);
    await sweepQueue(h.deps, h.store, h.enqueue);
    expect(h.metrics('queue_admission_wait_ms')).toEqual([]);
    expect(h.metrics('queue_in_flight')).toHaveLength(1);
  });

  it('warns once when an environment with held work sits at its cap for more than five minutes', async () => {
    const h = harness({ caps: { [A]: 1 } });
    h.add(A, 3, h.clock.now());
    await sweepQueue(h.deps, h.store, h.enqueue);
    h.clock.advance(QUEUE_AT_CAP_WARN_AFTER_MS);
    await sweepQueue(h.deps, h.store, h.enqueue);
    expect(h.logged.filter((entry) => entry.level === 'warn')).toEqual([]);
    h.clock.advance(1);
    await sweepQueue(h.deps, h.store, h.enqueue);
    h.clock.advance(60_000);
    await sweepQueue(h.deps, h.store, h.enqueue);
    expect(h.logged.filter((entry) => entry.level === 'warn')).toEqual([
      {
        level: 'warn',
        object: {
          environmentId: A,
          queue: 'report-run',
          inFlight: 1,
          cap: 1,
          atCapMs: QUEUE_AT_CAP_WARN_AFTER_MS + 1,
        },
        message: 'environment at its queue in-flight cap for more than five minutes',
      },
    ]);
    // The warn line's figure is also the registered metric, with its two labels only.
    expect(h.metrics('queue_at_cap_ms')).toEqual([
      {
        metric: 'queue_at_cap_ms',
        value: QUEUE_AT_CAP_WARN_AFTER_MS + 1,
        environmentId: A,
        queue: 'report-run',
      },
    ]);
  });

  it('registers each of its metrics in metrics-registry.ts, labelled by environment and queue (rule 20)', () => {
    for (const name of Object.values(QUOTA_METRICS)) {
      expect(metrics.get(name)).toMatchObject({
        name,
        labels: ['environmentId', 'queue'],
        owner: 'quotas',
        contract: 'C251.4',
      });
    }
  });

  it('forgets an environment the sweep no longer visits, so a later backlog starts its own five minutes', async () => {
    const h = harness({ caps: { [A]: 1 } });
    const ids = h.add(A, 2, h.clock.now());
    await sweepQueue(h.deps, h.store, h.enqueue);
    // The held row is cancelled elsewhere: nothing waits, so the sweep does not visit A.
    h.finish(ids.slice(1));
    h.clock.advance(QUEUE_AT_CAP_WARN_AFTER_MS * 2);
    await sweepQueue(h.deps, h.store, h.enqueue);
    h.add(A, 1, h.clock.now());
    await sweepQueue(h.deps, h.store, h.enqueue);
    h.clock.advance(1_000);
    await sweepQueue(h.deps, h.store, h.enqueue);
    expect(h.logged.filter((entry) => entry.level === 'warn')).toEqual([]);
  });
});

describe('recoverLostWork: admitted work whose job was lost (KP11-17, KP10-27)', () => {
  function lostRows(found: readonly Job[]) {
    const lost = found.map((job) => ({ environmentId: job.environmentId, id: job.id, job }));
    const asked: { before: Date; limit: number }[] = [];
    const rows: LostRows<Job> = {
      queue: 'connect-redeem',
      listLost: (_db, options) => {
        asked.push(options);
        return Promise.resolve(lost);
      },
    };
    return { rows, asked };
  }

  it('re-enqueues each admitted row older than the grace period, by its own job id', async () => {
    const h = harness();
    const found = [
      { environmentId: A, id: 'cnst_1' },
      { environmentId: B, id: 'cnst_2' },
    ];
    const { rows, asked } = lostRows(found);

    const result = await recoverLostWork(h.deps, rows, h.enqueue, { graceMs: 120_000 });

    expect(asked).toEqual([{ before: new Date('2026-11-13T09:58:00.000Z'), limit: 500 }]);
    expect(h.enqueued).toEqual(found);
    expect(result).toEqual({ queue: 'connect-redeem', selected: 2, enqueued: 2, failed: 0 });
    expect(h.logged).toEqual([
      {
        level: 'info',
        object: { queue: 'connect-redeem', selected: 2, failed: 0 },
        message: 'admitted work enqueued again',
      },
    ]);
  });

  it('logs a failed re-enqueue by id and goes on; the next pass tries it again', async () => {
    const h = harness();
    const found = [
      { environmentId: A, id: 'cnst_1' },
      { environmentId: A, id: 'cnst_2' },
    ];
    h.failOn(['cnst_1']);
    const { rows } = lostRows(found);
    const result = await recoverLostWork(h.deps, rows, h.enqueue, { graceMs: 60_000, limit: 10 });
    expect(result).toEqual({ queue: 'connect-redeem', selected: 2, enqueued: 1, failed: 1 });
    expect(h.logged[0]).toEqual({
      level: 'error',
      object: { queue: 'connect-redeem', environmentId: A, id: 'cnst_1', error: 'Error' },
      message: 'admitted work not enqueued again',
    });
  });

  it('logs nothing when nothing was lost', async () => {
    const h = harness();
    const { rows } = lostRows([]);
    expect(await recoverLostWork(h.deps, rows, h.enqueue, { graceMs: 60_000 })).toEqual({
      queue: 'connect-redeem',
      selected: 0,
      enqueued: 0,
      failed: 0,
    });
    expect(h.logged).toEqual([]);
  });
});
