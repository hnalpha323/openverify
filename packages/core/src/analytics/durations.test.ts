/**
 * C163.5 (Phase 9, Workflow 9B; `analytics-logic`): the 40 log-spaced duration buckets from 1 s to
 * 30 days, and percentiles reported as the bounds of the bucket that holds them (approximate).
 */
import { describe, expect, it } from 'vitest';
import {
  DURATION_BUCKET_COUNT,
  DURATION_MAX_SECONDS,
  DURATION_MIN_SECONDS,
  durationBucketOf,
  durationBuckets,
  durationPercentile,
} from './durations.js';

const histogramWith = (entries: Readonly<Record<number, number>>): number[] =>
  Array.from({ length: DURATION_BUCKET_COUNT }, (_, index) => entries[index] ?? 0);

describe('durationBuckets (C163.5)', () => {
  it('lists 40 contiguous buckets covering 0 to 30 days', () => {
    const buckets = durationBuckets();
    expect(buckets).toHaveLength(40);
    expect(buckets[0]?.lower).toBe(0);
    expect(buckets[39]?.upper).toBe(DURATION_MAX_SECONDS);
    for (let index = 1; index < buckets.length; index += 1) {
      expect(buckets[index]?.lower).toBe(buckets[index - 1]?.upper);
    }
  });

  it('spaces the edges evenly in log space from 1 second, the first bucket holding 0 to it', () => {
    const buckets = durationBuckets();
    const step = Math.log(DURATION_MAX_SECONDS / DURATION_MIN_SECONDS) / DURATION_BUCKET_COUNT;
    expect(buckets[1]?.lower).toBeCloseTo(Math.exp(step), 12);
    for (let index = 1; index < 39; index += 1) {
      const bucket = buckets[index];
      expect(Math.log((bucket?.upper ?? 0) / (bucket?.lower ?? 1))).toBeCloseTo(step, 12);
    }
    expect(buckets[0]?.upper).toBeCloseTo(DURATION_MIN_SECONDS * Math.exp(step), 12);
  });

  it('puts five minutes between about 4 and 6 minutes, as the plan reads it', () => {
    const bucket = durationBuckets()[durationBucketOf(300)];
    expect(bucket?.lower).toBeGreaterThan(4 * 60);
    expect(bucket?.upper).toBeLessThan(6.2 * 60);
  });

  it('answers the same frozen list every time', () => {
    expect(durationBuckets()).toBe(durationBuckets());
    expect(Object.isFrozen(durationBuckets())).toBe(true);
  });
});

describe('durationBucketOf (C163.5)', () => {
  it('counts every bucket from its lower bound, included, to its upper bound, excluded', () => {
    durationBuckets().forEach((bucket, index) => {
      expect(durationBucketOf(bucket.lower)).toBe(index);
      if (index < 39) {
        expect(durationBucketOf(bucket.upper)).toBe(index + 1);
      }
    });
  });

  it('holds sub-second durations in the first bucket, and 30 days and beyond in the last', () => {
    expect(durationBucketOf(0)).toBe(0);
    expect(durationBucketOf(0.4)).toBe(0);
    expect(durationBucketOf(1)).toBe(0);
    expect(durationBucketOf(DURATION_MAX_SECONDS)).toBe(39);
    expect(durationBucketOf(DURATION_MAX_SECONDS * 10)).toBe(39);
  });

  it('agrees with the bucket bounds on 2,000 seeded durations', () => {
    let state = 0x9e3779b9;
    for (let draw = 0; draw < 2000; draw += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const seconds = Math.exp((state / 2 ** 32) * Math.log(DURATION_MAX_SECONDS * 2)) - 1;
      const bucket = durationBuckets()[durationBucketOf(seconds)];
      expect(seconds).toBeGreaterThanOrEqual(bucket?.lower ?? Number.NaN);
      if (seconds < DURATION_MAX_SECONDS) {
        expect(seconds).toBeLessThan(bucket?.upper ?? Number.NaN);
      }
    }
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('refuses %s seconds', (seconds) => {
    expect(() => durationBucketOf(seconds)).toThrow(RangeError);
  });
});

describe('durationPercentile (C163.5)', () => {
  it('answers null for an empty histogram, so nothing counted is never shown as a duration', () => {
    expect(durationPercentile(histogramWith({}), 50)).toBeNull();
  });

  it('answers the bucket of the nearest rank: the smallest bucket holding ceil(p% of n) values', () => {
    // 10 values: 3 in bucket 5, 4 in bucket 10, 3 in bucket 20.
    const histogram = histogramWith({ 5: 3, 10: 4, 20: 3 });
    const buckets = durationBuckets();
    expect(durationPercentile(histogram, 30)).toEqual(buckets[5]);
    expect(durationPercentile(histogram, 31)).toEqual(buckets[10]);
    expect(durationPercentile(histogram, 50)).toEqual(buckets[10]);
    expect(durationPercentile(histogram, 70)).toEqual(buckets[10]);
    expect(durationPercentile(histogram, 71)).toEqual(buckets[20]);
    expect(durationPercentile(histogram, 90)).toEqual(buckets[20]);
    expect(durationPercentile(histogram, 0.01)).toEqual(buckets[5]);
    expect(durationPercentile(histogram, 99.99)).toEqual(buckets[20]);
  });

  it('holds the true percentile of seeded durations inside the bucket it answers', () => {
    let state = 12345;
    const values: number[] = [];
    for (let draw = 0; draw < 501; draw += 1) {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      values.push(Math.round((state / 2 ** 32) * 86_400));
    }
    const histogram = histogramWith({});
    for (const value of values) {
      histogram[durationBucketOf(value)] = (histogram[durationBucketOf(value)] ?? 0) + 1;
    }
    const sorted = [...values].sort((left, right) => left - right);
    for (const percentile of [10, 25, 50, 75, 90, 99]) {
      const rank = Math.ceil((percentile / 100) * sorted.length);
      const truth = sorted[rank - 1] ?? Number.NaN;
      const bucket = durationPercentile(histogram, percentile);
      expect(truth).toBeGreaterThanOrEqual(bucket?.lower ?? Number.NaN);
      expect(truth).toBeLessThan(bucket?.upper ?? Number.NaN);
    }
  });

  it.each([0, 100, -5, 150, Number.NaN])('refuses the percentile %s', (percentile) => {
    expect(() => durationPercentile(histogramWith({ 3: 1 }), percentile)).toThrow(RangeError);
  });

  it('refuses a histogram of the wrong length or with a count that is not a whole number', () => {
    expect(() => durationPercentile([1, 2, 3], 50)).toThrow(RangeError);
    expect(() => durationPercentile(histogramWith({ 2: -1 }), 50)).toThrow(RangeError);
    expect(() => durationPercentile(histogramWith({ 2: 1.5 }), 50)).toThrow(RangeError);
  });
});
