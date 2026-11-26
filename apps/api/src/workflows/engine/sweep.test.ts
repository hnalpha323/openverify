/**
 * C117.4, C117.8, C117.9, C117.10 (`api-engine`): what stands behind the queue. A lapsed lease is
 * reclaimed, an enqueue lost with Valkey goes round, a run past its deadline ends, and admission keeps
 * an environment under its cap, with rotation and per-action caps. Every value is synthetic.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { WorkerLogger } from '../../jobs/logger.js';
import { runWorkflowStepSweep } from '../../jobs/workflows/sweeps.js';
import type { ActionHandler } from './action-port.js';
import { dispatchEnvironment, dispatchReadySteps } from './dispatcher.js';
import { runStepJob } from './executor.js';
import {
  action,
  chain,
  createEngineHarness,
  createEngineHarnessOn,
  drain,
  journalOf,
  publish,
  runOf,
  start,
  startOf,
  stepOf,
  type EngineHarness,
} from './testing.js';
import { checkValkeyEvictionPolicy } from './valkey-check.js';
import { engineDepsOf } from './worker-deps.js';

const SUBJECT = 'inq_01M5CK16P0D13FXHZSS4TCFBVH';

const tag: ActionHandler = {
  key: 'tag_object',
  version: 1,
  shape: 'transaction',
  execute: () =>
    Promise.resolve({
      kind: 'succeeded',
      output: { 'object-id': SUBJECT, outcome: 'applied', 'tag-count': 1 },
    }),
};

let harness: EngineHarness;

beforeAll(async () => {
  harness = await createEngineHarness([tag]);
}, 120_000);

afterAll(async () => {
  await harness.close();
});

const tagStep = action('t', 'tag_object', { 'object-type': 'inquiry', tag: 'x' });

describe('leases (C117.4)', () => {
  it('reclaims a step whose lease lapsed, and journals it', async () => {
    const id = await start(harness, chain([tagStep]));
    const claimed = await stepOf(harness, id, 't');
    harness.steps.jobs.splice(0);
    await harness.database.client.query(
      `update workflow_run_steps set status = 'running', claimed_by = 'dead-worker',
         claimed_until = now() - interval '1 minute', enqueued_at = null where id = $1`,
      [claimed.id],
    );

    await runWorkflowStepSweep(harness.deps);
    await drain(harness);

    expect(await journalOf(harness, id)).toContain('step_reclaimed:t');
    expect((await runOf(harness, id)).status).toBe('completed');
  });
});

describe('a lost Valkey (C117.9)', () => {
  it('enqueues again what was enqueued and never ran', async () => {
    const id = await start(harness, chain([tagStep]));
    harness.steps.jobs.splice(0);
    await harness.database.client.query(
      `update workflow_run_steps set enqueued_at = now() - interval '10 minutes' where run_id = $1`,
      [id],
    );

    await runWorkflowStepSweep(harness.deps);
    await drain(harness);

    expect((await runOf(harness, id)).status).toBe('completed');
  });

  it('delays work and loses none when an enqueue fails', async () => {
    const down = vi.spyOn(harness.steps, 'enqueueWorkflowStep');
    down.mockRejectedValueOnce(new Error('Valkey is down'));

    const id = await start(harness, chain([tagStep]));

    expect((await stepOf(harness, id, 't')).enqueuedAt).toBeNull();
    down.mockRestore();
    await runWorkflowStepSweep(harness.deps);
    await drain(harness);
    expect((await runOf(harness, id)).status).toBe('completed');
  });
});

describe('the run deadline (C117.7)', () => {
  it('ends a run past it as a run failure, which no resume can take back', async () => {
    const id = await start(
      harness,
      chain([{ id: 'pause', type: 'wait', name: 'Pause', mode: 'time', seconds: 7_200 }]),
    );
    await harness.database.client.query(
      `update workflow_runs set deadline_at = now() - interval '1 second' where id = $1`,
      [id],
    );

    await runWorkflowStepSweep(harness.deps);

    const run = await runOf(harness, id);
    expect(run.status).toBe('errored');
    expect(run.errorCode).toBe('run_deadline_exceeded');
    expect(run.errorType).toBe('run-failure');
    expect((await stepOf(harness, id, 'pause')).status).toBe('canceled');
  });
});

describe('a row that fails (Workflow 8C review R002)', () => {
  it('stops neither the other rows nor the dispatch: it is skipped and logged by id', async () => {
    const pause = chain([
      { id: 'pause', type: 'wait', name: 'Pause', mode: 'time', seconds: 7_200 },
    ]);
    const broken = await start(harness, pause);
    const healthy = await start(harness, pause);
    await harness.database.client.query(
      `update workflow_runs set deadline_at = now() - interval '1 second' where id = any($1)`,
      [[broken, healthy]],
    );
    // A run whose sealed state no longer opens: loading it throws.
    await harness.database.client.query(
      `update workflow_runs set variables = 'not-a-sealed-value', deadline_at = now() - interval '1 minute'
        where id = $1`,
      [broken],
    );
    const ready = await start(harness, chain([tagStep]));
    harness.steps.jobs.splice(0);
    await harness.database.client.query(
      `update workflow_run_steps set enqueued_at = null where run_id = $1`,
      [ready],
    );
    const warnings: Record<string, unknown>[] = [];
    const logger: WorkerLogger = {
      info: () => undefined,
      warn: (fields) => {
        warnings.push(fields);
      },
      error: () => undefined,
    };

    await runWorkflowStepSweep({ ...harness.deps, logger });

    expect((await runOf(harness, healthy)).errorCode).toBe('run_deadline_exceeded');
    expect((await runOf(harness, broken)).status).toBe('in_progress');
    expect(harness.steps.jobs.map(({ job }) => job.runId)).toContain(ready);
    expect(warnings).toEqual([expect.objectContaining({ runId: broken })]);
    expect(JSON.stringify(warnings)).not.toContain('not-a-sealed-value');
  });
});

describe('admission (C117.8)', () => {
  const stepsOfEnvironment = (of: EngineHarness) =>
    of.database.client.query<{ enqueued: number }>(
      `select count(*)::int as enqueued from workflow_run_steps
         where environment_id = $1 and status = 'ready' and enqueued_at is not null`,
      [of.environmentId],
    );

  it('holds an environment at its cap, and a completion pulls the next', async () => {
    const local = await createEngineHarness([tag]);
    try {
      await local.database.client.query(
        `insert into queue_slots (environment_id, queue, in_flight_cap) values ($1, 'workflow-step', 2)`,
        [local.environmentId],
      );
      const published = await publish(local, chain([tagStep]));
      const ids = [
        await startOf(local, published),
        await startOf(local, published),
        await startOf(local, published),
      ];

      expect(local.steps.jobs.length).toBe(2);
      expect((await stepsOfEnvironment(local)).rows[0]?.enqueued).toBe(2);

      await drain(local);

      for (const id of ids) {
        expect((await runOf(local, id)).status).toBe('completed');
      }
    } finally {
      await local.close();
    }
  });

  it('takes the environment’s setting, then the install’s', async () => {
    const local = await createEngineHarness([tag]);
    try {
      local.deps.inFlightCap = 1;
      const published = await publish(local, chain([tagStep]));
      await startOf(local, published);
      await startOf(local, published);
      expect(local.steps.jobs.length).toBe(1);

      await local.database.client.query(
        `update environments set settings = settings || '{"workflow-in-flight-cap": 5}'::jsonb
           where id = $1`,
        [local.environmentId],
      );
      await dispatchEnvironment(engineDepsOf(local.deps), local.environmentId);

      expect(local.steps.jobs.length).toBe(2);
    } finally {
      await local.close();
    }
  });

  it('holds a capped action to its share, and lets the steps behind it through', async () => {
    const code: ActionHandler = {
      key: 'evaluate_code',
      version: 1,
      shape: 'outside',
      execute: () => Promise.resolve({ kind: 'succeeded', output: {} }),
    };
    const local = await createEngineHarness([code, tag]);
    try {
      const engine = engineDepsOf(local.deps);
      engine.steps = undefined;
      const published = await publish(
        local,
        chain([
          action('c', 'evaluate_code', { source: 'x', properties: {}, 'return-type': 'none' }),
        ]),
      );
      const held = { ...local.deps, steps: undefined as never };
      for (let index = 0; index < 7; index += 1) {
        await startOf({ ...local, deps: held }, published);
      }
      const tagged = await publish(local, chain([tagStep]));
      await startOf({ ...local, deps: held }, tagged);
      await local.database.client.query(
        `update workflow_run_steps set status = 'running', claimed_by = 'x',
           claimed_until = now() + interval '1 hour'
           where id in (select id from workflow_run_steps where action_key = 'evaluate_code' limit 4)`,
      );

      await dispatchEnvironment(engineDepsOf(local.deps), local.environmentId);

      const keys = await local.database.client.query<{ key: string; count: number }>(
        `select action_key as key, count(*)::int as count from workflow_run_steps
           where status = 'ready' and enqueued_at is not null group by action_key`,
      );
      expect(Object.fromEntries(keys.rows.map(({ key, count }) => [key, count]))).toEqual({
        evaluate_code: 1,
        tag_object: 1,
      });
    } finally {
      await local.close();
    }
  });

  it('serves the environment longest unserved first', async () => {
    const other = await createEngineHarnessOn(harness);
    const published = await publish(harness, chain([tagStep]));
    const elsewhere = await publish(other, chain([tagStep]));
    const held = { ...harness.deps, steps: undefined as never };
    await startOf({ ...harness, deps: held }, published);
    await startOf({ ...other, deps: { ...other.deps, steps: undefined as never } }, elsewhere);
    await harness.database.client.query(
      `insert into queue_slots (environment_id, queue, last_served_at)
         values ($1, 'workflow-step', now())
         on conflict (environment_id, queue) do update set last_served_at = now()`,
      [harness.environmentId],
    );
    harness.steps.jobs.splice(0);

    await dispatchReadySteps(engineDepsOf(harness.deps));

    const order = harness.steps.jobs.map(({ job }) => job.environmentId);
    expect(order.indexOf(other.environmentId)).toBeLessThan(order.indexOf(harness.environmentId));
    await drain(harness);
  });

  it('admits no more than its room from what it over-reads', async () => {
    const local = await createEngineHarness([tag]);
    try {
      await local.database.client.query(
        `insert into queue_slots (environment_id, queue, in_flight_cap) values ($1, 'workflow-step', 1)`,
        [local.environmentId],
      );
      const published = await publish(local, chain([tagStep]));
      const held = { ...local, deps: { ...local.deps, steps: undefined as never } };
      await startOf(held, published);
      await startOf(held, published);

      await dispatchEnvironment(engineDepsOf(local.deps), local.environmentId);

      expect(local.steps.jobs.length).toBe(1);
    } finally {
      await local.close();
    }
  });

  it('sends a capped environment to the back of the rotation (R004)', async () => {
    const local = await createEngineHarness([tag]);
    try {
      await local.database.client.query(
        `insert into queue_slots (environment_id, queue, in_flight_cap) values ($1, 'workflow-step', 1)`,
        [local.environmentId],
      );
      const published = await publish(local, chain([tagStep]));
      await startOf(local, published);
      await startOf(local, published);
      expect(local.steps.jobs.length).toBe(1);
      const servedAt = () =>
        local.database.client.query<{ served: Date | null }>(
          `select last_served_at as served from queue_slots
            where environment_id = $1 and queue = 'workflow-step'`,
          [local.environmentId],
        );
      expect((await servedAt()).rows).toEqual([{ served: null }]);

      // At its cap the sweep admits nothing, and still takes its turn, so the next window moves on.
      await dispatchReadySteps(engineDepsOf(local.deps));

      expect(local.steps.jobs.length).toBe(1);
      expect((await servedAt()).rows[0]?.served).toBeInstanceOf(Date);
    } finally {
      await local.close();
    }
  });

  it('writes the rotation from the sweep alone, so a completion touches no hot row', async () => {
    const local = await createEngineHarness([tag]);
    try {
      await start(local, chain([tagStep]));
      await drain(local);

      const slots = await local.database.client.query(
        `select environment_id from queue_slots where environment_id = $1`,
        [local.environmentId],
      );
      expect(slots.rows).toEqual([]);
    } finally {
      await local.close();
    }
  });

  it('sends a schedule’s steps to the batch queue', async () => {
    const published = await publish(harness, chain([tagStep]));
    harness.steps.jobs.splice(0);

    await startOf(harness, published, { triggerType: 'trigger-recurring' });

    expect(harness.steps.jobs.at(-1)?.options).toEqual({ batch: true });
    await drain(harness);
  });
});

describe('the step job', () => {
  it('leaves a job for an unknown step alone', async () => {
    await expect(
      runStepJob(engineDepsOf(harness.deps), {
        environmentId: harness.environmentId,
        runId: 'wfr_01M5CK16P0D13FXHZSS4TCFBVH',
        stepId: 'wfst_01M5CK16P0D13FXHZSS4TCFBVH',
        attempt: 1,
      }),
    ).resolves.toBeUndefined();
  });
});

describe('the Valkey check (C117.10)', () => {
  const logger = () => ({ error: vi.fn() });

  it('says nothing for noeviction', async () => {
    const log = logger();
    await checkValkeyEvictionPolicy(
      { config: () => Promise.resolve(['maxmemory-policy', 'noeviction']) },
      log,
    );
    expect(log.error).not.toHaveBeenCalled();
  });

  it('logs an error for any other policy, and reads a record too', async () => {
    const log = logger();
    await checkValkeyEvictionPolicy(
      { config: () => Promise.resolve({ 'maxmemory-policy': 'allkeys-lru' }) },
      log,
    );
    expect(log.error).toHaveBeenCalledWith(
      { policy: 'allkeys-lru' },
      expect.stringContaining('noeviction'),
    );
  });

  it('logs an unreadable answer as unknown', async () => {
    const log = logger();
    await checkValkeyEvictionPolicy({ config: () => Promise.resolve(null) }, log);
    expect(log.error).toHaveBeenCalledWith({ policy: 'unknown' }, expect.any(String));
  });
});
