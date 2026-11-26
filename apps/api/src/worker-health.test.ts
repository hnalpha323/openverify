/**
 * C250.2 (Phase 11, Workflow 11B, platform-ops): the worker's exec probe answers 0 while the
 * heartbeat file is at most 30 s old and 1 when it is older, missing, unreadable or not a time;
 * it reads `OPENVERIFY_WORKER_HEARTBEAT_FILE` (an absolute path) or the default file.
 */
import { WORKER_HEARTBEAT } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { checkWorkerHeartbeat, heartbeatFileOf, runWorkerHealth } from './worker-health.js';

const NOW = Date.parse('2026-11-13T12:00:00.000Z');

describe('checkWorkerHeartbeat (C250.2)', () => {
  it.each([
    [0, true, 'fresh'],
    [10_000, true, 'fresh'],
    [WORKER_HEARTBEAT.maxAgeMs, true, 'fresh'],
    [WORKER_HEARTBEAT.maxAgeMs + 1, false, 'stale'],
    [600_000, false, 'stale'],
  ] as const)('a write %i ms ago is healthy %s (%s)', (ageMs, healthy, state) => {
    expect(checkWorkerHeartbeat(`${String(NOW - ageMs)}\n`, NOW)).toEqual({
      healthy,
      state,
      ageMs,
    });
  });

  it('is unhealthy without a file, and with text that is not a time', () => {
    expect(checkWorkerHeartbeat(null, NOW)).toEqual({
      healthy: false,
      state: 'missing',
      ageMs: null,
    });
    for (const text of ['', 'yesterday\n', '12.5\n', '-1\n', `${String(NOW)} extra\n`]) {
      expect(checkWorkerHeartbeat(text, NOW), text).toEqual({
        healthy: false,
        state: 'unreadable',
        ageMs: null,
      });
    }
  });

  it('treats a write from further in the future than the window as unreadable', () => {
    expect(checkWorkerHeartbeat(String(NOW + WORKER_HEARTBEAT.maxAgeMs + 1), NOW).state).toBe(
      'unreadable',
    );
    expect(checkWorkerHeartbeat(String(NOW + 1000), NOW).healthy).toBe(true);
  });
});

describe('the probe (C250.2)', () => {
  it('reads OPENVERIFY_WORKER_HEARTBEAT_FILE when it is an absolute path, else the default', () => {
    expect(heartbeatFileOf({})).toBe(WORKER_HEARTBEAT.defaultFile);
    expect(heartbeatFileOf({ OPENVERIFY_WORKER_HEARTBEAT_FILE: '/var/run/ov/heartbeat' })).toBe(
      '/var/run/ov/heartbeat',
    );
    expect(heartbeatFileOf({ OPENVERIFY_WORKER_HEARTBEAT_FILE: '' })).toBe(
      WORKER_HEARTBEAT.defaultFile,
    );
    expect(heartbeatFileOf({ OPENVERIFY_WORKER_HEARTBEAT_FILE: 'relative/heartbeat' })).toBe(
      WORKER_HEARTBEAT.defaultFile,
    );
  });

  it('exits 0 on a fresh file and 1 on a stale one, saying which in one line', () => {
    const files = new Map([['/run/ov/hb', String(NOW - 4000)]]);
    const lines: string[] = [];
    const io = {
      env: { OPENVERIFY_WORKER_HEARTBEAT_FILE: '/run/ov/hb' },
      readFile: (path: string) => files.get(path) ?? null,
      out: (line: string) => lines.push(line),
    };

    expect(runWorkerHealth({ ...io, nowMs: NOW })).toBe(0);
    expect(runWorkerHealth({ ...io, nowMs: NOW + 60_000 })).toBe(1);
    expect(runWorkerHealth({ ...io, env: {}, nowMs: NOW })).toBe(1);
    files.set('/run/ov/hb', 'not a time\n');
    expect(runWorkerHealth({ ...io, nowMs: NOW })).toBe(1);
    expect(lines).toEqual([
      'worker-health: fresh, last heartbeat 4 s ago',
      'worker-health: stale, last heartbeat 64 s ago (at most 30 s)',
      'worker-health: missing, no heartbeat file',
      'worker-health: unreadable, the heartbeat file holds no time',
    ]);
  });
});
