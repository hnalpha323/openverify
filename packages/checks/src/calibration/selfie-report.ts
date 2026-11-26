/**
 * The C49 face-match calibration report (selfie mode of `scripts/calibration-report.ts`): FAR and
 * FRR of the SFace cosine from `services/vision/tools/calibrate_selfie.py`'s measurements (the
 * Stage 1 schema, `contracts/fixtures/calibration/selfie-calibration.schema.json`). Scores only:
 * the measurements carry pseudonymous image ids and cosines, never an embedding or a name.
 *
 * - **Intervals:** a two-sided 95% bootstrap over identities. Each replicate draws the identities
 *   with replacement; a genuine pair counts once per draw of its identity, an impostor pair once
 *   per draw of each of its two identities. Only pairs of two different identities are impostors,
 *   so an identity drawn twice is never compared with itself as an impostor.
 * - **FAR upper bounds** are at least the rule-of-three bound `3 / impostor pairs`: a sample that
 *   shows no false accept does not show a FAR of zero.
 * - **FRR at a target FAR:** each replicate sets its own threshold (the lowest four-decimal value
 *   above the highest impostor cosine its FAR budget rejects), so the interval carries the
 *   threshold's uncertainty. A target is *resolvable* when the FAR interval's upper bound at the
 *   point threshold is below three times the target; FAR 1e-4 is otherwise reported as "not
 *   resolvable at this size".
 * - **1:N:** the expected false matches of one search over a gallery of N templates, `N x FAR`.
 * - **The review (C49.1):** FRR before and after the pinned exclusions, at fixed thresholds, each
 *   bootstrapped over the same identities.
 * - **Genuine cues:** the heuristic cues of genuine portraits and of re-encoded public-domain faces
 *   (a false-positive proxy), and each synthetic scale against their genuine tail: the 99th
 *   percentile (the 1st for a cue that is suspicious when small), or the maximum (minimum) with
 *   fewer than {@link GENUINE_TAIL_MIN_VALUES} values.
 *
 * Every table names its domain; the synthetic-fixture distributions are labelled provisional.
 */
import { FACE_MATCH_DEFAULTS, selfieConfigDefaults } from '@openverify/core';
import { z } from 'zod';
import { SYNTHETIC_SIGNALS } from '../selfie/synthetic-score.js';

const imageIdSchema = z.string().regex(/^p[0-9]{4}-[0-9]+$/, 'must be a pseudonymous image id');
const cueListsSchema = z.record(z.string(), z.array(z.number()));
const EXCLUSION_REASONS = [
  'near_duplicate',
  'different_person_per_metadata',
  'misattribution',
  'no_face',
  'fetch_failed',
] as const;

/** `selfie-calibration.schema.json` (schema version 1), strict as the JSON schema. */
export const selfieCalibrationSchema = z.strictObject({
  schema_version: z.literal(1),
  generated_at: z.iso.datetime({ offset: true }),
  domain: z.string().min(1),
  models: z.strictObject({ detector: z.string().min(1), recognizer: z.string().min(1) }),
  set: z.strictObject({
    manifest_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    identities: z.int().min(0),
    images: z.int().min(0),
    excluded: z.array(z.strictObject({ image: imageIdSchema, reason: z.enum(EXCLUSION_REASONS) })),
  }),
  pairs: z.array(
    z.strictObject({
      a: imageIdSchema,
      b: imageIdSchema,
      genuine: z.boolean(),
      cosine: z.number().min(-1).max(1),
      age_gap_years: z.number().min(0).nullable().optional(),
    }),
  ),
  review: z
    .strictObject({
      excluded_images: z.int().min(0),
      genuine_pairs_before: z.array(
        z.strictObject({
          a: imageIdSchema,
          b: imageIdSchema,
          genuine: z.literal(true),
          cosine: z.number().min(-1).max(1),
          age_gap_years: z.number().min(0).nullable().optional(),
        }),
      ),
    })
    .optional(),
  skew: z.strictObject({
    sex: z.record(z.string(), z.int().min(0)),
    ita_degrees: z.array(z.number()),
    per_group_frr_measured: z.literal(false),
  }),
  provisional: z.record(z.string(), z.array(z.number())),
  genuine_cues: z
    .strictObject({ portraits: cueListsSchema, re_encodings: cueListsSchema })
    .optional(),
});
export type SelfieCalibrationMeasurements = z.infer<typeof selfieCalibrationSchema>;

/** The bootstrap a report uses unless told otherwise (49: C49). */
export const SELFIE_CALIBRATION_BOOTSTRAP = Object.freeze({ seed: 49, replicates: 1000 });
/** The target FARs of the operating points (C49.2). */
export const SELFIE_CALIBRATION_TARGET_FARS = Object.freeze([1e-3, 1e-4]);
/** The gallery sizes of the 1:N table (C49.2). */
export const SELFIE_CALIBRATION_GALLERY_SIZES = Object.freeze([1000, 10_000, 100_000]);
/** OpenCV Zoo's published SFace 1:1 cosine threshold, the default until C49 (its own row, C48). */
export const SFACE_PUBLISHED_THRESHOLD = 0.363;
const SFACE_LABEL = "SFace's published 1:1 threshold (OpenCV Zoo)";
/** Below this many genuine values a cue's tail is its maximum (minimum), not a percentile. */
export const GENUINE_TAIL_MIN_VALUES = 100;

export interface SelfieCalibrationOptions {
  /** The bootstrap's seed (the report is reproducible). */
  seed?: number | undefined;
  /** Bootstrap replicates. */
  replicates?: number | undefined;
  /** Where the measurements came from, for the report header. */
  source?: string | undefined;
}

