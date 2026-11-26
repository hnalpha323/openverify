/**
 * C164.7 (Phase 9, Workflow 9B; decision 37; reviews H18, P21; `analytics-logic` builds it in
 * Stage 2): small-count suppression, rate bounds and complementary suppression, applied after every
 * filter and identically in the console, the API, CSV downloads and the chart captions, which are
 * built only from the suppressed answer. Signatures frozen by `contracts-9b`.
 *
 * - A count from 1 to `threshold - 1` is `{ suppressed: 'small-count' }` ("fewer than <threshold>");
 *   zero is shown.
 * - A rate is shown only when its denominator, its numerator and its complement each reach the
 *   threshold; otherwise a bound rounded outward to a whole percent (`{ below }` when the numerator
 *   is small: "under ⌈100·(t−1)/D⌉%"; `{ above }` when the complement is: "over
 *   ⌊100·(1−(t−1)/D)⌋%"), or `{ suppressed: true }` when the denominator itself is small. The true
 *   value lies inside every bound (a property test).
 * - Complementary suppression: whenever a total and all but one of its parts would be visible, the
 *   next smallest part is suppressed too, `{ suppressed: 'complementary' }` (which says "hidden",
 *   never "fewer than", because the hidden value may be large), along the time axis too (days within
 *   a week, weeks and days within a month), identically whatever bucket is asked.
 *
 * As built (`analytics-logic`, ours):
 * - **Bounds are strict.** `{ below: X }` reads "under X%" and `{ above: Y }` "over Y%", and both
 *   hold strictly for every numerator the cell allows: `X = ⌊100·(t−1)/D⌋ + 1` and
 *   `Y = ⌈100·(D−t+1)/D⌉ − 1`. They equal the plan's `⌈100·(t−1)/D⌉` and `⌊100·(1−(t−1)/D)⌋`
 *   except when those are whole, where the plan's bound would be met, not passed (10 of 40 is 25%,
 *   which "under 25%" does not hold). When the numerator and its complement are both small (a
 *   denominator from `t` to `2t − 2`), no one-sided bound describes the rate, and none is shown.
 * - **Complementary suppression is exact.** First the plan's rule, group by group: a group with one
 *   hidden cell left hides its smallest shown non-zero part (zeros are shown and never hidden), or
 *   its total when no part is left. Then an exact check, which the rule alone cannot replace (three
 *   groups can reveal a cell that no one group reveals, and so can a bridge between two blocks of a
 *   two-way table): `derivation.ts` reduces the groups over the hidden and virtual cells in exact
 *   integer arithmetic and lists every hidden cell they still determine; for each, the smallest shown
 *   non-zero cell of the groups that determine it is hidden too, and both steps run again until no
 *   hidden cell is determined. A cell a group names with no value is virtual: never shown, never
 *   protected, an unknown of the equations (the "decided" population, a signal's population).
 * - **One order.** Cells and groups are read in a canonical order (ids sorted), so the cells hidden
 *   depend on the values and the groups alone, never on the order a caller lists them in.
 * - **What it does not cover** (stated in the console and the docs; C177): bounds implied by the
 *   labels (a small cell is 1 to t − 1 and a complementary one at least t, since zeros are never
 *   hidden, so a total close to its hidden parts' least sum narrows them), differencing two
 *   overlapping windows or a filtered answer against an unfiltered one, and snapshot differencing.
 */
import { determinedByComponent } from './derivation.js';
import { durationPercentile } from './durations.js';
import { AnalyticsInputError, assertCount } from './errors.js';
import type { AnalyticsTimeLattice } from './lattice.js';
import type { AnalyticsRateFigure } from './metrics.js';

/** C164.7: the threshold's floor, never lowered (`analytics-suppression-threshold`). */
export const ANALYTICS_SUPPRESSION_FLOOR = 11;

