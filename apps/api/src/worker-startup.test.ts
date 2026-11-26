/**
 * C76.4 (V01): the worker reconciles the watchlist source rows before its jobs start, logging the
 * counts, and starts all the same when that fails (the next start reconciles again).
 */
import { describe, expect, it, vi } from 'vitest';
import { newId } from '@openverify/contracts';
import type { Db } from '@openverify/db';
import { logMatcherDataAtStart, reconcileWatchlistSourcesAtStart } from './worker.js';

const reconcile = vi.hoisted(() => vi.fn());
vi.mock('./watchlists/reconcile.js', () => ({ reconcileWatchlistSources: reconcile }));

function logger() {
  const lines: { level: string; object: Record<string, unknown>; message: string }[] = [];
  const at = (level: string) => (object: Record<string, unknown>, message: string) => {
    lines.push({ level, object, message });
  };
  return { lines, logger: { info: at('info'), warn: at('warn'), error: at('error') } };
}

describe('reconcileWatchlistSourcesAtStart (C76.4)', () => {
  it('reconciles with the disabled sources and logs counts only', async () => {
    reconcile.mockReset().mockResolvedValue({ sources: 7, enabled: 6, retired: 1 });
    const { lines, logger: log } = logger();
    const db = {} as Db;

    await reconcileWatchlistSourcesAtStart(db, ['un-sc'], log);

    expect(reconcile).toHaveBeenCalledWith(db, { disabled: ['un-sc'] });
    expect(lines).toEqual([
      {
        level: 'info',
        object: { sources: 7, enabled: 6, retired: 1 },
        message: 'watchlist sources reconciled',
      },
    ]);
  });

  it('logs a failure by its name and resolves', async () => {
    reconcile.mockReset().mockRejectedValue(new TypeError('synthetic outage'));
    const { lines, logger: log } = logger();

    await expect(reconcileWatchlistSourcesAtStart({} as Db, [], log)).resolves.toBeUndefined();
    expect(lines).toEqual([
      {
        level: 'error',
        object: { error: 'TypeError' },
        message: 'watchlist sources not reconciled',
      },
    ]);
  });
});

describe('reconcileWatchlistSourcesAtStart and the UN opt-in (C254.1, Q10 granted; KP11-31)', () => {
  const optedIn = {
    execute: () =>
      Promise.resolve({
        rows: [
          {
            opt_in: {
              'source-id': 'un-sc',
              'terms-url': 'https://www.un.org/en/about-us/terms-of-use',
              'accepted-at': '2026-11-21T12:00:00.000Z',
              'accepted-by': newId('usr'),
            },
          },
        ],
      }),
  } as unknown as Db;

  it('passes the opted-in sources while the install allows the opt-in', async () => {
    reconcile.mockReset().mockResolvedValue({ sources: 7, enabled: 7, retired: 0 });
    const { logger: log } = logger();

    await reconcileWatchlistSourcesAtStart(optedIn, [], log, true);

    expect(reconcile).toHaveBeenCalledWith(optedIn, { disabled: [], optInSources: ['un-sc'] });
  });

  it('passes none while it does not, as Phase 6 left it', async () => {
    reconcile.mockReset().mockResolvedValue({ sources: 7, enabled: 6, retired: 0 });
    const { logger: log } = logger();

    await reconcileWatchlistSourcesAtStart(optedIn, [], log, false);

    expect(reconcile).toHaveBeenCalledWith(optedIn, { disabled: [] });
  });
});

describe('logMatcherDataAtStart (C78.3, F14)', () => {
  it('warns once, naming how to build the file, when the variant groups are missing or not the shipped ones', () => {
    for (const status of ['missing', 'unexpected'] as const) {
      const { lines, logger: log } = logger();
      const load = vi.fn(() => ({ status }));

      logMatcherDataAtStart(load, log);

      expect(load).toHaveBeenCalledTimes(1);
      expect(lines).toEqual([
        {
          level: 'warn',
          object: { matcherData: status },
          message:
            'variant groups not loaded: person-name reports error matcher_data_unavailable until ' +
            'python3 scripts/fetch_data.py and pnpm --filter @openverify/watchlist build:variant-groups run',
        },
      ]);
    }
  });

  it('logs the keys version once when they loaded', () => {
    const { lines, logger: log } = logger();

    logMatcherDataAtStart(
      () => ({ status: 'loaded', keysVersion: 'names-1;identifiers-1;crypto-1;groups-x' }) as never,
      log,
    );

    expect(lines).toEqual([
      {
        level: 'info',
        object: { keysVersion: 'names-1;identifiers-1;crypto-1;groups-x' },
        message: 'variant groups loaded',
      },
    ]);
  });
});
