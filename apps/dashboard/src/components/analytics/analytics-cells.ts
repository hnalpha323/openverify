/**
 * The cells of an analytics answer in words (C164.7, B15), the same in the tables, the chart labels
 * and the captions, so no view says more than the suppressed answer: a small count reads "fewer than
 * <threshold>", a complementary one "hidden" (its value may be large), a rate's bound "under X%" or
 * "over Y%", a duration the bounds of its bucket, labelled approximate.
 */
import type {
  analyticsCountCellSchema,
  analyticsDurationCellSchema,
  analyticsRateCellSchema,
} from '@openverify/contracts';
import { ANALYTICS_METRICS, type AnalyticsMetric, type AnalyticsReport } from '@openverify/core';
import type { z } from 'zod';
import { ANALYTICS_COPY, fillCopy } from '../../lib/copy/analytics';

export type CountCell = z.output<typeof analyticsCountCellSchema>;
export type RateCell = z.output<typeof analyticsRateCellSchema>;
export type DurationCell = z.output<typeof analyticsDurationCellSchema>;

const CELLS = ANALYTICS_COPY.cells;

/** A count in words; `undefined` (a member the answer left out) reads as not counted. */
export function countWords(cell: CountCell | undefined, threshold: number): string {
  if (cell === undefined) {
    return CELLS.notCounted;
  }
  if (typeof cell === 'number') {
    return cell.toLocaleString('en-US');
  }
  return cell.suppressed === 'small-count'
    ? fillCopy(CELLS.fewerThan, { threshold })
    : CELLS.hidden;
}

/** The value a chart may draw: a shown count, else `null` (hidden, or not counted). */
export function shownCount(cell: CountCell | undefined): number | null {
  return typeof cell === 'number' ? cell : null;
}

/** Whether a count is hidden by suppression (as opposed to shown, or not counted). */
export function isSuppressed(cell: CountCell | undefined): boolean {
  return typeof cell === 'object';
}

const percent = (fraction: number) => `${String(Math.round(fraction * 1000) / 10)}%`;

/** A rate in words; `undefined` (a rate the answer does not define) reads as not defined. */
export function rateWords(cell: RateCell | undefined): string {
  if (cell === undefined) {
    return CELLS.notDefined;
  }
  if ('value' in cell) {
    return percent(cell.value);
  }
  if ('below' in cell) {
    return fillCopy(CELLS.under, { value: cell.below });
  }
  if ('above' in cell) {
    return fillCopy(CELLS.over, { value: cell.above });
  }
  return CELLS.rateHidden;
}

const UNITS = [
  { seconds: 86_400, one: 'day', many: 'days' },
  { seconds: 3_600, one: 'hour', many: 'hours' },
  { seconds: 60, one: 'minute', many: 'minutes' },
  { seconds: 1, one: 'second', many: 'seconds' },
] as const;

/** Both bounds in the largest unit the upper bound fills, rounded to whole units (at least 1). */
function boundsWords(lower: number, upper: number): string {
  const unit = UNITS.find((each) => upper >= each.seconds * 2) ?? UNITS[3];
  const low = Math.floor(lower / unit.seconds);
  const high = Math.max(Math.ceil(upper / unit.seconds), low + 1);
  return `${String(low)} and ${String(high)} ${unit.many}`;
}

/** A bucketed duration in words, always labelled approximate (C163.5). */
export function durationWords(cell: DurationCell | undefined): string {
  if (cell === undefined || cell === null) {
    return CELLS.durationNone;
  }
  if ('suppressed' in cell) {
    return CELLS.durationHidden;
  }
  return fillCopy(CELLS.duration, { bounds: boundsWords(cell.lower, cell.upper) });
}

/** The metric `key` of `report`, with its definition, unit and terms (`ANALYTICS_METRICS`). */
export function metricOf(report: AnalyticsReport, key: string): AnalyticsMetric | undefined {
  return ANALYTICS_METRICS.find((metric) => metric.report === report && metric.key === key);
}

const LABEL_WORDS: Readonly<Record<string, string>> = Object.freeze({
  sla: 'SLA',
  p90: '90th percentile',
});

/** A metric key as a label: "expired-after-start" reads "Expired after start". */
export function metricLabel(key: string): string {
  const words = key.split('-').map((word) => LABEL_WORDS[word] ?? word);
  const [head = '', ...rest] = words.join(' ');
  return `${head.toUpperCase()}${rest.join('')}`;
}

/** A rate's terms: "{numerator} over {denominator}, in {unit}". */
export function rateTermsWords(metric: AnalyticsMetric): string {
  const terms = (keys: readonly string[] | undefined) =>
    (keys ?? []).map((key) => metricLabel(key).toLowerCase()).join(' + ');
  return fillCopy(CELLS.rateTerms, {
    numerator: terms(metric.numerator),
    denominator: terms(metric.denominator),
    unit: metric.unit.replace(/-/g, ' '),
  });
}

/** One plotted figure (`ChartPoint` of `analytics-charts.tsx`): a shown count, or its words. */
export function chartPoint(
  label: string,
  cell: CountCell | undefined,
  threshold: number,
  words?: string,
): { label: string; value: number | null; words: string; suppressed: boolean } {
  return {
    label,
    value: words === undefined ? shownCount(cell) : null,
    words: words ?? countWords(cell, threshold),
    suppressed: words === undefined && isSuppressed(cell),
  };
}