/** Why a cell is hidden. */
export const ANALYTICS_SUPPRESSIONS = Object.freeze(['small-count', 'complementary'] as const);
export type AnalyticsSuppression = (typeof ANALYTICS_SUPPRESSIONS)[number];

/** A count as an answer shows it. */
export type AnalyticsCountCell = number | { readonly suppressed: AnalyticsSuppression };

/** A rate as an answer shows it: a fraction in [0, 1], a whole-percent bound, or nothing. */
export type AnalyticsRateCell =
  | { readonly value: number }
  | { readonly below: number }
  | { readonly above: number }
  | { readonly suppressed: true };

/** One additive relation between cells, by id: the total is the sum of the parts. */
export interface AnalyticsAdditiveGroup {
  readonly total: string;
  readonly parts: readonly string[];
}

/** C164.7: the threshold's ceiling (the setting's bound, `analytics-suppression-threshold`). */
const THRESHOLD_MAX = 100;

const SMALL_COUNT = Object.freeze({ suppressed: 'small-count' as const });
const COMPLEMENTARY = Object.freeze({ suppressed: 'complementary' as const });
const HIDDEN_RATE = Object.freeze({ suppressed: true as const });

function assertThreshold(threshold: number): void {
  if (
    !Number.isInteger(threshold) ||
    threshold < ANALYTICS_SUPPRESSION_FLOOR ||
    threshold > THRESHOLD_MAX
  ) {
    throw new AnalyticsInputError(
      `the threshold is a whole number from ${String(ANALYTICS_SUPPRESSION_FLOOR)} to ${String(THRESHOLD_MAX)}`,
    );
  }
}

/** `⌊a / b⌋` for whole `a >= 0` and `b > 0`, without a rounded division. */
const floorDivide = (a: number, b: number) => (a - (a % b)) / b;

/** A count after small-count suppression alone (complementary suppression is the table's). */
export function suppressCount(count: number, threshold: number): AnalyticsCountCell {
  assertThreshold(threshold);
  assertCount(count, 'a count');
  return count >= 1 && count < threshold ? SMALL_COUNT : count;
}

/** A rate as it may be shown (its counts' own hiding is the table's, `AnalyticsTable.rate`). */
export function suppressRate(rate: AnalyticsRateFigure, threshold: number): AnalyticsRateCell {
  assertThreshold(threshold);
  const numerator = assertCount(rate.numerator, 'a rate numerator');
  const denominator = assertCount(rate.denominator, 'a rate denominator');
  if (numerator > denominator) {
    throw new AnalyticsInputError('a rate numerator must not exceed its denominator');
  }
  if (denominator < threshold) {
    return HIDDEN_RATE;
  }
  const complement = denominator - numerator;
  if (numerator >= threshold && complement >= threshold) {
    return { value: numerator / denominator };
  }
  if (numerator < threshold && complement < threshold) {
    return HIDDEN_RATE;
  }
  const small = threshold - 1;
  if (numerator < threshold) {
    return { below: floorDivide(100 * small, denominator) + 1 };
  }
  const least = 100 * (denominator - small);
  return { above: floorDivide(least + denominator - 1, denominator) - 1 };
}

interface Group {
  readonly total: string;
  readonly parts: readonly string[];
  readonly members: readonly string[];
}

const byId = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

/** The groups checked and in their canonical order. */
function canonicalGroups(groups: readonly AnalyticsAdditiveGroup[]): Group[] {
  const prepared = groups.map((group) => {
    const parts = [...group.parts].sort(byId);
    const members = [group.total, ...parts];
    if (parts.length === 0 || members.some((id) => typeof id !== 'string' || id.length === 0)) {
      throw new AnalyticsInputError('a group needs a total and at least one part, each an id');
    }
    if (new Set(members).size !== members.length) {
      throw new AnalyticsInputError('a group names each cell once');
    }
    return {
      total: group.total,
      parts,
      members,
      key: `${group.total}\u0000${parts.join('\u0001')}`,
    };
  });
  prepared.sort((left, right) => byId(left.key, right.key));
  return prepared.map(({ total, parts, members }) => ({ total, parts, members }));
}

