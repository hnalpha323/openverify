/**
 * C164.7 (Phase 9, Workflow 9B; review P21; `analytics-logic`): which unknown cells the known ones
 * determine. Internal to `suppression.ts`, never exported from the package root.
 *
 * Every group says `total = Σ parts`. With the known cells moved to the right-hand side, the unknown
 * cells satisfy `M · x = b`, one row per group that holds an unknown cell. A cell `x_h` follows from
 * the known cells exactly when the unit vector `e_h` lies in the row space of `M`, which in a fully
 * reduced row echelon form means that some row holds `h` alone. The rows are reduced exactly, in
 * integers (fraction-free, divided by their gcd after each step), sparse, one group at a time. Each
 * row also carries the combination of groups it is (`combination`), so for a determined cell the
 * known cells its derivation reads with a non-zero net coefficient are known too: hiding any one of
 * them breaks that derivation.
 *
 * The arithmetic runs on doubles while every value stays a safe integer (always, in practice: every
 * group's coefficients are 1 and -1, and the gcd keeps the rows small), and is redone on `bigint`
 * from the start if one ever would not, so the answer is exact either way.
 */

export interface DerivationGroup {
  readonly total: string;
  readonly parts: readonly string[];
}

interface Arithmetic<N> {
  readonly zero: N;
  readonly one: N;
  of(value: number): N;
  times(left: N, right: N): N;
  minus(left: N, right: N): N;
  divide(left: N, right: N): N;
  negative(value: N): boolean;
  isZero(value: N): boolean;
  gcd(left: N, right: N): N;
}

class Overflow extends Error {}

const doubles: Arithmetic<number> = {
  zero: 0,
  one: 1,
  of: (value) => value,
  times: (left, right) => {
    const product = left * right;
    if (!Number.isSafeInteger(product)) {
      throw new Overflow();
    }
    return product;
  },
  minus: (left, right) => {
    const difference = left - right;
    if (!Number.isSafeInteger(difference)) {
      throw new Overflow();
    }
    return difference;
  },
  divide: (left, right) => left / right,
  negative: (value) => value < 0,
  isZero: (value) => value === 0,
  gcd: (left, right) => {
    let a = Math.abs(left);
    let b = Math.abs(right);
    while (b !== 0) {
      [a, b] = [b, a % b];
    }
    return a;
  },
};

const bigints: Arithmetic<bigint> = {
  zero: 0n,
  one: 1n,
  of: (value) => BigInt(value),
  times: (left, right) => left * right,
  minus: (left, right) => left - right,
  divide: (left, right) => left / right,
  negative: (value) => value < 0n,
  isZero: (value) => value === 0n,
  gcd: (left, right) => {
    let a = left < 0n ? -left : left;
    let b = right < 0n ? -right : right;
    while (b !== 0n) {
      [a, b] = [b, a % b];
    }
    return a;
  },
};

interface Row<N> {
  /** Unknown index to coefficient, never zero. */
  readonly coefficients: Map<number, N>;
  /** Group index to its coefficient in the combination this row is, never zero. */
  readonly combination: Map<number, N>;
}

function scaleInto<N>(math: Arithmetic<N>, map: Map<number, N>, factor: N): void {
  for (const [key, value] of map) {
    map.set(key, math.times(value, factor));
  }
}

function subtractInto<N>(math: Arithmetic<N>, map: Map<number, N>, other: Map<number, N>, by: N) {
  for (const [key, value] of other) {
    const next = math.minus(map.get(key) ?? math.zero, math.times(by, value));
    if (math.isZero(next)) {
      map.delete(key);
    } else {
      map.set(key, next);
    }
  }
}

/** `target := a · target − b · source`, which removes `variable` from `target`. */
function eliminate<N>(math: Arithmetic<N>, target: Row<N>, source: Row<N>, variable: number) {
  const a = source.coefficients.get(variable) ?? math.one;
  const b = target.coefficients.get(variable) ?? math.zero;
  if (a !== math.one) {
    scaleInto(math, target.coefficients, a);
    scaleInto(math, target.combination, a);
  }
  subtractInto(math, target.coefficients, source.coefficients, b);
  subtractInto(math, target.combination, source.combination, b);
}

