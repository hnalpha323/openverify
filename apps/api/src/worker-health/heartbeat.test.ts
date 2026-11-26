/**
 * C250.2 (Phase 11, Workflow 11B, platform-ops): the worker writes its heartbeat file at start and
 * then every `WORKER_HEARTBEAT.intervalMs` from its event loop (the time of the write, in epoch
 * milliseconds, the form `worker-health.ts` reads), logs the heartbeat's age as the registered metric
 * `worker_heartbeat_age_ms`, warns once while the file cannot be written, and stops writing when the
 * worker closes. Time comes from the injected clock and the ticks from the injected schedule.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WORKER_HEARTBEAT } from '@openverify/contracts';
import { describe, expect, it, vi } from 'vitest';
import { checkWorkerHeartbeat } from '../worker-health.js';
import { startWorkerHeartbeat } from './heartbeat.js';

const START = Date.parse('2026-11-13T12:00:00.000Z');

function harness(failWrites = 0) {
  let now = START;
  let tick: (() => void) | undefined;
  let interval = 0;
  let cancelled = 0;
  const files = new Map<string, string>();
  let failing = failWrites;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const heartbeat = startWorkerHeartbeat({
    file: '/run/ov/heartbeat',
    logger,
    clock: { now: () => new Date(now) },
    schedule: (callback, ms) => {
      tick = callback;
      interval = ms;
      return () => {
        cancelled += 1;
      };
    },
    writeFile: (path, text) => {
      if (failing > 0) {
        failing -= 1;
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      }
      files.set(path, text);
    },
  });
  return {
    heartbeat,
    logger,
    files,
    interval: () => interval,
    cancelled: () => cancelled,
    advance(ms: number) {
      now += ms;
      tick?.();
    },
    now: () => now,
  };
}

describe('the worker heartbeat (C250.2)', () => {
  it('writes the time at start and every 10 s, which the probe reads as fresh', () => {
    const h = harness();

    expect(h.interval()).toBe(WORKER_HEARTBEAT.intervalMs);
    expect(h.files.get('/run/ov/heartbeat')).toBe(`${String(START)}\n`);
    h.advance(10_000);
    expect(h.files.get('/run/ov/heartbeat')).toBe(`${String(START + 10_000)}\n`);
    expect(checkWorkerHeartbeat(h.files.get('/run/ov/heartbeat') ?? null, h.now() + 5000)).toEqual({
      healthy: true,
      state: 'fresh',
      ageMs: 5000,
    });
  });

  it('logs the age each write replaces as worker_heartbeat_age_ms', () => {
    const h = harness();

    h.advance(10_000);
    h.advance(12_500);

    expect(h.logger.info.mock.calls).toEqual([
      [{ metric: 'worker_heartbeat_age_ms', value: 10_000 }, 'metric'],
      [{ metric: 'worker_heartbeat_age_ms', value: 12_500 }, 'metric'],
    ]);
  });

  it('warns once while the file cannot be written, naming no path, and writes again after', () => {
    const h = harness(3);

    h.advance(10_000);
    h.advance(10_000);
    h.advance(10_000);

    expect(h.logger.warn.mock.calls).toEqual([
      [
        { code: 'worker_heartbeat_unwritable', error: 'Error' },
        'the worker heartbeat file cannot be written; the exec probe will call this worker stuck',
      ],
    ]);
    expect(h.files.get('/run/ov/heartbeat')).toBe(`${String(START + 30_000)}\n`);
    expect(JSON.stringify(h.logger.warn.mock.calls)).not.toContain('/run/ov');
  });

  it('stops writing when the worker closes, and a second stop resolves at once', async () => {
    const h = harness();

    await h.heartbeat.stop();
    await h.heartbeat.stop();

    expect(h.cancelled()).toBe(1);
  });

  it('replaces a real file whole by default, leaving no temporary file', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'openverify-heartbeat-'));
    try {
      const file = join(directory, 'heartbeat');
      const heartbeat = startWorkerHeartbeat({
        file,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        clock: { now: () => new Date(START) },
      });
      await heartbeat.stop();

      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file, 'utf8')).toBe(`${String(START)}\n`);
      expect(readdirSync(directory)).toEqual(['heartbeat']);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