/**
 * The shown non-zero cell to hide among `groups`' members: the smallest, a part before a total,
 * then by id; `null` when there is none.
 */
function complementOf(
  groups: readonly Group[],
  values: ReadonlyMap<string, number>,
  hidden: ReadonlyMap<string, AnalyticsSuppression>,
): string | null {
  let best: { id: string; value: number; rank: number } | null = null;
  for (const group of groups) {
    for (const id of group.members) {
      const value = values.get(id);
      if (value === undefined || value === 0 || hidden.has(id)) {
        continue;
      }
      const rank = group.parts.includes(id) ? 0 : 1;
      if (
        best === null ||
        value < best.value ||
        (value === best.value && (rank < best.rank || (rank === best.rank && id < best.id)))
      ) {
        best = { id, value, rank };
      }
    }
  }
  return best?.id ?? null;
}

/** Each cell's groups, by index into `groups`. */
function groupsByCell(groups: readonly Group[]): Map<string, number[]> {
  const groupsOf = new Map<string, number[]>();
  groups.forEach((group, index) => {
    for (const id of group.members) {
      const list = groupsOf.get(id) ?? [];
      list.push(index);
      groupsOf.set(id, list);
    }
  });
  return groupsOf;
}

/**
 * The plan's rule, group by group, until no group has exactly one hidden shown cell left among its
 * unknowns (virtual cells count as unknown here; the exact check sees through them). It reads the
 * groups of `changed` cells, or every group when `changed` is `null`.
 */
function protectGroups(
  values: ReadonlyMap<string, number>,
  groups: readonly Group[],
  groupsOf: ReadonlyMap<string, readonly number[]>,
  hidden: Map<string, AnalyticsSuppression>,
  changed: Iterable<string> | null,
): void {
  const unknown = (id: string) => !values.has(id) || hidden.has(id);
  const queue: number[] = [];
  const queued = new Set<number>();
  const enqueue = (index: number) => {
    if (!queued.has(index)) {
      queued.add(index);
      queue.push(index);
    }
  };
  if (changed === null) {
    groups.forEach((_, index) => {
      enqueue(index);
    });
  } else {
    for (const id of changed) {
      for (const index of groupsOf.get(id) ?? []) {
        enqueue(index);
      }
    }
  }
  // A for-of over an array sees the items pushed while it runs: the queue drains in order.
  for (const index of queue) {
    queued.delete(index);
    const group = groups[index];
    if (group === undefined) {
      continue;
    }
    const open = group.members.filter(unknown);
    const only = open.length === 1 ? (open[0] ?? '') : null;
    if (only === null || !hidden.has(only)) {
      continue;
    }
    const choice = complementOf([group], values, hidden);
    if (choice === null) {
      continue;
    }
    hidden.set(choice, 'complementary');
    for (const other of groupsOf.get(choice) ?? []) {
      enqueue(other);
    }
  }
}

/**
 * Every cell id to hide, and why: the small counts, then the complementary cells each additive group
 * needs so that no hidden cell follows by subtraction, repeated until nothing changes. A cell a
 * group names but `values` does not hold is virtual: never shown and never protected.
 */
export function complementarySuppression(
  values: ReadonlyMap<string, number>,
  groups: readonly AnalyticsAdditiveGroup[],
  threshold: number,
): ReadonlyMap<string, AnalyticsSuppression> {
  return hideCells(values, groups, groups, threshold);
}

/**
 * `complementarySuppression` with the exact check run over `exact` alone: groups whose span holds
 * every group of `groups` (the table leaves out those its other groups imply, which changes nothing
 * the check finds and keeps it small), while the plan's rule reads all of `groups`.
 */
