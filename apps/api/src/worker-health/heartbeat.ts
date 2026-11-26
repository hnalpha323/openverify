/**
 * C250.2 (hardening 7.2): the worker writes a heartbeat file (`OPENVERIFY_WORKER_HEARTBEAT_FILE`,
 * default `/tmp/openverify-worker-heartbeat`) every 10 s from its event loop, so an exec probe
 * (`node dist/worker-health.js`) can tell a live worker from a stuck one; no port is opened.
 *
 * The worker's `main` calls `startWorkerHeartbeat` once its workers run and `stop` first when it
 * closes (foundation-11b's hook; built by platform-ops, Workflow 11B).
 */
import { renameSync, writeFileSync } from 'node:fs';
import { WORKER_HEARTBEAT } from '@openverify/contracts';
import type { WorkerLogger } from '../jobs/logger.js';
import { metrics } from '../metrics-registry.js';
import { systemClock, type Clock } from '../ports.js';

export interface WorkerHeartbeatOptions {
  /** The file to touch (an absolute path). */
  readonly file: string;
  readonly logger: WorkerLogger;
  readonly clock?: Clock;
  /** Calls `tick` every `intervalMs` until cancelled; `setInterval`, unreferenced, by default. */
  readonly schedule?: (tick: () => void, intervalMs: number) => () => void;
  /** Writes the file whole; an atomic replace by default. */
  readonly writeFile?: (path: string, text: string) => void;
}

/** A running heartbeat. */
export interface WorkerHeartbeat {
  /** Stops writing; later calls resolve at once. */
  stop(): Promise<void>;
}

/** The default schedule: the worker's own event loop, never keeping the process alive. */
function intervalSchedule(tick: () => void, intervalMs: number): () => void {
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => {
    clearInterval(timer);
  };
}

/** The default writer: a temporary file renamed over the heartbeat, so a probe never reads half. */
function replaceFile(path: string, text: string): void {
  const temporary = `${path}.${String(process.pid)}.tmp`;
  writeFileSync(temporary, text, { mode: 0o644 });
  renameSync(temporary, path);
}

/**
 * Starts writing the heartbeat file: at once, then every `WORKER_HEARTBEAT.intervalMs`. Each write
 * holds its time in epoch milliseconds and a newline, the form `worker-health.ts` reads, and logs
 * the age of the write it replaces as `worker_heartbeat_age_ms` (C250.7), so a stalled event loop
 * shows as a growing age before the probe fails. A file that cannot be written is one warning,
 * naming no path, until a write succeeds again.
 */
export function startWorkerHeartbeat(options: WorkerHeartbeatOptions): WorkerHeartbeat {
  const clock = options.clock ?? systemClock;
  const writeFile = options.writeFile ?? replaceFile;
  let last: number | null = null;
  let failing = false;
  const beat = (): void => {
    const now = clock.now().getTime();
    try {
      writeFile(options.file, `${String(now)}\n`);
    } catch (error) {
      if (!failing) {
        failing = true;
        options.logger.warn(
          { code: 'worker_heartbeat_unwritable', error: (error as Error).name },
          'the worker heartbeat file cannot be written; the exec probe will call this worker stuck',
        );
      }
      return;
    }
    failing = false;
    if (last !== null) {
      metrics.emit(options.logger, 'worker_heartbeat_age_ms', now - last);
    }
    last = now;
  };
  beat();
  const cancel = (options.schedule ?? intervalSchedule)(beat, WORKER_HEARTBEAT.intervalMs);
  let stopped = false;
  return {
    stop() {
      if (!stopped) {
        stopped = true;
        cancel();
      }
      return Promise.resolve();
    },
  };
}
