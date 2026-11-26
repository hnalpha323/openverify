/**
 * Test support (Phase 9, Workflow 9B; review P21; `analytics-logic`): an independent check that no
 * hidden cell can be derived from the visible others. Written apart from `derivation.ts` (dense
 * rational elimination, no provenance, no incremental reduction), so the property tests do not
 * check the algorithm with itself.
 *
 * Every group says `total = Σ parts`. With the known cells moved to the right-hand side, the unknown
 * cells satisfy `M · x = b`. A cell `x_h` is determined by the known cells exactly when every vector
 * of the null space of `M` is 0 at `h`.
 */

interface Group {
  readonly total: string;
  readonly parts: readonly string[];
}

const gcd = (left: bigint, right: bigint): bigint => {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    [a, b] = [b, a % b];
  }
  return a;
};

/** The unknown cells that the groups determine. */
export function derivableCells(
  unknown: ReadonlySet<string>,
  groups: readonly Group[],
): ReadonlySet<string> {
  const columns = [...unknown].sort();
  const indexOf = new Map(columns.map((id, index) => [id, index]));
  const matrix: bigint[][] = [];
  for (const group of groups) {
    const row = columns.map(() => 0n);
    let touched = false;
    for (const [id, sign] of [
      [group.total, 1n] as const,
      ...group.parts.map((part) => [part, -1n] as const),
    ]) {
      const column = indexOf.get(id);
      if (column !== undefined) {
        row[column] = (row[column] ?? 0n) + sign;
        touched = true;
      }
    }
    if (touched) {
      matrix.push(row);
    }
  }
  // Dense fraction-free reduction to reduced row echelon form.
  const pivots: number[] = [];
  let rank = 0;
  for (let column = 0; column < columns.length && rank < matrix.length; column += 1) {
    const found = matrix.findIndex((row, index) => index >= rank && (row[column] ?? 0n) !== 0n);
    if (found === -1) {
      continue;
    }
    const pivotRow = matrix[found] ?? [];
    matrix[found] = matrix[rank] ?? [];
    matrix[rank] = pivotRow;
    const pivot = pivotRow[column] ?? 1n;
    for (let index = 0; index < matrix.length; index += 1) {
      const row = matrix[index] ?? [];
      const factor = row[column] ?? 0n;
      if (index === rank || factor === 0n) {
        continue;
      }
      let common = 0n;
      for (let cell = 0; cell < row.length; cell += 1) {
        row[cell] = pivot * (row[cell] ?? 0n) - factor * (pivotRow[cell] ?? 0n);
        common = gcd(common, row[cell] ?? 0n);
      }
      if (common > 1n) {
        for (let cell = 0; cell < row.length; cell += 1) {
          row[cell] = (row[cell] ?? 0n) / common;
        }
      }
    }
    pivots.push(column);
    rank += 1;
  }
  // The null space: one basis vector per free column; a pivot column is determined exactly when its
  // row holds no free column.
  const free = columns.map((_, index) => index).filter((index) => !pivots.includes(index));
  const derivable = new Set<string>();
  pivots.forEach((column, index) => {
    const row = matrix[index] ?? [];
    if (free.every((other) => (row[other] ?? 0n) === 0n)) {
      derivable.add(columns[column] ?? '');
    }
  });
  return derivable;
}