/** A rate and its two-sided 95% interval. */
export interface RateEstimate {
  value: number;
  low: number;
  high: number;
}

export interface Distribution {
  n: number;
  min: number;
  p5: number;
  median: number;
  p95: number;
  max: number;
}

export interface OperatingPoint {
  targetFar: number;
  threshold: number;
  /** The two-sided 95% bootstrap interval of the threshold itself (each replicate's own). */
  thresholdInterval: { low: number; high: number };
  far: RateEstimate;
  frr: RateEstimate;
  /** The FAR interval's upper bound is below three times the target. */
  resolvable: boolean;
}

export interface ThresholdRow {
  label: string;
  threshold: number;
  far: RateEstimate;
  frr: RateEstimate;
}

export interface GalleryRow {
  label: string;
  threshold: number;
  gallerySize: number;
  expectedFalseMatches: number;
  upperFalseMatches: number;
}

/** FRR before and after the review at one fixed threshold. */
export interface ReviewRow {
  label: string;
  threshold: number;
  before: RateEstimate;
  after: RateEstimate;
}

/** The C49.1 tails review: what it removed and the FRR on either side of it. */
export interface ReviewSummary {
  excludedImages: number;
  genuinePairsBefore: number;
  genuinePairsAfter: number;
  removedPairs: number;
  rows: readonly ReviewRow[];
}

/** A cue's distribution with its 1st and 99th percentiles. */
export interface CueDistribution extends Distribution {
  p1: number;
  p99: number;
}

/** One synthetic cue's provisional scale against the genuine tail of its values. */
export interface SyntheticScaleRow {
  key: string;
  /** Genuine values, the portraits' and the re-encodings' together. */
  n: number;
  /** `higher`: a larger value is more suspicious; `lower`: a smaller one. */
  direction: 'higher' | 'lower';
  /** The genuine tail on the suspicious side; `null` without a value. */
  genuineTail: number | null;
  tailRule: 'p99' | 'max' | 'p1' | 'min';
  clear: number;
  suspicious: number;
  weight: number;
  /** The clear level leaves the genuine tail with a suspicion above 0. */
  flagsGenuine: boolean;
}

/** The genuine cues: a false-positive proxy for the heuristic checks. */
export interface GenuineCues {
  portraits: Readonly<Record<string, CueDistribution>>;
  reEncodings: Readonly<Record<string, CueDistribution>>;
  synthetic: readonly SyntheticScaleRow[];
}

export interface SelfieCalibrationReport {
  domain: string;
  generatedAt: string;
  models: { detector: string; recognizer: string };
  source: string | null;
  seed: number;
  replicates: number;
  set: { identities: number; images: number; excluded: Readonly<Record<string, number>> };
  counts: { identities: number; genuinePairs: number; impostorPairs: number };
  ruleOfThree: { frr: number; far: number };
  operatingPoints: readonly OperatingPoint[];
  thresholds: readonly ThresholdRow[];
  gallery: readonly GalleryRow[];
  skew: {
    sex: Readonly<Record<string, number>>;
    ageGapYears: Distribution | null;
    itaDegrees: Distribution | null;
  };
  provisional: Readonly<Record<string, Distribution>>;
  /** `null` when the measurements carry no review section. */
  review: ReviewSummary | null;
  /** `null` when the measurements carry no genuine cues. */
  genuineCues: GenuineCues | null;
}

/** The identity of an image id (`p0001-2` belongs to `p0001`). */
export function identityOf(image: string): string {
  return image.split('-')[0] ?? image;
}

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

/** The `q` quantile of sorted values, linearly interpolated (R's type 7). */
function quantile(sorted: readonly number[], q: number): number {
  const position = (sorted.length - 1) * q;
  const below = Math.floor(position);
  const lower = sorted[below] ?? 0;
  const upper = sorted[Math.min(below + 1, sorted.length - 1)] ?? lower;
  return lower + (position - below) * (upper - lower);
}

/** The percentile distribution of a list of numbers; `null` when it is empty. */
export function distributionOf(values: readonly number[]): Distribution | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    min: round4(sorted[0] ?? 0),
    p5: round4(quantile(sorted, 0.05)),
    median: round4(quantile(sorted, 0.5)),
    p95: round4(quantile(sorted, 0.95)),
    max: round4(sorted.at(-1) ?? 0),
  };
}

/** {@link distributionOf} with the 1st and 99th percentiles; `null` when empty. */
export function cueDistributionOf(values: readonly number[]): CueDistribution | null {
  const base = distributionOf(values);
  if (base === null) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return { ...base, p1: round4(quantile(sorted, 0.01)), p99: round4(quantile(sorted, 0.99)) };
}

/**
 * Each synthetic cue's provisional scale against the genuine tail of the portraits' and the
 * re-encodings' values together. A cue flags genuine photos when its clear level lets the tail
 * read a suspicion above 0.
 */
function syntheticScales(
  portraits: Readonly<Record<string, readonly number[]>>,
  reEncodings: Readonly<Record<string, readonly number[]>>,
): SyntheticScaleRow[] {
  return SYNTHETIC_SIGNALS.map((signal): SyntheticScaleRow => {
    const values = [...(portraits[signal.key] ?? []), ...(reEncodings[signal.key] ?? [])];
    const sorted = [...values].sort((a, b) => a - b);
    const direction = signal.clear < signal.suspicious ? 'higher' : 'lower';
    const percentile = sorted.length >= GENUINE_TAIL_MIN_VALUES;
    const tailRule =
      direction === 'higher' ? (percentile ? 'p99' : 'max') : percentile ? 'p1' : 'min';
    const tail =
      sorted.length === 0
        ? null
        : round4(
            percentile
              ? quantile(sorted, direction === 'higher' ? 0.99 : 0.01)
              : ((direction === 'higher' ? sorted.at(-1) : sorted[0]) ?? 0),
          );
    return {
      key: signal.key,
      n: sorted.length,
      direction,
      genuineTail: tail,
      tailRule,
      clear: signal.clear,
      suspicious: signal.suspicious,
      weight: signal.weight,
      flagsGenuine:
        tail !== null && (direction === 'higher' ? signal.clear < tail : signal.clear > tail),
    };
  });
}

