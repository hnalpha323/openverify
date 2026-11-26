/**
 * Owner decision 1 after 6B: the shortcuts that bring one screening within the C78.7 budget, each
 * leaving every created match identical (`shortcuts.test.ts`), each switchable so a benchmark can
 * measure its share.
 *
 * - `name-cache`: list names are analysed once per process (the most recently used kept).
 * - `unit-cache`: the scorer builds each name's token units once, not once per pair.
 * - `shared-matrix`: a name pair's upper bound and its exact alignment share one table of token
 *   pair scores.
 * - `minimum-floor`: with `keptOnly`, a pair whose bound cannot reach the preset's minimum (less the
 *   best qualifier) is not aligned, where the display floor (0.70) would align it.
 * - `pair-memo`: within one screening, a (subject name, list name) pair's bound and score are kept,
 *   so a list name many entries share (namesakes) is scored once.
 * - `exact-stop`: once an entry's best pair is exact, a pair whose bound cannot exceed it is not
 *   aligned (no such pair can replace it).
 *
 * Owner decision 3 after 6C (`matcher-6d`), from the profile of the slowest screenings:
 *
 * - `unit-lengths`: each token unit carries the code-point lengths of its forms, so the typo budget
 *   and the joined tokens' length test read them instead of counting them for every pair.
 * - `join-cache`: a name's joined units (two adjacent tokens compared as one) are built once per
 *   name and variant groups, as `unit-cache` builds its single units, not once per pair bounded or
 *   aligned.
 *   (A third, `token-memo`, kept each token pair score per screening by the list token's content;
 *   on the development tables it saved no time at 100,000 or 2,000,000 names, its lookups costing
 *   what the pair scores did, and it was dropped.)
 * - `name-lru`: the analysed-name cache keeps its least-recently-used order in a list of its own,
 *   so a hit writes nothing to its map and forgetting the oldest name takes constant time (in the
 *   map's own insertion order each hit deleted and re-set its name, and each eviction read past the
 *   deleted slots at the map's front, a cost that grows with every name forgotten).
 * - `token-cache`: a written token is made (its script, Latin forms and original form) once while
 *   the process keeps it, and names that share it share the one token, so the scorer's caches read
 *   one token's forms.
 * - `indexed-matrix`: a name pair's token pair scores (`shared-matrix`) are kept in one array,
 *   indexed by each unit's place in its name (its token, or the pair of tokens it joins), not in
 *   maps keyed by the units.
 * - `ratio-check`: with a floor, a name pair whose bound reaches it is aligned in full only when its
 *   best ratio may reach it too: each unit's best pair value at the floor, summed over every unit
 *   of every choice of joins (a relaxation of the exact alignment, which takes each unit once),
 *   shows most pairs that cannot, from the pair scores the bound already read.
 * - `token-pairs`: a subject unit keeps its pair score with each list token it met (by the token
 *   `token-cache` shares, under the matching), so a list token many names hold is scored against it
 *   once per screening, not once per name pair.
 */
import {
  ANALYSED_NAME_CACHE_SIZE,
  setAnalysedNameCacheOrder,
  setAnalysedNameCacheSize,
  setNameTokenCache,
} from '../names/index.js';
import { setScorerShortcuts } from '../score/index.js';

export const SCREENING_SHORTCUTS = [
  'name-cache',
  'unit-cache',
  'shared-matrix',
  'minimum-floor',
  'pair-memo',
  'exact-stop',
  'unit-lengths',
  'join-cache',
  'name-lru',
  'token-cache',
  'indexed-matrix',
  'ratio-check',
  'token-pairs',
] as const;
export type ScreeningShortcut = (typeof SCREENING_SHORTCUTS)[number];

const enabled = new Set<ScreeningShortcut>(SCREENING_SHORTCUTS);

/** Whether a shortcut is on (all are, unless a test or a benchmark turns one off). */
export function screeningShortcutEnabled(shortcut: ScreeningShortcut): boolean {
  return enabled.has(shortcut);
}

function apply(): void {
  setAnalysedNameCacheOrder(enabled.has('name-lru'));
  setNameTokenCache(enabled.has('token-cache'));
  setAnalysedNameCacheSize(enabled.has('name-cache') ? ANALYSED_NAME_CACHE_SIZE : 0);
  setScorerShortcuts({
    unitCache: enabled.has('unit-cache'),
    sharedMatrix: enabled.has('shared-matrix'),
    unitLengths: enabled.has('unit-lengths'),
    joinCache: enabled.has('join-cache'),
    indexedMatrix: enabled.has('indexed-matrix'),
    ratioCheck: enabled.has('ratio-check'),
    tokenPairs: enabled.has('token-pairs'),
  });
}

/** Turns shortcuts on or off; returns a function that restores the previous state. */
export function useScreeningShortcuts(
  switches: Partial<Readonly<Record<ScreeningShortcut, boolean>>>,
): () => void {
  const previous = new Set(enabled);
  for (const shortcut of SCREENING_SHORTCUTS) {
    const on = switches[shortcut];
    if (on === true) {
      enabled.add(shortcut);
    } else if (on === false) {
      enabled.delete(shortcut);
    }
  }
  apply();
  return () => {
    enabled.clear();
    previous.forEach((shortcut) => enabled.add(shortcut));
    apply();
  };
}
