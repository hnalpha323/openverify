/**
 * C250.4 (Phase 11, Workflow 11B, platform-ops): on SIGTERM the worker stops taking jobs, lets the
 * running ones finish (or, past the pod's grace, lose their lease and be claimed again), and says so
 * in two lines with the drain's duration from the injected clock. Against a real Valkey:
 * `drain.integration.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import { drainWorkers } from './drain.js';

function clockAt(...times: number[]) {
  const queue = [...times];
  return { now: () => new Date(queue.shift() ?? 0) };
}

describe('drainWorkers (C250.4)', () => {
  it('says it drains, closes the workers, then says how long it took', async () => {
    const order: string[] = [];
    const logger = {
      info: vi.fn((object: Record<string, unknown>) => order.push(`info ${String(object.code)}`)),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const close = vi.fn(() => {
      order.push('close');
      return Promise.resolve();
    });

    await drainWorkers({ close }, { logger, clock: clockAt(1_000, 4_500) });

    expect(order).toEqual(['info worker_draining', 'close', 'info worker_drained']);
    expect(logger.info.mock.calls).toEqual([
      [
        { code: 'worker_draining' },
        'the worker stops taking jobs; running jobs finish, or lose their lease and are claimed again',
      ],
      [{ code: 'worker_drained', durationMs: 3_500 }, 'the worker drained'],
    ]);
  });

  it('logs a close that fails, with its error class, and passes it on', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const failure = new TypeError('connection lost');

    await expect(
      drainWorkers({ close: () => Promise.reject(failure) }, { logger, clock: clockAt(0, 10) }),
    ).rejects.toBe(failure);

    expect(logger.error.mock.calls).toEqual([
      [{ code: 'worker_drain_failed', error: 'TypeError' }, 'the worker did not drain'],
    ]);
  });
});