/** Genuine pairs by identity index, for a fixed-threshold FRR. */
interface GenuineSet {
  identity: Int32Array;
  cosine: Float64Array;
}

function genuineSet(
  pairs: readonly { a: string; cosine: number }[],
  index: ReadonlyMap<string, number>,
): GenuineSet {
  return {
    identity: Int32Array.from(pairs, (pair) => index.get(identityOf(pair.a)) ?? 0),
    cosine: Float64Array.from(pairs, (pair) => pair.cosine),
  };
}

/** Weighted FRR of a genuine set at `threshold` (`counts`: each identity's draws). */
function frrOf(set: GenuineSet, counts: Float64Array, threshold: number): number {
  let rejected = 0;
  let total = 0;
  set.cosine.forEach((cosine, pair) => {
    const weight = counts[set.identity[pair] ?? 0] ?? 0;
    total += weight;
    if (cosine < threshold) {
      rejected += weight;
    }
  });
  return total === 0 ? 0 : rejected / total;
}

/** A deterministic PRNG in [0, 1) (mulberry32). */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * The scored pairs by identity index. Impostor pairs are grouped by their two identities, so a
 * bootstrap replicate weighs each group once (`counts[a] x counts[b]`) instead of every pair.
 */
interface Scored {
  identities: string[];
  genuineIdentity: Int32Array;
  genuineCosine: Float64Array;
  /** The identity pairs (`a < b`) that hold impostor pairs, and how many each holds. */
  groupA: Int32Array;
  groupB: Int32Array;
  groupSize: Float64Array;
  /** Impostor pairs, highest cosine first: the cosine and the identity-pair group. */
  impostorCosine: Float64Array;
  impostorGroup: Int32Array;
}

/**
 * The pairs by identity index.
 * @throws {Error} for an impostor pair within one identity, a genuine pair across two, or a set
 * without genuine or impostor pairs.
 */
function scored(measurements: SelfieCalibrationMeasurements): Scored {
  const identities = [
    ...new Set(measurements.pairs.flatMap((pair) => [identityOf(pair.a), identityOf(pair.b)])),
  ].sort();
  const index = new Map(identities.map((identity, position) => [identity, position]));
  const at = (image: string) => index.get(identityOf(image)) ?? 0;
  const genuine: { identity: number; cosine: number }[] = [];
  const impostors: { group: number; cosine: number }[] = [];
  const groups = new Map<number, number>();
  const groupPairs: [number, number][] = [];
  for (const pair of measurements.pairs) {
    const same = identityOf(pair.a) === identityOf(pair.b);
    if (pair.genuine && !same) {
      throw new Error(`genuine pair ${pair.a}/${pair.b} spans different identities`);
    }
    if (!pair.genuine && same) {
      throw new Error(`impostor pair ${pair.a}/${pair.b} has the same identity`);
    }
    if (pair.genuine) {
      genuine.push({ identity: at(pair.a), cosine: pair.cosine });
      continue;
    }
    const [a, b] = [at(pair.a), at(pair.b)].sort((x, y) => x - y) as [number, number];
    const key = a * identities.length + b;
    let group = groups.get(key);
    if (group === undefined) {
      group = groupPairs.length;
      groups.set(key, group);
      groupPairs.push([a, b]);
    }
    impostors.push({ group, cosine: pair.cosine });
  }
  if (genuine.length === 0 || impostors.length === 0) {
    throw new Error('the measurements need genuine and impostor pairs');
  }
  impostors.sort((first, second) => second.cosine - first.cosine);
  const groupSize = new Float64Array(groupPairs.length);
  for (const { group } of impostors) {
    groupSize[group] = (groupSize[group] ?? 0) + 1;
  }
  return {
    identities,
    genuineIdentity: Int32Array.from(genuine, (pair) => pair.identity),
    genuineCosine: Float64Array.from(genuine, (pair) => pair.cosine),
    groupA: Int32Array.from(groupPairs, ([a]) => a),
    groupB: Int32Array.from(groupPairs, ([, b]) => b),
    groupSize,
    impostorCosine: Float64Array.from(impostors, (pair) => pair.cosine),
    impostorGroup: Int32Array.from(impostors, (pair) => pair.group),
  };
}

/** Each identity-pair group's weight in a replicate: the draws of its two identities. */
function groupWeights(data: Scored, counts: Float64Array): Float64Array {
  return Float64Array.from(
    data.groupA,
    (a, group) => (counts[a] ?? 0) * (counts[data.groupB[group] ?? 0] ?? 0),
  );
}

/** Per identity-pair group, its impostor pairs at or above `threshold`. */
function aboveCounts(data: Scored, threshold: number): Float64Array {
  const above = new Float64Array(data.groupSize.length);
  for (let pair = 0; pair < data.impostorCosine.length; pair += 1) {
    if ((data.impostorCosine[pair] ?? 0) < threshold) {
      break;
    }
    const group = data.impostorGroup[pair] ?? 0;
    above[group] = (above[group] ?? 0) + 1;
  }
  return above;
}

