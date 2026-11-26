/**
 * C127.12 (Workflow 8A Stage 1b (A); V03): `list-rescreen`, which needs no workflow. The producer's
 * job carries ids alone, keyed by the list and version, and goes when it finishes; `dispatch()` wakes
 * it after the commit, best effort, because `list-rescreen-sweep` is the outbox; the worker runs both
 * whenever it runs lists. Synthetic values.
 */
import { newId } from '@openverify/contracts';
import type { Db } from '@openverify/db';
import { describe, expect, it, vi } from 'vitest';
import { createEventPublisher } from '../events/index.js';
import { createRefusingOutboundHttp } from '../test-support/fakes.js';
import type { ListRescreenQueue } from '../ports.js';
import {
  LIST_RESCREEN_INTERVAL_MS,
  LIST_RESCREEN_QUEUE,
  LIST_RESCREEN_SWEEP_QUEUE,
  createListRescreenQueue,
} from './list-rescreen-queue.js';
import { phase8RepeatableJobs, type RepeatableJobDeps } from './repeatable/index.js';
import { createCapturingLogger } from './testing.js';

const sweep = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('./reports/list-rescreen.js', () => ({
  runListRescreenSweep: sweep,
  processListRescreen: vi.fn(),
}));

function fakeQueue() {
  return {
    add: vi.fn<(...args: [string, unknown, unknown]) => Promise<void>>(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
  };
}

const job = { environmentId: newId('env'), listId: newId('lst'), listVersion: 3 };

describe('createListRescreenQueue', () => {
  it('names the queue and the sweep as C127.12 does, every 15 seconds', () => {
    expect(LIST_RESCREEN_QUEUE).toBe('list-rescreen');
    expect(LIST_RESCREEN_SWEEP_QUEUE).toBe('list-rescreen-sweep');
    expect(LIST_RESCREEN_INTERVAL_MS).toBe(15_000);
  });

  it('carries ids alone, one job per list version, gone when it finishes', async () => {
    const queue = fakeQueue();

    await createListRescreenQueue({ queue }).enqueueListRescreen(job);

    expect(queue.add).toHaveBeenCalledWith(LIST_RESCREEN_QUEUE, job, {
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
      jobId: `${job.listId}-3`,
    });
  });

  it('refuses anything but ids', async () => {
    const producer = createListRescreenQueue({ queue: fakeQueue() });

    await expect(producer.enqueueListRescreen({ ...job, listId: 'someone' })).rejects.toThrow(
      TypeError,
    );
    await expect(producer.enqueueListRescreen({ ...job, listVersion: 0 })).rejects.toThrow(
      TypeError,
    );
  });

  it('closes what it opened', async () => {
    const queue = fakeQueue();

    await createListRescreenQueue({ queue }).close();

    expect(queue.close).toHaveBeenCalledTimes(1);
  });
});

describe('dispatch() wakes it (C127.12)', () => {
  const staged = { eventId: newId('evt'), deliveries: [], listRescreens: [job] };
  const publisher = (listRescreens?: ListRescreenQueue) =>
    createEventPublisher({
      db: {} as Db,
      deliveries: { scheduleDelivery: () => Promise.resolve() },
      listRescreens,
      logger: createCapturingLogger(),
    });

  it('enqueues each request after the commit', async () => {
    const queue = { enqueueListRescreen: vi.fn(() => Promise.resolve()) };

    await publisher(queue).dispatch([staged]);

    expect(queue.enqueueListRescreen).toHaveBeenCalledWith(job);
  });

  it('fails nothing when the queue is down: the sweep is the outbox', async () => {
    const queue = { enqueueListRescreen: vi.fn(() => Promise.reject(new Error('down'))) };

    await expect(publisher(queue).dispatch([staged])).resolves.toBeUndefined();
  });

  it('asks nothing of a publisher with no producer', async () => {
    await expect(publisher().dispatch([staged])).resolves.toBeUndefined();
  });
});

describe('the sweep is registered (C143.1)', () => {
  const deps: RepeatableJobDeps = {
    db: {} as Db,
    clock: { now: () => new Date('2026-11-02T00:00:00Z') },
    logger: createCapturingLogger(),
    outboundHttp: createRefusingOutboundHttp(),
  };
  const rescreens = { enqueueListRescreen: () => Promise.resolve() };

  it('runs whenever the worker runs lists, with no workflow needed (C127.12)', async () => {
    const jobs = phase8RepeatableJobs(deps, undefined, rescreens);

    expect(jobs.map(({ name }) => name)).toEqual([LIST_RESCREEN_SWEEP_QUEUE]);
    expect(jobs[0]?.repeat).toEqual({ every: 15_000 });
    await jobs[0]?.run();
    expect(sweep).toHaveBeenCalledWith({
      db: deps.db,
      logger: deps.logger,
      rescreens,
    });
  });

  it('is absent from a worker that runs no lists', () => {
    expect(phase8RepeatableJobs(deps, undefined, undefined)).toEqual([]);
  });
});
