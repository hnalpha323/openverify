/**
 * Plane geometry for the layout checks: the perspective transform that maps the document's quad
 * (upload pixels, clockwise from the top left, C32.1) onto the rectified rectangle, so boxes the
 * vision service reports in upload pixels (the portrait) compare with boxes in rectified pixels
 * (the text, the MRZ).
 */
export type Point = readonly [x: number, y: number];

/** Solves `a x = b` by Gaussian elimination with partial pivoting; `null` when singular. */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, index) => [...row, b[index] ?? 0]);
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < n; row += 1) {
      if (Math.abs(m[row]?.[column] ?? 0) > Math.abs(m[pivot]?.[column] ?? 0)) {
        pivot = row;
      }
    }
    const top = m[pivot];
    const current = m[column];
    if (top === undefined || current === undefined || Math.abs(top[column] ?? 0) < 1e-9) {
      return null;
    }
    m[pivot] = current;
    m[column] = top;
    for (let row = 0; row < n; row += 1) {
      const target = m[row];
      if (row === column || target === undefined) {
        continue;
      }
      const factor = (target[column] ?? 0) / (top[column] ?? 1);
      for (let k = column; k <= n; k += 1) {
        target[k] = (target[k] ?? 0) - factor * (top[k] ?? 0);
      }
    }
  }
  return m.map((row, index) => (row[n] ?? 0) / (row[index] ?? 1));
}

/**
 * The perspective transform from `quad` to the rectangle `(0, 0)`-`size`, or `null` for a
 * degenerate quad.
 */
export function perspectiveMap(
  quad: readonly [Point, Point, Point, Point],
  size: readonly [width: number, height: number],
): ((point: Point) => Point) | null {
  const [width, height] = size;
  const targets: Point[] = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ];
  const a: number[][] = [];
  const b: number[] = [];
  quad.forEach(([x, y], index) => {
    const [u, v] = targets[index] ?? [0, 0];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  });
  const h = solve(a, b);
  if (h === null) {
    return null;
  }
  const [h0 = 0, h1 = 0, h2 = 0, h3 = 0, h4 = 0, h5 = 0, h6 = 0, h7 = 0] = h;
  return ([x, y]) => {
    const w = h6 * x + h7 * y + 1;
    return [(h0 * x + h1 * y + h2) / w, (h3 * x + h4 * y + h5) / w];
  };
}
