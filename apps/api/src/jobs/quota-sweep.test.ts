/**
 * C251.1, C251.4 (Workflow 11B, `quotas`; KP11-17, KP10-27): the worker's two quota passes over every
 * capped queue it holds a producer for, asserted by counts and order over fake stores (review H12).
 */
import type { CappedQueue } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { fixedClock } from '../test-support/fakes.js';
import type { AdmissionDeps, HeldRow, LostRow, QueueRows } from '../services/quotas/admission.js';
import { createAtCapWatch } from '../services/quotas/at-cap.js';
import {
  QUOTA_RECOVERY_GRACE_MS,
  QUOTA_RECOVERY_INTERVAL_MS,
  QUOTA_RECOVERY_QUEUE,
  QUOTA_SWEEP_INTERVAL_MS,
  QUOTA_SWEEP_QUEUE,
  quotaQueuePass,
  quotaRepeatableJobs,
  runQuotaRecovery,
  runQuotaSweep,
  type AdmissionQueue,
} from './quota-sweep.js';

const A = 'env_01J00000000000000000000AAA';
const B = 'env_01J00000000000000000000BBB';
const T0 = new Date('2026-11-13T10:00:00.000Z');

interface Row {
  id: string;
  environmentId: string;
  heldSince: Date;
  admittedAt: Date | null;
}

interface Logged {
  level: 'info' | 'warn' | 'error';
  object: Record<string, unknown>;
  message: string;
}

function harness() {
  const clock = fixedClock(T0);
  const logged: Logged[] = [];
  const db = { transaction: <T>(fn: (tx: unknown) => Promise<T>) => fn(db) };
  const deps: AdmissionDeps = {
    db: db as never,
    clock,
    logger: {
      info: (object, message) => logged.push({ level: 'info', object, message }),
      warn: (object, message) => logged.push({ level: 'warn', object, message }),
      error: (object, message) => logged.push({ level: 'error', object, message }),
    },
    slots: { lock: () => Promise.resolve(), touch: () => Promise.resolve() },
    capOf: () => Promise.resolve(2),
    watch: createAtCapWatch(clock),
  };
  return { clock, logged, deps };
}

/** A fake queue of string jobs (the row id), with the order the SQL keeps. */
function fakeQueue(
  queue: CappedQueue,
  options: { failSweep?: boolean; lost?: boolean; failLost?: boolean } = {},
) {
  const rows: Row[] = [];
  const enqueued: string[] = [];
  const held = (environmentId: string) =>
    rows
      .filter((row) => row.environmentId === environmentId && row.admittedAt === null)
      .sort((x, y) => x.heldSince.getTime() - y.heldSince.getTime() || (x.id < y.id ? -1 : 1));
  const store: QueueRows<string> = {
    queue,
    countInFlight: (_tx, environmentId) =>
      Promise.resolve(
        rows.filter((row) => row.environmentId === environmentId && row.admittedAt !== null).length,
      ),
    claimHeld: (_tx, environmentId, limit) =>
      Promise.resolve(
        held(environmentId)
          .slice(0, limit)
          .map((row): HeldRow<string> => ({ id: row.id, heldSince: row.heldSince, job: row.id })),
      ),
    markAdmitted: (_tx, _environmentId, ids, at) => {
      for (const row of rows) {
        if (ids.includes(row.id)) {
          row.admittedAt = at;
        }
      }
      return Promise.resolve();
    },
    release: () => Promise.resolve(),
    listHeldEnvironments: () =>
      options.failSweep === true
        ? Promise.reject(new Error('synthetic database failure'))
        : Promise.resolve(
            [
              ...new Set(rows.filter((r) => r.admittedAt === null).map((r) => r.environmentId)),
            ].sort(),
          ),
  };
  const lostBefore: Date[] = [];
  const admissionQueue: AdmissionQueue<string> = {
    rows: store,
    enqueue: (job) => {
      enqueued.push(job);
      return Promise.resolve();
    },
    ...(options.lost === true
      ? {
          lost: {
            queue,
            listLost: (_db, { before, limit }) => {
              lostBefore.push(before);
              if (options.failLost === true) {
                return Promise.reject(new Error('synthetic database failure'));
              }
              return Promise.resolve(
                rows
                  .filter((row) => row.admittedAt !== null && row.admittedAt < before)
                  .slice(0, limit)
                  .map((row): LostRow<string> => ({
                    environmentId: row.environmentId,
                    id: row.id,
                    job: row.id,
                  })),
              );
            },
          },
        }
      : {}),
  };
  return {
    rows,
    enqueued,
    lostBefore,
    pass: quotaQueuePass(admissionQueue),
    add(environmentId: string, ids: readonly string[], heldSince = T0) {
      for (const id of ids) {
        rows.push({ id, environmentId, heldSince, admittedAt: null });
      }
    },
  };
}

