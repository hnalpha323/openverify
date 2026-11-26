/**
 * C250.4 (hardening 7.2): on SIGTERM the worker stops taking jobs and finishes or releases its
 * fenced claims (Phase 6 C74.1) before it closes its connections; the chart's
 * `terminationGracePeriodSeconds` exceeds the longest job's lease.
 *
 * The worker's `close` calls `drainWorkers` where it closed its BullMQ workers (foundation-11b's
 * hook; built by platform-ops, Workflow 11B).
 */
import type { WorkerLogger } from '../jobs/logger.js';
import { systemClock, type Clock } from '../ports.js';

/** The running BullMQ workers, as `startWorkers` answers them. */
export interface DrainableWorkers {
  close(): Promise<void>;
}

export interface DrainOptions {
  readonly logger: WorkerLogger;
  /** For the drain's duration in its last log line; the system clock by default. */
  readonly clock?: Clock;
}

/** Stops taking jobs and lets the running ones finish or release their claims, then closes. */
export async function drainWorkers(
  workers: DrainableWorkers,
  options: DrainOptions,
): Promise<void> {
  const clock = options.clock ?? systemClock;
  const started = clock.now().getTime();
  options.logger.info(
    { code: 'worker_draining' },
    'the worker stops taking jobs; running jobs finish, or lose their lease and are claimed again',
  );
  try {
    // BullMQ's close fetches no further job and waits for the running ones (C74.1's claims are
    // released by their own processors, or expire with their lease past the pod's grace).
    await workers.close();
  } catch (error) {
    options.logger.error(
      { code: 'worker_drain_failed', error: (error as Error).name },
      'the worker did not drain',
    );
    throw error;
  }
  options.logger.info(
    { code: 'worker_drained', durationMs: clock.now().getTime() - started },
    'the worker drained',
  );
}
