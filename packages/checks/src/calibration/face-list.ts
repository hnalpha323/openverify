/**
 * Workflow 7B's face-list calibration (Workflow 11D; `docs/calibration/lists-phase11.md` item (i),
 * owner decision 3 after 7B): from Phase 4's pinned face-match measurements (studio portraits,
 * public-domain faces; `selfie-measurements.json`), the identification rates of a face list at a
 * gallery size, at `face-list-threshold` 0.5 and at the threshold the method's rule picks:
 *
 * - **FPIR** (false positive identification rate per search): a non-mated search that returns any
 *   gallery item at or above the threshold. With a per-comparison false match rate `FAR(t)` over
 *   independent non-mates, `FPIR(N, t) = 1 - (1 - FAR(t))^N`.
 * - **FNIR** (false negative identification rate): a mated search whose mate is not returned, the
 *   genuine pairs below the threshold (the list returns every item at or above it).
 *
 * Each with a 95% bootstrap interval over identities (the report's seed and replicates), every
 * threshold judged on the same replicates, so FPIR's upper end falls as the threshold rises. The
 * rule: 0.5 stays when the upper end of its FPIR at 10,000 is at most 1%; otherwise the lowest
 * threshold of the grid whose upper end is, with its FNIR. The domain is stated: studio portraits,
 * not handheld selfies against a list photo. Identities and images are pseudonymous ids; no face.
 */
import { identityOf, type SelfieCalibrationMeasurements } from './selfie-report.js';

/** The gallery sizes the method names (10,000 is a face list's item cap). */
export const FACE_LIST_GALLERY_SIZES = Object.freeze([1000, 10_000]);
/** The provisional `face-list-threshold` Workflow 7B shipped, which the 11D calibration judged (fix-11d moved the shipped value to 0.72). */
export const FACE_LIST_THRESHOLD = 0.5;
/** The method's rule: the FPIR interval's upper end at this gallery at most this share. */
export const FACE_LIST_RULE = Object.freeze({ gallery: 10_000, maxFpirUpper: 0.01 });
/** The thresholds the rule may pick: 0.30 to 0.95 by 0.01. */
export const FACE_LIST_GRID = Object.freeze(
  Array.from({ length: 66 }, (_, i) => Math.round((0.3 + i * 0.01) * 100) / 100),
);

export interface Interval {
  value: number;
  low: number;
  high: number;
}

export interface FaceListRow {
  threshold: number;
  far: number;
  fnir: Interval;
  fpir: Record<string, Interval>;
}

export interface FaceListReport {
  domain: string;
  identities: number;
  genuinePairs: number;
  impostorPairs: number;
  seed: number;
  replicates: number;
  galleries: readonly number[];
  rule: { gallery: number; maxFpirUpper: number };
  /** 0.5 first, then the picked threshold when it differs. */
  rows: FaceListRow[];
  /** Whether 0.5 meets the rule. */
  stays: boolean;
  /** The lowest grid threshold that meets the rule when 0.5 does not; null when none does. */
  picked: number | null;
}

/** `1 - (1 - far)^gallery`: a search over `gallery` independent non-mates. */
export function fpirOf(far: number, gallery: number): number {
  return 1 - (1 - far) ** gallery;
}