describe('runQuotaSweep (C251.1)', () => {
  it('sweeps each queue in turn, each environment up to its cap, oldest first', async () => {
    const { deps } = harness();
    const reports = fakeQueue('report-run');
    const verifications = fakeQueue('process-verification');
    reports.add(
      A,
      ['r3', 'r1', 'r2'].map((id) => `rpt_${id}`),
    );
    reports.add(B, ['rpt_b1']);
    verifications.add(A, ['ver_a1']);

    const result = await runQuotaSweep(deps, [reports.pass, verifications.pass]);

    expect(result.errors).toEqual([]);
    expect(result.queues).toEqual([
      { queue: 'report-run', environments: 2, admitted: 3, failed: 0 },
      { queue: 'process-verification', environments: 1, admitted: 1, failed: 0 },
    ]);
    // A's cap is 2: its two oldest by (held since, id), then B's one.
    expect(reports.enqueued).toEqual(['rpt_r1', 'rpt_r2', 'rpt_b1']);
    expect(verifications.enqueued).toEqual(['ver_a1']);
  });

  it("logs a queue's failure by its name and sweeps the other queues", async () => {
    const { deps, logged } = harness();
    const broken = fakeQueue('list-screen', { failSweep: true });
    const reports = fakeQueue('report-run');
    reports.add(A, ['rpt_1']);

    const result = await runQuotaSweep(deps, [broken.pass, reports.pass]);

    expect(result.errors).toEqual(['list-screen']);
    expect(result.queues).toEqual([
      { queue: 'report-run', environments: 1, admitted: 1, failed: 0 },
    ]);
    expect(reports.enqueued).toEqual(['rpt_1']);
    const failure = logged.find((entry) => entry.level === 'error');
    expect(failure?.object).toEqual({
      queue: QUOTA_SWEEP_QUEUE,
      admittedQueue: 'list-screen',
      error: 'Error',
    });
    // Ids and names only: the error's message never reaches the log.
    expect(JSON.stringify(logged)).not.toContain('synthetic database failure');
  });
});

describe('runQuotaRecovery (KP11-17, KP10-27)', () => {
  it('enqueues again admitted work older than the grace period, only in queues with lost rows', async () => {
    const { deps, clock } = harness();
    const tokens = fakeQueue('connect-redeem', { lost: true });
    const reports = fakeQueue('report-run');
    tokens.add(A, ['cnst_old', 'cnst_new']);
    reports.add(A, ['rpt_1']);
    await runQuotaSweep(deps, [tokens.pass, reports.pass]);
    tokens.enqueued.length = 0;
    // cnst_new is admitted later; a held token is never selected (the fake lists admitted rows only).
    const late = tokens.rows.find((row) => row.id === 'cnst_new');
    if (late !== undefined) {
      late.admittedAt = new Date(T0.getTime() + QUOTA_RECOVERY_GRACE_MS);
    }
    tokens.add(A, ['cnst_held']);
    clock.advance(QUOTA_RECOVERY_GRACE_MS + 1);

    const result = await runQuotaRecovery(deps, [tokens.pass, reports.pass]);

    expect(result).toEqual({
      queues: [{ queue: 'connect-redeem', selected: 1, enqueued: 1, failed: 0 }],
      errors: [],
    });
    expect(tokens.enqueued).toEqual(['cnst_old']);
    expect(tokens.lostBefore).toEqual([new Date(T0.getTime() + 1)]);
    expect(reports.pass.recover).toBeNull();
  });

  it("logs a queue's failed recovery and goes on", async () => {
    const { deps, logged } = harness();
    const broken = fakeQueue('integrity-decode', { lost: true, failLost: true });
    const tokens = fakeQueue('connect-redeem', { lost: true });

    const result = await runQuotaRecovery(deps, [broken.pass, tokens.pass]);

    expect(result.errors).toEqual(['integrity-decode']);
    expect(result.queues).toEqual([
      { queue: 'connect-redeem', selected: 0, enqueued: 0, failed: 0 },
    ]);
    expect(logged.filter((entry) => entry.level === 'error').map((entry) => entry.object)).toEqual([
      { queue: QUOTA_RECOVERY_QUEUE, admittedQueue: 'integrity-decode', error: 'Error' },
    ]);
    expect(JSON.stringify(logged)).not.toContain('synthetic database failure');
  });
});

describe('quotaRepeatableJobs', () => {
  it('schedules the sweep every 15 s and the recovery every minute', async () => {
    const { deps } = harness();
    const tokens = fakeQueue('connect-redeem', { lost: true });
    tokens.add(A, ['cnst_1']);

    const jobs = quotaRepeatableJobs(deps, [tokens.pass]);

    expect(jobs.map(({ name, repeat }) => ({ name, repeat }))).toEqual([
      { name: QUOTA_SWEEP_QUEUE, repeat: { every: QUOTA_SWEEP_INTERVAL_MS } },
      { name: QUOTA_RECOVERY_QUEUE, repeat: { every: QUOTA_RECOVERY_INTERVAL_MS } },
    ]);
    expect(QUOTA_SWEEP_INTERVAL_MS).toBe(15_000);
    expect(QUOTA_RECOVERY_INTERVAL_MS).toBe(60_000);
    await expect(jobs[0]?.run()).resolves.toMatchObject({ errors: [] });
    expect(tokens.enqueued).toEqual(['cnst_1']);
    await expect(jobs[1]?.run()).resolves.toMatchObject({ errors: [] });
  });

  it('schedules no recovery when no queue has lost rows, and nothing without a queue', () => {
    const { deps } = harness();
    expect(
      quotaRepeatableJobs(deps, [fakeQueue('report-run').pass]).map((job) => job.name),
    ).toEqual([QUOTA_SWEEP_QUEUE]);
    expect(quotaRepeatableJobs(deps, [])).toEqual([]);
  });
});