function hideCells(
  values: ReadonlyMap<string, number>,
  groups: readonly AnalyticsAdditiveGroup[],
  exact: readonly AnalyticsAdditiveGroup[],
  threshold: number,
): ReadonlyMap<string, AnalyticsSuppression> {
  assertThreshold(threshold);
  const ids = [...values.keys()].sort(byId);
  for (const id of ids) {
    assertCount(values.get(id) ?? Number.NaN, 'a count');
  }
  const ordered = canonicalGroups(groups);
  const exactOrdered = exact === groups ? ordered : canonicalGroups(exact);
  const hidden = new Map<string, AnalyticsSuppression>();
  for (const id of ids) {
    const value = values.get(id) ?? 0;
    if (value >= 1 && value < threshold) {
      hidden.set(id, 'small-count');
    }
  }
  const virtual = new Set<string>();
  for (const group of [...ordered, ...exactOrdered]) {
    for (const id of group.members) {
      if (!values.has(id)) {
        virtual.add(id);
      }
    }
  }
  const cache = new Map<string, ReadonlyMap<string, readonly string[]>>();
  const groupsOf = groupsByCell(ordered);
  let changed: Set<string> | null = null;
  while (hidden.size > 0) {
    protectGroups(values, ordered, groupsOf, hidden, changed);
    const determined = determinedByComponent(
      new Set([...hidden.keys(), ...virtual]),
      exactOrdered,
      cache,
    );
    const revealed = [...determined]
      .filter(([id]) => hidden.has(id))
      .sort(([left], [right]) => byId(left, right));
    if (revealed.length === 0) {
      break;
    }
    const added = new Set<string>();
    for (const [, reads] of revealed) {
      // A cell hidden for an earlier one this round that this derivation reads breaks it too.
      if (reads.some((id) => added.has(id))) {
        continue;
      }
      const choice = smallestShown(reads, values, hidden);
      if (choice === null) {
        // A determined hidden cell's value is a non-zero combination of the known cells its
        // derivation reads, so one of them is shown and not zero.
        throw new Error('complementary suppression found no cell to hide');
      }
      hidden.set(choice, 'complementary');
      added.add(choice);
    }
    changed = added;
  }
  return new Map([...hidden].sort(([left], [right]) => byId(left, right)));
}

/** The smallest shown non-zero cell of `ids`, then by id; `null` when there is none. */
function smallestShown(
  ids: readonly string[],
  values: ReadonlyMap<string, number>,
  hidden: ReadonlyMap<string, AnalyticsSuppression>,
): string | null {
  let best: { id: string; value: number } | null = null;
  for (const id of ids) {
    const value = values.get(id);
    if (value === undefined || value === 0 || hidden.has(id)) {
      continue;
    }
    if (best === null || value < best.value || (value === best.value && id < best.id)) {
      best = { id, value };
    }
  }
  return best?.id ?? null;
}

// The answer-level function (analytics-logic, Workflow 9B Stage 2) -------------------------------

export * from './lattice.js';

/** A bucketed duration as an answer shows it (C163.5): its bucket's bounds, hidden, or nothing. */
export type AnalyticsDurationCell =
  { readonly lower: number; readonly upper: number } | { readonly suppressed: true } | null;

/**
 * The bucket holding `percentile` of `histogram`, hidden when fewer than `threshold` durations are
 * counted, `null` when none is.
 */
export function suppressDuration(
  histogram: readonly number[],
  percentile: number,
  threshold: number,
): AnalyticsDurationCell {
  assertThreshold(threshold);
  const bucket = durationPercentile(histogram, percentile);
  if (bucket === null) {
    return null;
  }
  const counted = histogram.reduce((sum, count) => sum + count, 0);
  return counted < threshold ? HIDDEN_RATE : { lower: bucket.lower, upper: bucket.upper };
}

const assertKey = (key: string, what: string) => {
  if (key.length === 0 || key.includes('@')) {
    throw new AnalyticsInputError(`${what} is a non-empty id without @`);
  }
};

