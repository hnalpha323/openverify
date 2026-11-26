/**
 * C163.5 (Phase 9, Workflow 9B; `analytics-logic` builds it in Stage 2): durations are counted in
 * 40 log-spaced buckets from 1 second to 30 days, and medians and percentiles are reported as their
 * bucket's bounds ("between 4 and 6 minutes"), labelled approximate. The constants are frozen by
 * `contracts-9b` (the rollups' histograms have `DURATION_BUCKET_COUNT` entries).
 *
 * The edges (ours, provisional; basis: C163.5's "40 log-spaced buckets from 1 s to 30 days", tuned
 * on nothing): edge `k` is `DURATION_MIN_SECONDS · (DURATION_MAX_SECONDS / DURATION_MIN_SECONDS)^(k/40)`
 * for `k` from 0 to 40, so each bucket is about 1.447 times as wide as the one before; bucket `i`
 * runs from edge `i` (included) to edge `i + 1` (excluded), except that the first one starts at 0, so
 * a sub-second duration is counted, and the last one also holds 30 days and anything longer. A
 * rollup that buckets in SQL passes `durationBuckets().map((bucket) => bucket.lower)` to
 * `width_bucket(seconds, lowers)` and subtracts 1, which gives `durationBucketOf` exactly, since both
 * read the same doubles.
 */
import { AnalyticsInputError, assertCount } from './errors.js';

export const DURATION_BUCKET_COUNT = 40;
export const DURATION_MIN_SECONDS = 1;
/** 30 days. */
export const DURATION_MAX_SECONDS = 2_592_000;

/** One bucket's bounds in seconds: `lower` included, `upper` excluded (the last one included). */
export interface DurationBucket {
  readonly lower: number;
  readonly upper: number;
}

const EDGES: readonly number[] = Array.from({ length: DURATION_BUCKET_COUNT + 1 }, (_, k) =>
  k === DURATION_BUCKET_COUNT
    ? DURATION_MAX_SECONDS
    : DURATION_MIN_SECONDS *
      Math.pow(DURATION_MAX_SECONDS / DURATION_MIN_SECONDS, k / DURATION_BUCKET_COUNT),
);

const BUCKETS: readonly DurationBucket[] = Object.freeze(
  Array.from({ length: DURATION_BUCKET_COUNT }, (_, index) =>
    Object.freeze({ lower: index === 0 ? 0 : (EDGES[index] ?? 0), upper: EDGES[index + 1] ?? 0 }),
  ),
);

/** The `DURATION_BUCKET_COUNT` buckets, in order, covering 0 to `DURATION_MAX_SECONDS`. */
export function durationBuckets(): readonly DurationBucket[] {
  return BUCKETS;
}

/** The index of the bucket that holds `seconds` (past the last bucket: the last one). */
export function durationBucketOf(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new AnalyticsInputError('a duration must be a finite number of seconds of at least 0');
  }
  // The last bucket whose lower bound is at most `seconds` (a binary search over the same doubles
  // `durationBuckets` answers, so the two never disagree at an edge).
  let low = 0;
  let high = DURATION_BUCKET_COUNT - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((BUCKETS[middle]?.lower ?? Number.POSITIVE_INFINITY) <= seconds) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}

/**
 * The bucket that holds the `percentile` (in (0, 100)) of `histogram`, or `null` when it is empty.
 * The nearest-rank definition (ours; no interpolation, because the answer is a bucket's bounds): the
 * smallest bucket whose running count reaches `ceil(percentile / 100 · n)`.
 */
export function durationPercentile(
  histogram: readonly number[],
  percentile: number,
): DurationBucket | null {
  if (histogram.length !== DURATION_BUCKET_COUNT) {
    throw new AnalyticsInputError(
      `a duration histogram has ${String(DURATION_BUCKET_COUNT)} buckets`,
    );
  }
  if (!(percentile > 0 && percentile < 100)) {
    throw new AnalyticsInputError('a percentile lies strictly between 0 and 100');
  }
  const total = histogram.reduce(
    (sum, count, index) => sum + assertCount(count, `duration bucket ${String(index)}`),
    0,
  );
  if (total === 0) {
    return null;
  }
  const rank = Math.ceil((percentile / 100) * total);
  let running = 0;
  // `rank` is at most `total`, since the percentile is below 100, so a bucket is always found.
  const index = histogram.findIndex((count) => {
    running += count;
    return running >= rank;
  });
  return BUCKETS[index] ?? null;
}