/** A deterministic PRNG in [0, 1) (mulberry32), as the selfie report's. */
function mulberry(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

interface Data {
  identities: number;
  genuineIdentity: Int32Array;
  genuineCosine: Float64Array;
  groupA: Int32Array;
  groupB: Int32Array;
  /** Each identity-pair group's impostor cosines, highest first. */
  groupCosines: Float64Array[];
}

function dataOf(measurements: SelfieCalibrationMeasurements): Data {
  const names = [
    ...new Set(measurements.pairs.flatMap((pair) => [identityOf(pair.a), identityOf(pair.b)])),
  ].sort();
  const index = new Map(names.map((name, position) => [name, position]));
  const genuine: [number, number][] = [];
  const groups = new Map<number, number[]>();
  for (const pair of measurements.pairs) {
    const a = index.get(identityOf(pair.a)) ?? 0;
    const b = index.get(identityOf(pair.b)) ?? 0;
    if (pair.genuine) {
      genuine.push([a, pair.cosine]);
      continue;
    }
    const key = Math.min(a, b) * names.length + Math.max(a, b);
    const list = groups.get(key) ?? [];
    list.push(pair.cosine);
    groups.set(key, list);
  }
  if (genuine.length === 0 || groups.size === 0) {
    throw new Error('the measurements need genuine and impostor pairs');
  }
  const keys = [...groups.keys()].sort((x, y) => x - y);
  return {
    identities: names.length,
    genuineIdentity: Int32Array.from(genuine, ([identity]) => identity),
    genuineCosine: Float64Array.from(genuine, ([, cosine]) => cosine),
    groupA: Int32Array.from(keys, (key) => Math.floor(key / names.length)),
    groupB: Int32Array.from(keys, (key) => key % names.length),
    groupCosines: keys.map((key) =>
      Float64Array.from((groups.get(key) ?? []).sort((x, y) => y - x)),
    ),
  };
}

/** Each identity's draws in `replicates` resamples of the identities (with replacement). */
function replicateCounts(identities: number, replicates: number, seed: number): Float64Array[] {
  const next = mulberry(seed);
  return Array.from({ length: replicates }, () => {
    const counts = new Float64Array(identities);
    for (let draw = 0; draw < identities; draw += 1) {
      const identity = Math.floor(next() * identities);
      counts[identity] = (counts[identity] ?? 0) + 1;
    }
    return counts;
  });
}

/** How many of a group's cosines (highest first) are at or above `threshold`. */
function aboveIn(cosines: Float64Array, threshold: number): number {
  let low = 0;
  let high = cosines.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((cosines[middle] ?? 0) >= threshold) low = middle + 1;
    else high = middle;
  }
  return low;
}

function weightedFar(data: Data, counts: Float64Array | null, above: Float64Array): number {
  let accepted = 0;
  let total = 0;
  for (let group = 0; group < above.length; group += 1) {
    const weight =
      counts === null
        ? 1
        : (counts[data.groupA[group] ?? 0] ?? 0) * (counts[data.groupB[group] ?? 0] ?? 0);
    if (weight === 0) continue;
    accepted += weight * (above[group] ?? 0);
    total += weight * (data.groupCosines[group]?.length ?? 0);
  }
  return total === 0 ? 0 : accepted / total;
}

function weightedFnir(data: Data, counts: Float64Array | null, threshold: number): number {
  let rejected = 0;
  let total = 0;
  data.genuineCosine.forEach((cosine, pair) => {
    const weight = counts === null ? 1 : (counts[data.genuineIdentity[pair] ?? 0] ?? 0);
    total += weight;
    if (cosine < threshold) rejected += weight;
  });
  return total === 0 ? 0 : rejected / total;
}

const percentile = (sorted: readonly number[], q: number): number =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))] ?? 0;

const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

function interval(value: number, replicates: number[]): Interval {
  const sorted = [...replicates].sort((x, y) => x - y);
  return {
    value: round6(value),
    low: round6(percentile(sorted, 0.025)),
    high: round6(percentile(sorted, 0.975)),
  };
}

function rowAt(data: Data, replicates: readonly Float64Array[], threshold: number): FaceListRow {
  const above = Float64Array.from(data.groupCosines, (cosines) => aboveIn(cosines, threshold));
  const far = weightedFar(data, null, above);
  const fars = replicates.map((counts) => weightedFar(data, counts, above));
  const fnirs = replicates.map((counts) => weightedFnir(data, counts, threshold));
  return {
    threshold,
    far: round6(far),
    fnir: interval(weightedFnir(data, null, threshold), fnirs),
    fpir: Object.fromEntries(
      FACE_LIST_GALLERY_SIZES.map((gallery) => [
        String(gallery),
        interval(
          fpirOf(far, gallery),
          fars.map((value) => fpirOf(value, gallery)),
        ),
      ]),
    ),
  };
}