/** Divides the row by the gcd of all its numbers and makes `pivot`'s coefficient positive. */
function normalize<N>(math: Arithmetic<N>, row: Row<N>, pivot: number): void {
  let common = math.zero;
  for (const value of row.coefficients.values()) {
    common = math.gcd(common, value);
  }
  for (const value of row.combination.values()) {
    common = math.gcd(common, value);
  }
  if (math.negative(row.coefficients.get(pivot) ?? math.zero)) {
    common = math.minus(math.zero, common);
  }
  if (common !== math.one && !math.isZero(common)) {
    for (const map of [row.coefficients, row.combination]) {
      for (const [key, value] of map) {
        map.set(key, math.divide(value, common));
      }
    }
  }
}

function reduce<N>(
  math: Arithmetic<N>,
  unknown: ReadonlySet<string>,
  groups: readonly DerivationGroup[],
): Map<string, readonly string[]> {
  const ids = [...unknown];
  const indexOf = new Map(ids.map((id, index) => [id, index]));
  const pivots = new Map<number, Row<N>>();
  /** Variable to the pivot variables whose rows hold it beside their pivot. */
  const holders = new Map<number, Set<number>>();
  const hold = (row: Row<N>, pivot: number, add: boolean) => {
    for (const index of row.coefficients.keys()) {
      if (index === pivot) {
        continue;
      }
      let set = holders.get(index);
      if (set === undefined) {
        set = new Set();
        holders.set(index, set);
      }
      if (add) {
        set.add(pivot);
      } else {
        set.delete(pivot);
      }
    }
  };
  groups.forEach((group, groupIndex) => {
    const row: Row<N> = {
      coefficients: new Map(),
      combination: new Map([[groupIndex, math.one]]),
    };
    const add = (id: string, sign: number) => {
      const index = indexOf.get(id);
      if (index !== undefined) {
        const next = math.minus(row.coefficients.get(index) ?? math.zero, math.of(-sign));
        if (math.isZero(next)) {
          row.coefficients.delete(index);
        } else {
          row.coefficients.set(index, next);
        }
      }
    };
    add(group.total, 1);
    for (const part of group.parts) {
      add(part, -1);
    }
    if (row.coefficients.size === 0) {
      return;
    }
    // Forward: the pivot rows are fully reduced, so one pass removes every pivot the row holds.
    for (const index of [...row.coefficients.keys()]) {
      const pivotRow = pivots.get(index);
      if (pivotRow !== undefined && row.coefficients.has(index)) {
        eliminate(math, row, pivotRow, index);
      }
    }
    if (row.coefficients.size === 0) {
      return;
    }
    // The new pivot: the variable fewest rows hold, which keeps the rows sparse.
    let pivot = -1;
    let fewest = Number.POSITIVE_INFINITY;
    for (const index of row.coefficients.keys()) {
      const count = holders.get(index)?.size ?? 0;
      if (count < fewest || (count === fewest && index < pivot)) {
        pivot = index;
        fewest = count;
      }
    }
    normalize(math, row, pivot);
    // Backward: remove the new pivot from every row that holds it, so the form stays reduced.
    for (const other of [...(holders.get(pivot) ?? [])]) {
      const otherRow = pivots.get(other);
      if (otherRow !== undefined) {
        hold(otherRow, other, false);
        eliminate(math, otherRow, row, pivot);
        normalize(math, otherRow, other);
        hold(otherRow, other, true);
      }
    }
    holders.delete(pivot);
    pivots.set(pivot, row);
    hold(row, pivot, true);
  });

  const determined = new Map<string, readonly string[]>();
  for (const [pivot, row] of pivots) {
    if (row.coefficients.size !== 1) {
      continue;
    }
    // The net coefficient of each known cell in the combination of groups.
    const net = new Map<string, N>();
    for (const [groupIndex, factor] of row.combination) {
      const group = groups[groupIndex];
      if (group === undefined) {
        continue;
      }
      for (const [id, sign] of [
        [group.total, 1] as const,
        ...group.parts.map((part) => [part, -1] as const),
      ]) {
        if (!unknown.has(id)) {
          net.set(id, math.minus(net.get(id) ?? math.zero, math.times(math.of(-sign), factor)));
        }
      }
    }
    const reads = [...net]
      .filter(([, value]) => !math.isZero(value))
      .map(([id]) => id)
      .sort();
    determined.set(ids[pivot] ?? '', reads);
  }
  return determined;
}

