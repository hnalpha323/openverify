/**
 * `node dist/worker-health.js` (C250.2; Phase 11, Workflow 11B, platform-ops): the worker's exec
 * probe. It exits 0 while the heartbeat file (`OPENVERIFY_WORKER_HEARTBEAT_FILE`, default
 * `WORKER_HEARTBEAT.defaultFile`) holds a time at most `WORKER_HEARTBEAT.maxAgeMs` (30 s) old,
 * else 1. The worker writes the file every `intervalMs` (10 s) from its event loop
 * (`worker-health/heartbeat.ts`), so a stuck loop stops writing; no port is opened. It reads only
 * that variable and the file, never the worker's configuration, so a probe stays cheap.
 *
 * The file holds the write's time as epoch milliseconds in decimal and a newline.
 */

import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WORKER_HEARTBEAT } from '@openverify/contracts';

/** Why the probe answered as it did. */
export type HeartbeatState = 'fresh' | 'stale' | 'missing' | 'unreadable';

export interface HeartbeatCheck {
  healthy: boolean;
  state: HeartbeatState;
  /** Milliseconds since the last write, when the file held a time. */
  ageMs: number | null;
}

/** The heartbeat's verdict from the file's text (`null` when it could not be read). */
export function checkWorkerHeartbeat(text: string | null, nowMs: number): HeartbeatCheck {
  if (text === null) {
    return { healthy: false, state: 'missing', ageMs: null };
  }
  const written = /^\d{1,16}\n?$/u.test(text) ? Number(text.trim()) : Number.NaN;
  const ageMs = nowMs - written;
  // A time further ahead than the window is not a clock's small skew: the file is not ours.
  if (Number.isNaN(written) || ageMs < -WORKER_HEARTBEAT.maxAgeMs) {
    return { healthy: false, state: 'unreadable', ageMs: null };
  }
  const healthy = ageMs <= WORKER_HEARTBEAT.maxAgeMs;
  return { healthy, state: healthy ? 'fresh' : 'stale', ageMs };
}

/** The file the worker writes: the variable, when it is an absolute path, else the default. */
export function heartbeatFileOf(env: NodeJS.ProcessEnv): string {
  const file = env.OPENVERIFY_WORKER_HEARTBEAT_FILE?.trim() ?? '';
  return file !== '' && isAbsolute(file) ? file : WORKER_HEARTBEAT.defaultFile;
}

export interface WorkerHealthIo {
  env: NodeJS.ProcessEnv;
  nowMs: number;
  /** The file's text, or `null` when it does not exist or cannot be read. */
  readFile: (path: string) => string | null;
  out: (line: string) => void;
}

const seconds = (ms: number): string => String(Math.round(ms / 1000));

/** The probe. @returns its exit code: 0 fresh, 1 otherwise. */
export function runWorkerHealth(io: WorkerHealthIo): number {
  const check = checkWorkerHeartbeat(io.readFile(heartbeatFileOf(io.env)), io.nowMs);
  switch (check.state) {
    case 'fresh':
      io.out(`worker-health: fresh, last heartbeat ${seconds(check.ageMs ?? 0)} s ago`);
      break;
    case 'stale':
      io.out(
        `worker-health: stale, last heartbeat ${seconds(check.ageMs ?? 0)} s ago ` +
          `(at most ${seconds(WORKER_HEARTBEAT.maxAgeMs)} s)`,
      );
      break;
    case 'missing':
      io.out('worker-health: missing, no heartbeat file');
      break;
    case 'unreadable':
      io.out('worker-health: unreadable, the heartbeat file holds no time');
      break;
  }
  return check.healthy ? 0 : 1;
}

/* v8 ignore start -- the entry point, run by the exec probe only */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runWorkerHealth({
    env: process.env,
    nowMs: Date.now(),
    readFile: (path) => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null;
      }
    },
    out: (line) => process.stdout.write(`${line}\n`),
  });
}
/* v8 ignore stop */