/** Weighted FAR: impostor weight at or above the threshold (`above`) over all impostor weight. */
function farWith(data: Scored, weights: Float64Array, above: Float64Array): number {
  let accepted = 0;
  let total = 0;
  weights.forEach((weight, group) => {
    accepted += weight * (above[group] ?? 0);
    total += weight * (data.groupSize[group] ?? 0);
  });
  return total === 0 ? 0 : accepted / total;
}

/** Weighted FRR at `threshold`: genuine weight below it over all genuine weight. */
function frrAt(data: Scored, counts: Float64Array, threshold: number): number {
  let rejected = 0;
  let total = 0;
  data.genuineCosine.forEach((cosine, pair) => {
    const weight = counts[data.genuineIdentity[pair] ?? 0] ?? 0;
    total += weight;
    if (cosine < threshold) {
      rejected += weight;
    }
  });
  return total === 0 ? 0 : rejected / total;
}

/**
 * The lowest four-decimal threshold whose weighted FAR is at most `target`: just above the
 * highest impostor cosine that would exceed the budget (ties are never split).
 */
function thresholdFor(data: Scored, weights: Float64Array, target: number): number {
  let total = 0;
  weights.forEach((weight, group) => {
    total += weight * (data.groupSize[group] ?? 0);
  });
  const budget = target * total;
  const weightOf = (pair: number) => weights[data.impostorGroup[pair] ?? 0] ?? 0;
  let accepted = 0;
  let next = 0;
  while (next < data.impostorCosine.length) {
    const cosine = data.impostorCosine[next] ?? 0;
    let end = next;
    let tie = 0;
    while (end < data.impostorCosine.length && data.impostorCosine[end] === cosine) {
      tie += weightOf(end);
      end += 1;
    }
    if (accepted + tie > budget) {
      return Math.ceil((cosine + 1e-9) * 10_000) / 10_000;
    }
    accepted += tie;
    next = end;
  }
  return -1;
}

const interval = (value: number, replicates: number[], floor = 0): RateEstimate => {
  const sorted = [...replicates].sort((a, b) => a - b);
  return {
    value,
    low: quantile(sorted, 0.025),
    high: Math.min(1, Math.max(floor, quantile(sorted, 0.975))),
  };
};

/**
 * Builds the report.
 * @throws {z.ZodError} for measurements that break the schema.
 * @throws {Error} for an impostor pair within one identity, a genuine pair across two, or a set
 * without genuine or impostor pairs.
 */
export function selfieCalibrationReport(
  measurements: unknown,
  options: SelfieCalibrationOptions = {},
): SelfieCalibrationReport {
  const parsed = selfieCalibrationSchema.parse(measurements);
  const data = scored(parsed);
  const seed = options.seed ?? SELFIE_CALIBRATION_BOOTSTRAP.seed;
  const replicates = options.replicates ?? SELFIE_CALIBRATION_BOOTSTRAP.replicates;
  const farFloor = Math.min(1, 3 / data.impostorCosine.length);
  const ones = new Float64Array(data.identities.length).fill(1);
  const unit = groupWeights(data, ones);

  const points = SELFIE_CALIBRATION_TARGET_FARS.map((target) => {
    const threshold = thresholdFor(data, unit, target);
    return { target, threshold, above: aboveCounts(data, threshold) };
  });
  const fixed = [
    { label: 'shared 1:1 face-match threshold', threshold: FACE_MATCH_DEFAULTS.threshold },
    {
      label: 'selfie_repeat_detection threshold',
      threshold: Number(selfieConfigDefaults('selfie_repeat_detection').threshold),
    },
    { label: 'threshold for FAR 1e-3', threshold: points[0]?.threshold ?? 1 },
    { label: SFACE_LABEL, threshold: SFACE_PUBLISHED_THRESHOLD },
  ].map((row) => ({ ...row, above: aboveCounts(data, row.threshold) }));

  const draws = {
    pointFar: points.map(() => [] as number[]),
    pointFrr: points.map(() => [] as number[]),
    pointThreshold: points.map(() => [] as number[]),
    fixedFar: fixed.map(() => [] as number[]),
    fixedFrr: fixed.map(() => [] as number[]),
  };
  const next = random(seed);
  const counts = new Float64Array(data.identities.length);
  for (let replicate = 0; replicate < replicates; replicate += 1) {
    counts.fill(0);
    data.identities.forEach(() => {
      const identity = Math.floor(next() * data.identities.length);
      counts[identity] = (counts[identity] ?? 0) + 1;
    });
    const weights = groupWeights(data, counts);
    points.forEach((point, position) => {
      const own = thresholdFor(data, weights, point.target);
      draws.pointFar[position]?.push(farWith(data, weights, point.above));
      draws.pointFrr[position]?.push(frrAt(data, counts, own));
      draws.pointThreshold[position]?.push(own);
    });
    fixed.forEach((row, position) => {
      draws.fixedFar[position]?.push(farWith(data, weights, row.above));
      draws.fixedFrr[position]?.push(frrAt(data, counts, row.threshold));
    });
  }

  const operatingPoints = points.map((point, position): OperatingPoint => {
    const far = interval(
      farWith(data, unit, point.above),
      draws.pointFar[position] ?? [],
      farFloor,
    );
    const own = [...(draws.pointThreshold[position] ?? [])].sort((a, b) => a - b);
    return {
      targetFar: point.target,
      threshold: point.threshold,
      thresholdInterval: { low: quantile(own, 0.025), high: quantile(own, 0.975) },
      far,
      frr: interval(frrAt(data, ones, point.threshold), draws.pointFrr[position] ?? []),
      resolvable: far.high < 3 * point.target,
    };
  });
  const thresholds = fixed.map(({ label, threshold, above }, position): ThresholdRow => ({
    label,
    threshold,
    far: interval(farWith(data, unit, above), draws.fixedFar[position] ?? [], farFloor),
    frr: interval(frrAt(data, ones, threshold), draws.fixedFrr[position] ?? []),
  }));
  const gallery = thresholds
    .filter((row) => row.label !== SFACE_LABEL)
    .flatMap((row) =>
      SELFIE_CALIBRATION_GALLERY_SIZES.map((size): GalleryRow => ({
        label: row.label,
        threshold: row.threshold,
        gallerySize: size,
        expectedFalseMatches: size * row.far.value,
        upperFalseMatches: size * row.far.high,
      })),
    );

  const excluded: Record<string, number> = {};
  for (const entry of parsed.set.excluded) {
    excluded[entry.reason] = (excluded[entry.reason] ?? 0) + 1;
  }
  const provisional = Object.fromEntries(
    Object.entries(parsed.provisional).flatMap(([name, values]) => {
      const distribution = distributionOf(values);
      return distribution === null ? [] : [[name, distribution]];
    }),
  );
  return {
    domain: parsed.domain,
    generatedAt: parsed.generated_at,
    models: parsed.models,
    source: options.source ?? null,
    seed,
    replicates,
    set: { identities: parsed.set.identities, images: parsed.set.images, excluded },
    counts: {
      identities: data.identities.length,
      genuinePairs: data.genuineCosine.length,
      impostorPairs: data.impostorCosine.length,
    },
    ruleOfThree: { frr: Math.min(1, 3 / data.genuineCosine.length), far: farFloor },
    operatingPoints,
    thresholds,
    gallery,
    skew: {
      sex: parsed.skew.sex,
      ageGapYears: distributionOf(
        parsed.pairs.flatMap((pair) =>
          pair.genuine && pair.age_gap_years != null ? [pair.age_gap_years] : [],
        ),
      ),
      itaDegrees: distributionOf(parsed.skew.ita_degrees),
    },
    provisional,
    review:
      parsed.review === undefined
        ? null
        : reviewOf(parsed, data, [points[0]?.threshold ?? 1, FACE_MATCH_DEFAULTS.threshold], {
            seed,
            replicates,
          }),
    genuineCues:
      parsed.genuine_cues === undefined
        ? null
        : {
            portraits: cueDistributions(parsed.genuine_cues.portraits),
            reEncodings: cueDistributions(parsed.genuine_cues.re_encodings),
            synthetic: syntheticScales(
              parsed.genuine_cues.portraits,
              parsed.genuine_cues.re_encodings,
            ),
          },
  };
}

