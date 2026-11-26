/**
 * C250.4 (Phase 11, Workflow 11B, platform-ops), against a real Valkey (`valkey/valkey:9.1`) and
 * BullMQ: once `drainWorkers` starts, the worker takes no new job, and the job it was running
 * finishes before the drain resolves.
 */
import { Queue, Worker } from 'bullmq';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { drainWorkers } from './drain.js';
import { VALKEY_TEST_IMAGE } from '../test-support/integration-valkey.js';

let valkey: StartedTestContainer;
let connection: { host: string; port: number };

beforeAll(async () => {
  valkey = await new GenericContainer(VALKEY_TEST_IMAGE)
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();
  connection = { host: valkey.getHost(), port: valkey.getMappedPort(6379) };
});

afterAll(async () => {
  await valkey.stop();
});

describe('the drain on a real queue (C250.4)', () => {
  it('finishes the running job and takes no new one', async () => {
    const queue = new Queue('drain-test', { connection });
    const processed: string[] = [];
    let release: () => void = () => undefined;
    let started: () => void = () => undefined;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const worker = new Worker(
      'drain-test',
      async (job) => {
        started();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        processed.push(job.name);
      },
      { connection, concurrency: 1 },
    );
    try {
      await queue.add('first', {});
      await running;

      const drained = drainWorkers(
        { close: () => worker.close() },
        { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
      );
      const second = await queue.add('second', {});
      release();
      await drained;

      expect(processed).toEqual(['first']);
      expect(await queue.getJobState(second.id ?? '')).toBe('waiting');
    } finally {
      await worker.close();
      await queue.close();
    }
  });
});