/**
 * Every unknown cell the groups determine, with the known cells its derivation reads (a non-zero
 * net coefficient), sorted. Cells not in `unknown` are known.
 */
export function determinedUnknowns(
  unknown: ReadonlySet<string>,
  groups: readonly DerivationGroup[],
): ReadonlyMap<string, readonly string[]> {
  try {
    return reduce(doubles, unknown, groups);
  } catch (error) {
    if (error instanceof Overflow) {
      return reduce(bigints, unknown, groups);
    }
    throw error;
  }
}

/** `determinedUnknowns` on `bigint` throughout (its fallback), for the tests that compare the two. */
export function determinedUnknownsExact(
  unknown: ReadonlySet<string>,
  groups: readonly DerivationGroup[],
): ReadonlyMap<string, readonly string[]> {
  return reduce(bigints, unknown, groups);
}

/**
 * `determinedUnknowns`, one connected component of the unknown cells at a time (cells joined by a
 * group that holds both), reusing `cache`'s answer for a component whose cells have not changed: a
 * component's groups, and so what they determine, depend on its unknown cells alone. The cache keeps
 * only the components of this call.
 */
export function determinedByComponent(
  unknown: ReadonlySet<string>,
  groups: readonly DerivationGroup[],
  cache: Map<string, ReadonlyMap<string, readonly string[]>>,
): ReadonlyMap<string, readonly string[]> {
  const ids = [...unknown].sort();
  const indexOf = new Map(ids.map((id, index) => [id, index]));
  const parent = ids.map((_, index) => index);
  const root = (index: number): number => {
    let at = index;
    while (parent[at] !== at) {
      const up = parent[at] ?? at;
      parent[at] = parent[up] ?? up;
      at = up;
    }
    return at;
  };
  const touched: number[][] = groups.map((group) =>
    [group.total, ...group.parts]
      .map((id) => indexOf.get(id))
      .filter((index): index is number => index !== undefined),
  );
  for (const members of touched) {
    const [first, ...rest] = members;
    for (const other of rest) {
      const a = root(first ?? other);
      const b = root(other);
      if (a !== b) {
        parent[Math.max(a, b)] = Math.min(a, b);
      }
    }
  }
  const components = new Map<number, { cells: string[]; groups: DerivationGroup[] }>();
  ids.forEach((id, index) => {
    const at = root(index);
    const component = components.get(at) ?? { cells: [], groups: [] };
    component.cells.push(id);
    components.set(at, component);
  });
  touched.forEach((members, groupIndex) => {
    const group = groups[groupIndex];
    const first = members[0];
    if (group !== undefined && first !== undefined) {
      components.get(root(first))?.groups.push(group);
    }
  });
  const determined = new Map<string, readonly string[]>();
  const kept = new Set<string>();
  for (const component of components.values()) {
    if (component.groups.length === 0) {
      continue;
    }
    const key = component.cells.join('\n');
    kept.add(key);
    let answer = cache.get(key);
    if (answer === undefined) {
      answer = determinedUnknowns(new Set(component.cells), component.groups);
      cache.set(key, answer);
    }
    for (const [id, reads] of answer) {
      determined.set(id, reads);
    }
  }
  for (const key of [...cache.keys()]) {
    if (!kept.has(key)) {
      cache.delete(key);
    }
  }
  return determined;
}