function cueDistributions(
  lists: Readonly<Record<string, readonly number[]>>,
): Record<string, CueDistribution> {
  return Object.fromEntries(
    Object.entries(lists).flatMap(([name, values]) => {
      const distribution = cueDistributionOf(values);
      return distribution === null ? [] : [[name, distribution]];
    }),
  );
}

/**
 * FRR before and after the review at each threshold (the FAR 1e-3 point, then the shared 1:1
 * default), bootstrapped over the same identities with the same seed.
 */
function reviewOf(
  parsed: SelfieCalibrationMeasurements,
  data: Scored,
  thresholds: readonly [number, number],
  bootstrap: { seed: number; replicates: number },
): ReviewSummary {
  const review = parsed.review ?? { excluded_images: 0, genuine_pairs_before: [] };
  const after = parsed.pairs.filter((pair) => pair.genuine);
  const universe = [
    ...new Set([...data.identities, ...review.genuine_pairs_before.map((p) => identityOf(p.a))]),
  ].sort();
  const index = new Map(universe.map((identity, position) => [identity, position]));
  const sets = {
    before: genuineSet(review.genuine_pairs_before, index),
    after: genuineSet(after, index),
  };
  const labels = ['threshold for FAR 1e-3', 'shared 1:1 face-match threshold'];
  const draws = thresholds.map(() => ({ before: [] as number[], after: [] as number[] }));
  const next = random(bootstrap.seed);
  const counts = new Float64Array(universe.length);
  for (let replicate = 0; replicate < bootstrap.replicates; replicate += 1) {
    counts.fill(0);
    universe.forEach(() => {
      const identity = Math.floor(next() * universe.length);
      counts[identity] = (counts[identity] ?? 0) + 1;
    });
    thresholds.forEach((threshold, position) => {
      draws[position]?.before.push(frrOf(sets.before, counts, threshold));
      draws[position]?.after.push(frrOf(sets.after, counts, threshold));
    });
  }
  const ones = new Float64Array(universe.length).fill(1);
  return {
    excludedImages: review.excluded_images,
    genuinePairsBefore: review.genuine_pairs_before.length,
    genuinePairsAfter: after.length,
    removedPairs: review.genuine_pairs_before.length - after.length,
    rows: thresholds.map((threshold, position) => ({
      label: labels[position] ?? '',
      threshold,
      before: interval(frrOf(sets.before, ones, threshold), draws[position]?.before ?? []),
      after: interval(frrOf(sets.after, ones, threshold), draws[position]?.after ?? []),
    })),
  };
}

/** A rate for the report: four decimals, or two significant digits in scientific notation. */
function rate(value: number): string {
  if (value === 0) {
    return '0';
  }
  return value >= 0.01 ? String(round4(value)) : value.toExponential(2);
}

const estimate = ({ value, low, high }: RateEstimate) =>
  `${rate(value)} (${rate(low)} to ${rate(high)})`;