/** The id of a series' cell at a time node: `<key>@<node id>`. */
export function analyticsSeriesCellId(key: string, node: { readonly id: string } | string): string {
  assertKey(key, 'a series key');
  return `${key}@${typeof node === 'string' ? node : node.id}`;
}

/** `relations` (between metric keys) as groups between cells, each key mapped by `cellOf`. */
export function analyticsRelationGroups(
  relations: readonly AnalyticsAdditiveGroup[],
  cellOf: (key: string) => string,
): readonly AnalyticsAdditiveGroup[] {
  return relations.map((relation) => ({
    total: cellOf(relation.total),
    parts: relation.parts.map(cellOf),
  }));
}

/** One answer's cells before suppression. */
export interface AnalyticsTableInput {
  /** `analytics-suppression-threshold`, 11 to 100. */
  readonly threshold: number;
  readonly lattice: AnalyticsTimeLattice;
  /**
   * Day series by key: each local day's count (a day of the window absent from the map counts 0).
   * Every series gets a cell at every node of the lattice, the sums of its days.
   */
  readonly series?: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** Relations between series keys, applied at every node; a key with no series is virtual. */
  readonly relations?: readonly AnalyticsAdditiveGroup[];
  /** Cells off the time axis (window totals by group), by id; an id never holds `@`. */
  readonly cells?: ReadonlyMap<string, number>;
  /** Relations among `cells`, series cells and `virtual` ids. */
  readonly groups?: readonly AnalyticsAdditiveGroup[];
  /** Ids `groups` may name that no answer shows (a population no cell holds). */
  readonly virtual?: readonly string[];
}

/** One answer's cells after suppression. */
export interface AnalyticsTable {
  readonly threshold: number;
  readonly lattice: AnalyticsTimeLattice;
  /** A shown cell as the answer shows it. */
  count(id: string): AnalyticsCountCell;
  /** The rate of the summed `numerator` cells over the summed `denominator` cells. */
  rate(numerator: readonly string[], denominator: readonly string[]): AnalyticsRateCell;
  /** How many of `ids` are hidden (an answer's `suppressed-cells`). */
  suppressedAmong(ids: Iterable<string>): number;
}

/**
 * C164.7: the one suppression every answer, CSV download and caption is built from. It builds a
 * cell for every series at every node of the lattice (days, weeks, months and the total, whatever
 * `bucket` the answer lists, so that every bucket of one window hides the same cells), the groups
 * that tie a week, a month and the total to their days, each relation at every node, and the
 * caller's cells and groups off the time axis, then hides through `complementarySuppression`.
 *
 * A rate's exact value is shown only when every cell it sums is shown; a bound only when every
 * denominator cell is shown (a bound read from a hidden denominator would narrow it), and an "under"
 * bound only when no numerator cell is hidden as complementary, an "over" bound only when none is
 * hidden at all; otherwise the rate is hidden.
 */
