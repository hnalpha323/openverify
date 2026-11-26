/**
 * A maximum-weight matching of a small bipartite graph, by the Hungarian method (Kuhn-Munkres with
 * potentials, O(n³)), and Dinkelbach's method on top of it for the best ratio of matched score to
 * total weight, which is how C78.4's weighted mean is maximised exactly. Names hold at most
 * `MAX_NAME_TOKENS` tokens, so the matrices are small.
 */

/** A pair of the matching: row `left`, column `right`. */
export interface Pair {
  readonly left: number;
  readonly right: number;
}

/**
 * The matching that maximises the summed value of its pairs; a pair whose value is `null` or not
 * positive is never taken (leaving both sides unmatched is better).
 */
export function maximumWeightMatching(values: readonly (readonly (number | null)[])[]): Pair[] {
  const rows = values.length;
  const columns = values[0]?.length ?? 0;
  const size = Math.max(rows, columns);
  if (size === 0) {
    return [];
  }
  const gain = (row: number, column: number) => {
    const value = values[row]?.[column] ?? null;
    return value !== null && value > 0 ? value : 0;
  };
  // Minimise the negated gains on a square matrix, 1-based as the classic formulation.
  const u = new Array<number>(size + 1).fill(0);
  const v = new Array<number>(size + 1).fill(0);
  const owner = new Array<number>(size + 1).fill(0);
  const way = new Array<number>(size + 1).fill(0);
  for (let row = 1; row <= size; row += 1) {
    owner[0] = row;
    let column = 0;
    const minimum = new Array<number>(size + 1).fill(Number.POSITIVE_INFINITY);
    const used = new Array<boolean>(size + 1).fill(false);
    do {
      used[column] = true;
      const current = owner[column] ?? 0;
      let delta = Number.POSITIVE_INFINITY;
      let next = 0;
      for (let candidate = 1; candidate <= size; candidate += 1) {
        if (used[candidate] === true) {
          continue;
        }
        const reduced = -gain(current - 1, candidate - 1) - (u[current] ?? 0) - (v[candidate] ?? 0);
        if (reduced < (minimum[candidate] ?? Number.POSITIVE_INFINITY)) {
          minimum[candidate] = reduced;
          way[candidate] = column;
        }
        if ((minimum[candidate] ?? Number.POSITIVE_INFINITY) < delta) {
          delta = minimum[candidate] ?? Number.POSITIVE_INFINITY;
          next = candidate;
        }
      }
      for (let candidate = 0; candidate <= size; candidate += 1) {
        if (used[candidate] === true) {
          const held = owner[candidate] ?? 0;
          u[held] = (u[held] ?? 0) + delta;
          v[candidate] = (v[candidate] ?? 0) - delta;
        } else {
          minimum[candidate] = (minimum[candidate] ?? 0) - delta;
        }
      }
      column = next;
    } while ((owner[column] ?? 0) !== 0);
    do {
      const previous = way[column] ?? 0;
      owner[column] = owner[previous] ?? 0;
      column = previous;
    } while (column !== 0);
  }
  const pairs: Pair[] = [];
  for (let column = 1; column <= size; column += 1) {
    const row = (owner[column] ?? 0) - 1;
    if (row >= 0 && row < rows && column - 1 < columns && gain(row, column - 1) > 0) {
      pairs.push({ left: row, right: column - 1 });
    }
  }
  return pairs.sort((a, b) => a.left - b.left);
}

/** A weighted pairing problem: each pair's score and weight, each side's unmatched weight. */
export interface RatioProblem {
  /** `null` where a pair is not allowed. */
  readonly scores: readonly (readonly (number | null)[])[];
  readonly weights: readonly (readonly number[])[];
  readonly unmatchedLeft: readonly number[];
  readonly unmatchedRight: readonly number[];
}

export interface RatioSolution {
  readonly ratio: number;
  readonly pairs: readonly Pair[];
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

/** The ratio of a matching: matched weight times score over matched and unmatched weight. */
export function matchingRatio(problem: RatioProblem, pairs: readonly Pair[]): number {
  let numerator = 0;
  let denominator = 0;
  const leftUsed = new Set<number>();
  const rightUsed = new Set<number>();
  for (const { left, right } of pairs) {
    const weight = problem.weights[left]?.[right] ?? 0;
    numerator += weight * (problem.scores[left]?.[right] ?? 0);
    denominator += weight;
    leftUsed.add(left);
    rightUsed.add(right);
  }
  denominator += sum(problem.unmatchedLeft.filter((_, index) => !leftUsed.has(index)));
  denominator += sum(problem.unmatchedRight.filter((_, index) => !rightUsed.has(index)));
  return denominator > 0 ? numerator / denominator : 0;
}

/** The most Dinkelbach iterations (it converges in two or three on names). */
const MAX_ITERATIONS = 30;

/** The matching with the best ratio (Dinkelbach's method over maximum-weight matchings). */
export function bestRatioMatching(problem: RatioProblem): RatioSolution {
  let best: RatioSolution = { ratio: 0, pairs: [] };
  let lambda = 0;
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    const values = problem.scores.map((row, left) =>
      row.map((score, right) => {
        if (score === null) {
          return null;
        }
        const weight = problem.weights[left]?.[right] ?? 0;
        const freed = (problem.unmatchedLeft[left] ?? 0) + (problem.unmatchedRight[right] ?? 0);
        return weight * (score - lambda) + lambda * freed;
      }),
    );
    const pairs = maximumWeightMatching(values);
    const ratio = matchingRatio(problem, pairs);
    if (ratio <= lambda + 1e-12) {
      break;
    }
    lambda = ratio;
    best = { ratio, pairs };
  }
  return best;
}
