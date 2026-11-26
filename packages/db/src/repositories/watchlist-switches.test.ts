import { describe, expect, it, onTestFinished } from 'vitest';
import {
  WATCHLIST_C787_LEVERS,
  WATCHLIST_PHASE11_SWITCHES,
  WATCHLIST_WRITE_SWITCHES,
  WATCHLIST_WRITE_TUNING_DEFAULTS,
  useWatchlistSwitches,
  useWatchlistWriteTuning,
  watchlistSwitchEnabled,
  watchlistWriteTuning,
} from './watchlist-switches.js';

/**
 * Workflow 11D Stage 1a amendment 7 (C270.4, C271.2): every switch the matcher's Phase 11 changes
 * hide behind is off by default, each can be turned on and restored, and the tunings refuse values
 * outside their range.
 */
describe('the Phase 11 watchlist switches (C270.4, C271.2)', () => {
  it('names C270 switches and C271 levers, and nothing else', () => {
    expect(WATCHLIST_WRITE_SWITCHES).toEqual(['incremental-key-df', 'gin-fastupdate-off']);
    expect(WATCHLIST_C787_LEVERS).toEqual([
      'retrieval-reach',
      'stored-name-analysis',
      'rescreen-bound-memo',
      'rescreen-prepared-index',
    ]);
    expect(WATCHLIST_PHASE11_SWITCHES).toEqual([
      ...WATCHLIST_WRITE_SWITCHES,
      ...WATCHLIST_C787_LEVERS,
    ]);
  });

  const ON_BY_DEFAULT = ['retrieval-reach'];

  it.each(WATCHLIST_PHASE11_SWITCHES.filter((name) => !ON_BY_DEFAULT.includes(name)))(
    'keeps %s off by default',
    (name) => {
      expect(watchlistSwitchEnabled(name)).toBe(false);
    },
  );

  // Workflow 11D review (fix-11d): `incremental-key-df` stays off. Rule 5 kept it on its measured
  // change (a 1,000-entry sync on 2,000,000 names, 127.5 s on against 272.9 s off), but with it on
  // the C78.7 gate's 100,000-name import did not finish inside its 600 s hook (it takes about a minute
  // off), so a large sync is slower with it, which the method did not measure (C271.4: turned off
  // until fixed).

  // Workflow 11D review (fix-11d): the calibration kept `retrieval-reach` (docs/calibration/
  // watchlist-phase11.md, decision rule 2: digests identical at both scales, -4.4% and -3.7%), so it
  // ships on; the others stay off until a calibration keeps them.
  it('turns retrieval-reach on by default, the lever the calibration kept', () => {
    expect(watchlistSwitchEnabled('retrieval-reach')).toBe(true);
    const restore = useWatchlistSwitches({ 'retrieval-reach': false });
    onTestFinished(restore);
    expect(watchlistSwitchEnabled('retrieval-reach')).toBe(false);
    restore();
    expect(watchlistSwitchEnabled('retrieval-reach')).toBe(true);
  });

  it('turns one switch on, leaves the others off, and restores it', () => {
    const restore = useWatchlistSwitches({ 'gin-fastupdate-off': true });
    onTestFinished(restore);
    expect(watchlistSwitchEnabled('gin-fastupdate-off')).toBe(true);
    for (const name of WATCHLIST_PHASE11_SWITCHES.filter(
      (n) => n !== 'gin-fastupdate-off' && !ON_BY_DEFAULT.includes(n),
    )) {
      expect(watchlistSwitchEnabled(name)).toBe(false);
    }
    restore();
    expect(watchlistSwitchEnabled('gin-fastupdate-off')).toBe(false);
  });

  it('turns a switch off again and restores nested changes in order', () => {
    const outer = useWatchlistSwitches({ 'retrieval-reach': true, 'gin-fastupdate-off': true });
    onTestFinished(outer);
    const inner = useWatchlistSwitches({ 'retrieval-reach': false });
    expect(watchlistSwitchEnabled('retrieval-reach')).toBe(false);
    expect(watchlistSwitchEnabled('gin-fastupdate-off')).toBe(true);
    inner();
    expect(watchlistSwitchEnabled('retrieval-reach')).toBe(true);
    outer();
    expect(WATCHLIST_PHASE11_SWITCHES.filter((name) => watchlistSwitchEnabled(name))).toEqual([
      'retrieval-reach',
    ]);
  });

  it('keeps every tuning null by default', () => {
    expect(WATCHLIST_WRITE_TUNING_DEFAULTS).toEqual({
      rekeyBatch: null,
      ginPendingListLimitKb: null,
      ginCleanEveryBatches: null,
    });
    expect(watchlistWriteTuning()).toEqual(WATCHLIST_WRITE_TUNING_DEFAULTS);
    expect(Object.isFrozen(WATCHLIST_WRITE_TUNING_DEFAULTS)).toBe(true);
  });

  it('sets tunings, turns one off with null, and restores the previous ones', () => {
    const restore = useWatchlistWriteTuning({ rekeyBatch: 2_000, ginCleanEveryBatches: 10 });
    onTestFinished(restore);
    expect(watchlistWriteTuning()).toEqual({
      rekeyBatch: 2_000,
      ginPendingListLimitKb: null,
      ginCleanEveryBatches: 10,
    });
    const inner = useWatchlistWriteTuning({ rekeyBatch: null, ginPendingListLimitKb: 256 });
    expect(watchlistWriteTuning()).toEqual({
      rekeyBatch: null,
      ginPendingListLimitKb: 256,
      ginCleanEveryBatches: 10,
    });
    inner();
    restore();
    expect(watchlistWriteTuning()).toEqual(WATCHLIST_WRITE_TUNING_DEFAULTS);
  });

  it('hands out a copy that cannot change the tunings in force', () => {
    const tuning = watchlistWriteTuning();
    expect(Object.isFrozen(tuning)).toBe(true);
    expect(watchlistWriteTuning()).toEqual(WATCHLIST_WRITE_TUNING_DEFAULTS);
  });

  it.each([
    [{ rekeyBatch: 0 }],
    [{ rekeyBatch: 100_001 }],
    [{ rekeyBatch: 1.5 }],
    [{ ginPendingListLimitKb: 63 }],
    [{ ginPendingListLimitKb: Number.NaN }],
    [{ ginCleanEveryBatches: 0 }],
    [{ ginCleanEveryBatches: -1 }],
  ])('refuses %o and changes nothing', (tuning) => {
    expect(() => useWatchlistWriteTuning(tuning)).toThrow(RangeError);
    expect(watchlistWriteTuning()).toEqual(WATCHLIST_WRITE_TUNING_DEFAULTS);
  });

  it('accepts the bounds of each range', () => {
    const restore = useWatchlistWriteTuning({
      rekeyBatch: 100_000,
      ginPendingListLimitKb: 64,
      ginCleanEveryBatches: 1,
    });
    onTestFinished(restore);
    expect(watchlistWriteTuning()).toEqual({
      rekeyBatch: 100_000,
      ginPendingListLimitKb: 64,
      ginCleanEveryBatches: 1,
    });
    restore();
    const lowest = useWatchlistWriteTuning({ rekeyBatch: 1 });
    onTestFinished(lowest);
    expect(watchlistWriteTuning().rekeyBatch).toBe(1);
  });
});