export function suppressAnalyticsTable(input: AnalyticsTableInput): AnalyticsTable {
  const { threshold, lattice } = input;
  assertThreshold(threshold);
  const nodes = [...lattice.days, ...lattice.weeks, ...lattice.months, lattice.total];
  const inWindow = new Set(lattice.total.days);
  const values = new Map<string, number>();
  const groups: AnalyticsAdditiveGroup[] = [];
  const keys = new Set<string>();
  for (const [key, days] of input.series ?? new Map<string, ReadonlyMap<string, number>>()) {
    assertKey(key, 'a series key');
    keys.add(key);
    for (const [day, count] of days) {
      if (!inWindow.has(day)) {
        throw new AnalyticsInputError(`series ${key} counts a day outside the window`);
      }
      assertCount(count, `series ${key}`);
    }
    for (const node of nodes) {
      values.set(
        analyticsSeriesCellId(key, node),
        node.days.reduce((sum, day) => sum + (days.get(day) ?? 0), 0),
      );
    }
  }
  const relations = input.relations ?? [];
  for (const relation of relations) {
    for (const key of [relation.total, ...relation.parts]) {
      assertKey(key, 'a relation key');
      keys.add(key);
    }
  }
  // The time axis: a week and a month are the sums of their days, the total that of its months
  // (the same equations as the total of its days, and far sparser).
  const exact: AnalyticsAdditiveGroup[] = [];
  for (const key of keys) {
    for (const node of [...lattice.weeks, ...lattice.months]) {
      exact.push({
        total: analyticsSeriesCellId(key, node),
        parts: node.days.map((day) => analyticsSeriesCellId(key, `day:${day}`)),
      });
    }
    exact.push({
      total: analyticsSeriesCellId(key, lattice.total),
      parts: lattice.months.map((node) => analyticsSeriesCellId(key, node)),
    });
  }
  // Each relation at every node; at a week, a month and the total it follows from the days', so
  // the exact check reads the days' alone while the plan's rule reads them all.
  const implied: AnalyticsAdditiveGroup[] = [];
  for (const node of nodes) {
    const at = analyticsRelationGroups(relations, (key) => analyticsSeriesCellId(key, node));
    (node.kind === 'day' ? exact : implied).push(...at);
  }
  groups.push(...exact, ...implied);
  for (const [id, count] of input.cells ?? new Map<string, number>()) {
    assertKey(id, 'a cell id');
    values.set(id, assertCount(count, `cell ${id}`));
  }
  const declared = new Set(input.virtual ?? []);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const isSeriesCell = (id: string) => {
    const at = id.indexOf('@');
    return at > 0 && keys.has(id.slice(0, at)) && nodeIds.has(id.slice(at + 1));
  };
  for (const group of input.groups ?? []) {
    for (const id of [group.total, ...group.parts]) {
      if (!values.has(id) && !declared.has(id) && !isSeriesCell(id)) {
        throw new AnalyticsInputError(`group cell ${id} is neither a cell nor declared virtual`);
      }
    }
    groups.push(group);
    exact.push(group);
  }
  const hidden = hideCells(values, groups, exact, threshold);
  const valueOf = (id: string) => {
    const value = values.get(id);
    if (value === undefined) {
      throw new AnalyticsInputError(`${id} is not a cell of the answer`);
    }
    return value;
  };
  return Object.freeze({
    threshold,
    lattice,
    count(id: string): AnalyticsCountCell {
      const value = valueOf(id);
      const reason = hidden.get(id);
      return reason === undefined ? value : reason === 'small-count' ? SMALL_COUNT : COMPLEMENTARY;
    },
    rate(numerator: readonly string[], denominator: readonly string[]): AnalyticsRateCell {
      const sum = (ids: readonly string[]) => ids.reduce((total, id) => total + valueOf(id), 0);
      const cell = suppressRate(
        { numerator: sum(numerator), denominator: sum(denominator) },
        threshold,
      );
      const denominatorHidden = denominator.some((id) => hidden.has(id));
      const numeratorHidden = numerator.some((id) => hidden.has(id));
      const numeratorComplementary = numerator.some((id) => hidden.get(id) === 'complementary');
      if ('value' in cell) {
        return numeratorHidden || denominatorHidden ? HIDDEN_RATE : cell;
      }
      if ('below' in cell) {
        return numeratorComplementary || denominatorHidden ? HIDDEN_RATE : cell;
      }
      if ('above' in cell) {
        return numeratorHidden || denominatorHidden ? HIDDEN_RATE : cell;
      }
      return cell;
    },
    suppressedAmong(ids: Iterable<string>): number {
      let count = 0;
      for (const id of ids) {
        valueOf(id);
        if (hidden.has(id)) {
          count += 1;
        }
      }
      return count;
    },
  });
}
