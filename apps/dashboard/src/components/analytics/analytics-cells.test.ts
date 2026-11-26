import { ANALYTICS_METRICS } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  chartPoint,
  countWords,
  durationWords,
  isSuppressed,
  metricLabel,
  metricOf,
  rateTermsWords,
  rateWords,
  shownCount,
} from './analytics-cells';

describe('cells in words (C164.7, B15)', () => {
  it('reads a count as shown, fewer than the threshold, hidden or not counted', () => {
    expect(countWords(12_345, 11)).toBe('12,345');
    expect(countWords(0, 11)).toBe('0');
    expect(countWords({ suppressed: 'small-count' }, 15)).toBe('fewer than 15');
    expect(countWords({ suppressed: 'complementary' }, 11)).toBe('hidden');
    expect(countWords(undefined, 11)).toBe('not counted');
    expect(shownCount(5)).toBe(5);
    expect(shownCount({ suppressed: 'complementary' })).toBeNull();
    expect(isSuppressed({ suppressed: 'small-count' })).toBe(true);
    expect(isSuppressed(0)).toBe(false);
  });

  it('reads a rate as a percent, a strict bound, or not shown', () => {
    expect(rateWords({ value: 20 / 24 })).toBe('83.3%');
    expect(rateWords({ value: 1 })).toBe('100%');
    expect(rateWords({ below: 42 })).toBe('under 42%');
    expect(rateWords({ above: 70 })).toBe('over 70%');
    expect(rateWords({ suppressed: true })).toBe('not shown (too few)');
    expect(rateWords(undefined)).toBe('not defined');
  });

  it('reads a duration as its bucket’s bounds, always approximate', () => {
    expect(durationWords({ lower: 240, upper: 360 })).toBe('between 4 and 6 minutes (approximate)');
    expect(durationWords({ lower: 3600, upper: 5400 })).toBe(
      'between 60 and 90 minutes (approximate)',
    );
    expect(durationWords({ lower: 2.1, upper: 3.4 })).toBe('between 2 and 4 seconds (approximate)');
    expect(durationWords({ lower: 200_000, upper: 300_000 })).toBe(
      'between 2 and 4 days (approximate)',
    );
    expect(durationWords({ suppressed: true })).toBe('not shown (too few)');
    expect(durationWords(null)).toBe('none counted');
  });

  it('labels a metric by its key and names a rate’s terms from the definitions', () => {
    expect(metricLabel('expired-after-start')).toBe('Expired after start');
    expect(metricLabel('sla-met')).toBe('SLA met');
    const success = metricOf('inquiries', 'success-rate');
    expect(success?.definition).toBe(
      ANALYTICS_METRICS.find((metric) => metric.key === 'success-rate')?.definition,
    );
    if (success === undefined) {
      throw new Error('success-rate is defined');
    }
    expect(rateTermsWords(success)).toBe(
      'completed + approved over finished, counted in inquiries',
    );
    const perPerson = metricOf('verifications', 'pass-rate-per-person');
    expect(perPerson && rateTermsWords(perPerson)).toBe(
      'step passed over step entered, counted in people and steps',
    );
    expect(metricOf('cases', 'no-such-metric')).toBeUndefined();
  });

  it('makes a chart point that draws only a shown count', () => {
    expect(chartPoint('2026-10-01', 25, 11)).toEqual({
      label: '2026-10-01',
      value: 25,
      words: '25',
      suppressed: false,
    });
    expect(chartPoint('2026-10-02', { suppressed: 'small-count' }, 11)).toEqual({
      label: '2026-10-02',
      value: null,
      words: 'fewer than 11',
      suppressed: true,
    });
    expect(chartPoint('a check', 4, 11, 'not run')).toEqual({
      label: 'a check',
      value: null,
      words: 'not run',
      suppressed: false,
    });
  });
});