const meets = (row: FaceListRow) =>
  (row.fpir[String(FACE_LIST_RULE.gallery)]?.high ?? 1) <= FACE_LIST_RULE.maxFpirUpper;

/** The face list's identification rates and the rule's verdict (see the file header). */
export function faceListReport(
  measurements: SelfieCalibrationMeasurements,
  options: { seed: number; replicates: number },
): FaceListReport {
  const data = dataOf(measurements);
  const replicates = replicateCounts(data.identities, options.replicates, options.seed);
  const shipped = rowAt(data, replicates, FACE_LIST_THRESHOLD);
  const rows = [shipped];
  let picked: number | null = null;
  if (!meets(shipped)) {
    // Every threshold is judged on the same replicates, so the upper end falls as it rises: the
    // lowest grid threshold that meets the rule is found by bisection.
    let low = 0;
    let high = FACE_LIST_GRID.length;
    let found: FaceListRow | null = null;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const row = rowAt(data, replicates, FACE_LIST_GRID[middle] ?? 1);
      if (meets(row)) {
        found = row;
        high = middle;
      } else {
        low = middle + 1;
      }
    }
    if (found !== null && low < FACE_LIST_GRID.length) {
      const row =
        found.threshold === FACE_LIST_GRID[low]
          ? found
          : rowAt(data, replicates, FACE_LIST_GRID[low] ?? 1);
      picked = row.threshold;
      rows.push(row);
    }
  }
  return {
    domain: measurements.domain,
    identities: data.identities,
    genuinePairs: data.genuineCosine.length,
    impostorPairs: data.groupCosines.reduce((sum, cosines) => sum + cosines.length, 0),
    seed: options.seed,
    replicates: options.replicates,
    galleries: FACE_LIST_GALLERY_SIZES,
    rule: { ...FACE_LIST_RULE },
    rows,
    stays: meets(shipped),
    picked,
  };
}

export interface FaceListArgs {
  input: string;
  output: string;
  seed: number;
  replicates: number;
}

/** The repository-relative defaults: Phase 4's measurements in, the rates' JSON out. */
export const FACE_LIST_DEFAULTS = Object.freeze({
  input: 'fixtures/generated/calibration/selfie-measurements.json',
  output: 'fixtures/generated/calibration/face-list.json',
  replicates: 1000,
});

/**
 * `calibration-report.ts --face-list [--input f] [--output f] --seed <n> [--replicates n]`: the
 * seed is required (the calibration draws it, `openssl rand -hex 16`, and passes its first 32 bits:
 * `--seed $((16#${SEED:0:8}))`), so no default seed hides a draw.
 */
export function parseFaceListArgs(argv: readonly string[], root: string): FaceListArgs {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--face-list') continue;
    if (!['--input', '--output', '--seed', '--replicates'].includes(arg)) {
      throw new Error(`--face-list takes --input, --output, --seed and --replicates, not ${arg}`);
    }
    const value = argv[(i += 1)];
    if (value === undefined) throw new Error(`${arg} needs a value`);
    values.set(arg, value);
  }
  const whole = (name: string, fallback: number | undefined, max: number): number => {
    const text = values.get(name);
    if (text === undefined) {
      if (fallback === undefined) throw new Error(`${name} is required for --face-list`);
      return fallback;
    }
    if (!/^\d+$/u.test(text) || Number(text) > max) {
      throw new Error(`${name} must be a whole number from 0 to ${String(max)}`);
    }
    return Number(text);
  };
  const resolve = (name: string, fallback: string) => {
    const given = values.get(name) ?? fallback;
    return given.startsWith('/') ? given : `${root}/${given}`;
  };
  return {
    input: resolve('--input', FACE_LIST_DEFAULTS.input),
    output: resolve('--output', FACE_LIST_DEFAULTS.output),
    seed: whole('--seed', undefined, 4_294_967_295),
    replicates: Math.max(1, whole('--replicates', FACE_LIST_DEFAULTS.replicates, 100_000)),
  };
}
