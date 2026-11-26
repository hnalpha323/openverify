/**
 * C270.4, C271.2 (Workflow 11D Stage 1a, contracts-11d; Stage 1a amendment 7): the switches the
 * matcher's Phase 11 changes hide behind, each OFF by default until the calibration keeps it
 * (`docs/calibration/watchlist-phase11.md`), so it can measure each change's share and keep or revert
 * it. Workflow 11D review (fix-11d): the calibration kept `retrieval-reach` (decision rule 2: digests
 * identical at both scales; -4.4% of the 100,000-name p95 and -3.7% of the 2,000,000-name one), so
 * it ships on (`WATCHLIST_SWITCHES_ON_BY_DEFAULT`). `incremental-key-df` passed rule 5 on its
 * measured 1,000-entry change (53% faster at 2,000,000 names) but stays off: with it on, the C78.7
 * gate's 100,000-name import ran past its 600 s hook (C271.4). `rescreen-bound-memo`, also kept,
 * showed no measurable gain (+0.1% to +0.5%) and stays off; `gin-fastupdate-off` was not taken
 * (rule 9); the others were not built.
 *
 * - Boolean switches (`WATCHLIST_PHASE11_SWITCHES`), turned on with `useWatchlistSwitches`, which
 *   returns a function that restores the previous state, and read with `watchlistSwitchEnabled`:
 *   - `incremental-key-df` (C270.1; matcher-write-11d): the sync updates the key frequencies by its
 *     delta in its own transaction instead of `rebuildWatchlistKeyDf`;
 *   - `gin-fastupdate-off` (C270.3, option 1; matcher-write-11d): the benchmark's own database runs
 *     `ALTER INDEX … SET (fastupdate = off)` on the two name GIN indexes as their owner (the runtime
 *     role cannot; shipping it is a migration, Stage 1a amendment 12);
 *   - `retrieval-reach`, `stored-name-analysis`, `rescreen-bound-memo`, `rescreen-prepared-index`
 *     (C271's levers, Stage 1a amendment 4; matcher-c787-11d).
 * - Tunings (`WatchlistWriteTuning`), `null` = off, set with `useWatchlistWriteTuning` (restore
 *   function) and read with `watchlistWriteTuning`:
 *   - `rekeyBatch` (C270.2): the re-key's batch size, overriding `REKEY_BATCH` for a measurement;
 *   - `ginPendingListLimitKb` (C270.3, option 2): the sync's `SET LOCAL gin_pending_list_limit`;
 *   - `ginCleanEveryBatches` (C270.3, option 3): `openverify_gin_clean_pending_lists` every N batches.
 *
 * The benchmark toggles them as it toggles `SCREENING_SHORTCUTS`; a test turns one on and restores
 * it with the returned function. No variable and no setting reads them: a switch the calibration
 * keeps is turned on in code by fix-11d, with its test. Owner: matcher-write-11d (the C271 levers'
 * bodies are matcher-c787-11d's).
 */

/** C270's boolean switches. */
export const WATCHLIST_WRITE_SWITCHES = ['incremental-key-df', 'gin-fastupdate-off'] as const;

/** C271's levers (Workflow 11D Stage 1a amendment 4). */
export const WATCHLIST_C787_LEVERS = [
  'retrieval-reach',
  'stored-name-analysis',
  'rescreen-bound-memo',
  'rescreen-prepared-index',
] as const;

/** Every boolean switch of Workflow 11D. */
export const WATCHLIST_PHASE11_SWITCHES = [
  ...WATCHLIST_WRITE_SWITCHES,
  ...WATCHLIST_C787_LEVERS,
] as const;
export type WatchlistPhase11Switch = (typeof WATCHLIST_PHASE11_SWITCHES)[number];

/** C270's tunings: `null` keeps the shipped behaviour. */
export interface WatchlistWriteTuning {
  /** C270.2: the re-key's batch size (1-100,000 entries), in place of `REKEY_BATCH`. */
  rekeyBatch: number | null;
  /** C270.3: the sync's `SET LOCAL gin_pending_list_limit`, in kB (at least 64). */
  ginPendingListLimitKb: number | null;
  /** C270.3: a pending-list clean every N written batches (N at least 1). */
  ginCleanEveryBatches: number | null;
}

/** Every tuning off. */
export const WATCHLIST_WRITE_TUNING_DEFAULTS: Readonly<WatchlistWriteTuning> = Object.freeze({
  rekeyBatch: null,
  ginPendingListLimitKb: null,
  ginCleanEveryBatches: null,
});

/**
 * The switches on by default: the levers the 11D calibration kept with a measured gain (Workflow 11D
 * review, fix-11d). `useWatchlistSwitches({ name: false })` still turns one off for a measurement.
 */
export const WATCHLIST_SWITCHES_ON_BY_DEFAULT: readonly WatchlistPhase11Switch[] = Object.freeze([
  'retrieval-reach',
]);

const enabled = new Set<WatchlistPhase11Switch>(WATCHLIST_SWITCHES_ON_BY_DEFAULT);
let tuning: Readonly<WatchlistWriteTuning> = WATCHLIST_WRITE_TUNING_DEFAULTS;

/** Whether a switch is on (those of `WATCHLIST_SWITCHES_ON_BY_DEFAULT`, unless turned off). */
export function watchlistSwitchEnabled(name: WatchlistPhase11Switch): boolean {
  return enabled.has(name);
}

/** Turns switches on or off; returns a function that restores the previous state. */
export function useWatchlistSwitches(
  switches: Partial<Readonly<Record<WatchlistPhase11Switch, boolean>>>,
): () => void {
  const previous = new Set(enabled);
  for (const name of WATCHLIST_PHASE11_SWITCHES) {
    if (switches[name] === true) {
      enabled.add(name);
    } else if (switches[name] === false) {
      enabled.delete(name);
    }
  }
  return () => {
    enabled.clear();
    previous.forEach((name) => enabled.add(name));
  };
}

/** The tunings in force (a frozen copy). */
export function watchlistWriteTuning(): Readonly<WatchlistWriteTuning> {
  return tuning;
}

/** Each tuning's range: whole numbers from `min` to `max`. */
const TUNING_RANGES: Readonly<Record<keyof WatchlistWriteTuning, { min: number; max: number }>> =
  Object.freeze({
    rekeyBatch: { min: 1, max: 100_000 },
    ginPendingListLimitKb: { min: 64, max: 2_147_483_647 },
    ginCleanEveryBatches: { min: 1, max: 1_000_000 },
  });

/**
 * Sets tunings (a `null` turns one off); returns a function that restores the previous ones.
 * @throws {RangeError} for a value outside its range, before anything changes.
 */
export function useWatchlistWriteTuning(changes: Partial<WatchlistWriteTuning>): () => void {
  for (const key of Object.keys(TUNING_RANGES) as (keyof WatchlistWriteTuning)[]) {
    const value = changes[key];
    const range = TUNING_RANGES[key];
    if (
      value !== undefined &&
      value !== null &&
      (!Number.isInteger(value) || value < range.min || value > range.max)
    ) {
      throw new RangeError(
        `${key} is a whole number from ${String(range.min)} to ${String(range.max)}`,
      );
    }
  }
  const previous = tuning;
  tuning = Object.freeze({ ...tuning, ...changes });
  return () => {
    tuning = previous;
  };
}
