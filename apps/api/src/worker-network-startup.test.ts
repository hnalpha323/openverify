/**
 * C92.3, C92.5 (Workflow 7A Stage 1b (N), F41): before its jobs start, the worker reconciles the
 * network source rows with the source lists, then starts its network snapshots; each failure is
 * logged by its name only and the worker starts all the same.
 */
import type { Db } from '@openverify/db';
import { describe, expect, it, vi } from 'vitest';
import { createInMemoryNetworkSnapshots, fixedClock } from './test-support/fakes.js';
import { startNetworkDataAtStart } from './worker.js';

const reconcile = vi.hoisted(() => vi.fn());
vi.mock('./network/reconcile.js', () => ({ reconcileNetworkSources: reconcile }));

function logger() {
  const lines: { level: string; object: Record<string, unknown>; message: string }[] = [];
  const at = (level: string) => (object: Record<string, unknown>, message: string) => {
    lines.push({ level, object, message });
  };
  return { lines, logger: { info: at('info'), error: at('error') } };
}

const SETTINGS = { sourcesDisabled: ['gcp-cloud'], sourcesEnabled: ['dbip-city-lite'] };

describe('startNetworkDataAtStart (C92.3, C92.5)', () => {
  it('reconciles with the source lists, logs counts only, then starts the snapshots', async () => {
    reconcile.mockReset().mockResolvedValue({ upserted: 11, disabled: 1 });
    const { lines, logger: log } = logger();
    const snapshots = createInMemoryNetworkSnapshots();
    const clock = fixedClock();
    const db = {} as Db;

    await startNetworkDataAtStart(db, SETTINGS, snapshots, log, clock);

    expect(reconcile).toHaveBeenCalledWith(db, { ...SETTINGS, clock });
    expect(snapshots.started).toBe(true);
    expect(lines).toEqual([
      {
        level: 'info',
        object: { upserted: 11, disabled: 1 },
        message: 'network sources reconciled',
      },
    ]);
  });

  it('logs a failed reconciliation by its name and still starts the snapshots', async () => {
    reconcile.mockReset().mockRejectedValue(new TypeError('synthetic outage'));
    const { lines, logger: log } = logger();
    const snapshots = createInMemoryNetworkSnapshots();

    await expect(
      startNetworkDataAtStart({} as Db, SETTINGS, snapshots, log, fixedClock()),
    ).resolves.toBeUndefined();

    expect(snapshots.started).toBe(true);
    expect(lines).toEqual([
      { level: 'error', object: { error: 'TypeError' }, message: 'network sources not reconciled' },
    ]);
  });

  it('logs snapshots that did not load by the error name and resolves', async () => {
    reconcile.mockReset().mockResolvedValue({ upserted: 0, disabled: 0 });
    const { lines, logger: log } = logger();
    const snapshots = {
      ...createInMemoryNetworkSnapshots(),
      start: () => Promise.reject(new RangeError('synthetic load failure')),
    };

    await expect(
      startNetworkDataAtStart({} as Db, SETTINGS, snapshots, log, fixedClock()),
    ).resolves.toBeUndefined();

    expect(lines.at(-1)).toEqual({
      level: 'error',
      object: { error: 'RangeError' },
      message: 'network snapshots not loaded',
    });
  });
});