const thousands = (value: number) => value.toLocaleString('en-US');
const counted = (value: number, singular: string, plural: string) =>
  `${thousands(value)} ${value === 1 ? singular : plural}`;
const table = (header: readonly string[], rows: readonly (readonly string[])[]) =>
  [
    `| ${header.join(' | ')} |`,
    `|${header.map(() => '---').join('|')}|`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
const distributionRow = (label: string, distribution: Distribution | null) =>
  distribution === null
    ? [label, '0', '-', '-', '-', '-', '-']
    : [
        label,
        String(distribution.n),
        String(distribution.min),
        String(distribution.p5),
        String(distribution.median),
        String(distribution.p95),
        String(distribution.max),
      ];
const DISTRIBUTION_HEADER = ['Measure', 'n', 'min', 'p5', 'median', 'p95', 'max'];

const CUE_HEADER = ['Cue', 'n', 'min', 'p1', 'p5', 'median', 'p95', 'p99', 'max'];
const cueRow = (label: string, d: CueDistribution) =>
  [label, d.n, d.min, d.p1, d.p5, d.median, d.p95, d.p99, d.max].map(String);
const cueRows = (cues: Readonly<Record<string, CueDistribution>>) =>
  Object.entries(cues).map(([name, distribution]) => cueRow(name, distribution));
const PORTRAIT_DOMAIN =
  'Domain: studio portraits, scaled to a 2,000-px long side: a false-positive proxy, not a selfie measurement.';
const RE_ENCODING_DOMAIN =
  "Domain: the 45 re-encodings of the three public-domain test faces (vision-integrity's 4A stability set: 1,280, 960 and 640 px; q95, q85, q75, resized 0.83 then q85, q75 then q90): a false-positive proxy, not a selfie measurement.";

/** Where a threshold lies against an interval, in words. */
function placed(value: number, low: number, high: number): string {
  if (value < low) {
    return 'below';
  }
  return value > high ? 'above' : 'inside';
}

function reviewLines(report: SelfieCalibrationReport, domain: string, frrFloor: string): string[] {
  const { review } = report;
  if (review === null) {
    return [
      '## The review',
      '',
      'FRR before the review cannot be computed: these measurements carry no review section.',
      '',
    ];
  }
  return [
    '## The review',
    '',
    `The lowest genuine pairs and the highest impostor pairs were reviewed once, shown without scores, and decided from Commons metadata only (C49.1): an image is excluded only when its metadata shows another person or a misattribution, never for a low score or a look. The decisions are pinned in the manifest. ${counted(review.excludedImages, 'image', 'images')} excluded by the review; ${thousands(review.genuinePairsBefore)} genuine pairs before the review, ${thousands(review.genuinePairsAfter)} after: ${thousands(review.removedPairs)} removed.`,
    '',
    domain,
    '',
    table(
      ['Threshold', 'Value', 'FRR before the review', 'FRR after the review', 'FRR floor'],
      review.rows.map((row) => [
        row.label,
        String(row.threshold),
        estimate(row.before),
        estimate(row.after),
        frrFloor,
      ]),
    ),
    '',
  ];
}

function sharedThresholdLines(report: SelfieCalibrationReport, domain: string): string[] {
  const point = report.operatingPoints[0];
  const shared = report.thresholds.find((row) => row.label.startsWith('shared'));
  if (point === undefined || shared === undefined) {
    return [];
  }
  const where = placed(shared.threshold, point.thresholdInterval.low, point.thresholdInterval.high);
  const repeat = report.thresholds.find((row) => row.label.startsWith('selfie_repeat'));
  return [
    '## The shared 1:1 threshold (C49.3)',
    '',
    domain,
    '',
    `- The default is ${String(shared.threshold)} (${FACE_MATCH_DEFAULTS.basis}): ${FACE_MATCH_DEFAULTS.source}.`,
    `- It lies ${where} the 95% interval of the threshold for FAR 1e-3 (${rate4(point.thresholdInterval.low)} to ${rate4(point.thresholdInterval.high)}; point ${String(point.threshold)}). At it, FAR ${estimate(shared.far)} and FRR ${estimate(shared.frr)}.`,
    `- The default moves only with a documented margin (C49.3); \`docs/checks/selfie.md\` records the decision beside these numbers.`,
    ...(repeat === undefined
      ? []
      : [
          `- The 1:N floor is the 1:1 threshold at FAR 1e-3 (${String(point.threshold)}): \`selfie_repeat_detection\`'s default ${String(repeat.threshold)} is ${repeat.threshold >= point.threshold ? 'at or above' : 'below'} it, and stays provisional and gallery-size dependent.`,
        ]),
    '',
  ];
}

/** The listed percentiles of a cue, lowest first: key and level. */
const PERCENTILES = [
  ['p1', 1],
  ['p5', 5],
  ['median', 50],
  ['p95', 95],
  ['p99', 99],
] as const;

const share = (count: number, n: number) => `${String(Math.round((10_000 * count) / n) / 100)}%`;

/**
 * Workflow 4B review H003: what the default `min-passive-score` rejects of the genuine portraits,
 * bounded from the listed percentiles alone. A linear-interpolated percentile `q` below the
 * default puts at least `floor(q (n - 1) / 100) + 1` values below it; a p1 at or above it leaves
 * at most `ceil((n - 1) / 100)` below.
 */
export function passiveRejectionLine(
  distribution: CueDistribution,
  minPassiveScore: number,
): string {
  const { n } = distribution;
  const below = PERCENTILES.filter(([key]) => distribution[key] < minPassiveScore).at(-1);
  const of = (count: number, verb: string) =>
    `${thousands(count)} of them (${share(count, n)}) ${count === 1 ? `${verb}s` : verb}`;
  let bound: string;
  if (distribution.max < minPassiveScore) {
    bound = `all ${thousands(n)} of them score`;
  } else if (below !== undefined) {
    bound = `at least ${of(Math.floor((below[1] * (n - 1)) / 100) + 1, 'score')}`;
  } else if (distribution.min < minPassiveScore) {
    bound = `at most ${of(Math.ceil((n - 1) / 100), 'score')}`;
  } else {
    bound = 'none of them scores';
  }
  return [
    `\`selfie_liveness_detection\` fails a centre whose passive-liveness mean is below \`min-passive-score\` (default ${String(minPassiveScore)}, provisional) with \`passive_liveness_low\`, a fraud reason that gives no retry.`,
    `On these genuine portraits (n = ${thousands(n)}) the p1 is ${String(distribution.p1)} and the p5 ${String(distribution.p5)}: ${bound} below the default.`,
    'Studio portraits are still and often retouched, so this is a false-positive proxy: the false-reject rate on genuine webcam selfies is unmeasured.',
  ].join(' ');
}

function genuineCueLines(report: SelfieCalibrationReport): string[] {
  const cues = report.genuineCues;
  if (cues === null) {
    return [];
  }
  const passive = cues.portraits.passive_liveness_mean;
  const passiveLines =
    passive === undefined
      ? []
      : [
          passiveRejectionLine(
            passive,
            Number(selfieConfigDefaults('selfie_liveness_detection')['min-passive-score']),
          ),
          '',
        ];
  const scaleRows = cues.synthetic.map((row) => [
    row.key,
    String(row.n),
    row.genuineTail === null ? '-' : `${String(row.genuineTail)} (${row.tailRule})`,
    String(row.clear),
    String(row.suspicious),
    String(row.weight),
    row.genuineTail === null ? 'unmeasured' : row.flagsGenuine ? 'yes' : 'no',
  ]);
  return [
    '## Genuine portraits: the heuristic cues',
    '',
    'What the heuristic checks read on genuine photos: the passive-liveness mean (`selfie_liveness_detection`), the covering score where the forehead reference is valid (`selfie_face_covering_detection`), the glasses score (`selfie_glasses_detection`) and every synthetic cue (`selfie_suspicious_entity_detection`). Studio portraits are not selfies: these numbers bound false positives on clean, well-lit photos only.',
    '',
    PORTRAIT_DOMAIN,
    '',
    Object.keys(cues.portraits).length === 0
      ? 'No cue was measured.'
      : table(CUE_HEADER, cueRows(cues.portraits)),
    '',
    ...passiveLines,
    RE_ENCODING_DOMAIN,
    '',
    Object.keys(cues.reEncodings).length === 0
      ? 'No cue was measured.'
      : table(CUE_HEADER, cueRows(cues.reEncodings)),
    '',
    '## The synthetic-face scales against genuine photos',
    '',
    `A cue flags genuine photos when its clear level leaves the genuine tail with a suspicion above 0. The tail is the 99th percentile (the 1st for a cue that is suspicious when small), or the maximum (minimum) with fewer than ${String(GENUINE_TAIL_MIN_VALUES)} values. The scales stay provisional: a genuine-only distribution; detection rate unmeasured.`,
    '',
    'Domain: studio portraits (2,000 px) and the 45 re-encodings together: genuine-only distribution; detection rate unmeasured.',
    '',
    table(
      ['Cue', 'n', 'Genuine tail', 'Clear at', 'Suspicious at', 'Weight', 'Flags genuine photos'],
      scaleRows,
    ),
    '',
  ];
}

const rate4 = (value: number) => String(round4(value));

export function renderSelfieCalibrationMarkdown(report: SelfieCalibrationReport): string {
  const domain = `Domain: ${report.domain}.`;
  const { counts, ruleOfThree } = report;
  const frrFloor = `rule-of-three FRR floor 3 / ${thousands(counts.genuinePairs)} = ${rate(ruleOfThree.frr)}`;
  const excluded = Object.entries(report.set.excluded);
  const pointRows = report.operatingPoints.map((point) => {
    const target = point.targetFar.toExponential(0);
    if (!point.resolvable && point.targetFar < 1e-3) {
      return [
        target,
        '-',
        `not resolvable at this size (FAR upper bound ${rate(point.far.high)}, not below ${rate(3 * point.targetFar)})`,
        '-',
        frrFloor,
      ];
    }
    return [
      target,
      `${String(point.threshold)} (${rate4(point.thresholdInterval.low)} to ${rate4(point.thresholdInterval.high)})`,
      `${estimate(point.far)}${point.resolvable ? '' : '; not resolvable at this size'}`,
      estimate(point.frr),
      frrFloor,
    ];
  });
  const basisOf = (label: string) => {
    if (label.startsWith('shared')) {
      return FACE_MATCH_DEFAULTS.basis;
    }
    if (label === SFACE_LABEL) {
      return 'upstream';
    }
    return label.startsWith('selfie_repeat') ? 'provisional' : 'measured here';
  };
  const galleryRows = report.thresholds
    .filter((row) => row.label !== SFACE_LABEL)
    .map((row) => [
      `${row.label} (${String(row.threshold)})`,
      ...report.gallery
        .filter((entry) => entry.label === row.label)
        .map(
          (entry) =>
            `${entry.expectedFalseMatches.toFixed(2)} (up to ${entry.upperFalseMatches.toFixed(2)})`,
        ),
    ]);
  const provisionalRows = Object.entries(report.provisional).map(([name, distribution]) =>
    distributionRow(name, distribution),
  );
  const lines = [
    '# Face-match calibration (Phase 4, C49)',
    '',
    `Written by \`packages/checks/scripts/calibration-report.ts --selfie\` from ${report.source ?? 'the calibration measurements'} (measured ${report.generatedAt}; models ${report.models.detector} and ${report.models.recognizer}). Intervals are two-sided 95% bootstraps over identities: ${thousands(report.replicates)} replicates, seed ${String(report.seed)}. An identity drawn twice is never compared with itself as an impostor, and every FAR upper bound is at least the rule-of-three bound.`,
    '',
    `**${domain}** Every number below holds for this domain only: it is not a selfie compared with an ID card photo, whose error rates are higher and unmeasured here.`,
    '',
    '## Set',
    '',
    `- ${counted(counts.identities, 'identity', 'identities')}, ${counted(counts.genuinePairs, 'genuine pair', 'genuine pairs')} and ${counted(counts.impostorPairs, 'impostor pair', 'impostor pairs')} (${thousands(report.set.identities)} identities and ${thousands(report.set.images)} images kept). Impostor pairs take the first kept image of each identity against the first of every other.`,
    `- Excluded before scoring: ${excluded.length === 0 ? 'none' : excluded.map(([reason, count]) => `${reason} ${String(count)}`).join(', ')}. Near-duplicates (an SFace cosine above 0.93 or an aligned-crop pixel correlation above 0.95 to an earlier kept photo of the same identity) were fixed as a rule before any score was seen.`,
    `- The ${frrFloor}: no FRR below it can be told apart from zero errors. The FAR floor is 3 / ${thousands(counts.impostorPairs)} = ${rate(ruleOfThree.far)}.`,
    '',
    ...reviewLines(report, domain, frrFloor),
    '## FRR at a target FAR',
    '',
    domain,
    '',
    table(
      [
        'Target FAR',
        'Threshold (95% interval)',
        'FAR (95% interval)',
        'FRR (95% interval)',
        'FRR floor',
      ],
      pointRows,
    ),
    '',
    '## FAR and FRR at the configured thresholds',
    '',
    domain,
    '',
    table(
      ['Threshold', 'Value', 'Basis', 'FAR (95% interval)', 'FRR (95% interval)', 'FRR floor'],
      report.thresholds.map((row) => [
        row.label,
        String(row.threshold),
        basisOf(row.label),
        estimate(row.far),
        estimate(row.frr),
        frrFloor,
      ]),
    ),
    '',
    ...sharedThresholdLines(report, domain),
    '## 1:N search: expected false matches per search',
    '',
    `${domain} One search over a gallery of N templates expects N x FAR false matches; the bracket uses the FAR interval's upper bound. False matches grow with the gallery, which is why \`selfie_repeat_detection\` is advisory by default and its threshold stays gallery-size dependent.`,
    '',
    table(
      ['Threshold', ...SELFIE_CALIBRATION_GALLERY_SIZES.map((size) => `N = ${thousands(size)}`)],
      galleryRows,
    ),
    '',
    '## Skew',
    '',
    domain,
    '',
    table(DISTRIBUTION_HEADER, [
      distributionRow(
        'Age gap between the photos of a genuine pair (years)',
        report.skew.ageGapYears,
      ),
      distributionRow(
        'ITA angle of face skin pixels (degrees), a proxy for skin tone stated as one',
        report.skew.itaDegrees,
      ),
    ]),
    '',
    `Sex: ${
      Object.entries(report.skew.sex)
        .map(([sex, count]) => `${sex} ${String(count)}`)
        .join(', ') || 'not recorded'
    }. The set is official portraits of adults, so its spread of age, skin tone and capture conditions is narrow; per-group FRR is unmeasured. The age gap counts the genuine pairs whose two photos both have a year in their file metadata; the ITA angle is the median per identity of the cheeks' colour, none for a black-and-white photo.`,
    '',
    ...genuineCueLines(report),
    '## Provisional distributions (synthetic fixtures)',
    '',
    'Domain: synthetic pipeline fixtures (re-posed head turns, simulated screen, print and composite spoofs, drawn coverings and glasses).',
    '',
    provisionalRows.length === 0
      ? 'No distribution was measured.'
      : table(DISTRIBUTION_HEADER, provisionalRows),
    '',
    'These are provisional: they describe the pipeline on synthetic fixtures, not real users or real attacks. Simulated spoofs do not measure APCER or BPCER, so no liveness, pose, covering or glasses threshold is calibrated by them.',
    '',
    '## Purpose and lawful basis',
    '',
    'Purpose: measuring the false-match and false-non-match rates of the face-match threshold OpenVerify ships, so the threshold and its error rates can be stated. The portraits are official portraits that U.S. federal agencies released into the public domain; they are still biometric data of identifiable people. Embeddings and face crops are computed in memory and never written to disk; the measurements carry pseudonymous ids and scores, and this report aggregate numbers only (no name, no per-person row, no image). Whoever runs the calibration states their own lawful basis for this processing (for example a legitimate interest in the accuracy of an identity-verification service); this report is not legal advice.',
    '',
    '## Takedown',
    '',
    'To remove a person from the set, delete their identity from `fixtures/calibration-manifest.json` (find it by the file URL) and their files from `fixtures/faces/calibration/`, re-run the calibration and this report, and commit both. Nothing else holds their images or embeddings: the images are fetched on demand and never committed. Removal requests: open an issue in the project repository.',
    '',
  ];
  return lines.join('\n');
}
