/**
 * The tables of the Analytics section (C164.9): the default view for keyboard and screen-reader
 * users, beside every chart. Each cell is the answer's own, in words (`analytics-cells.ts`); a live
 * day shows only what the API serves live, a bucket before the first step record "no step data",
 * and a period of a mixed range names the zone it was counted in.
 */
import type { AnalyticsReport } from '@openverify/core';
import type { ReactNode } from 'react';
import { ANALYTICS_COPY, fillCopy } from '../../lib/copy/analytics';
import { DataTable } from '../data-table';
import {
  countWords,
  durationWords,
  metricLabel,
  metricOf,
  rateTermsWords,
  rateWords,
  type CountCell,
  type DurationCell,
  type RateCell,
} from './analytics-cells';

const TABLES = ANALYTICS_COPY.tables;

export interface BucketRow {
  readonly start: string;
  readonly end: string;
  readonly 'time-zone': string;
  readonly live: boolean;
  readonly 'step-data'?: boolean;
  readonly counts?: Readonly<Record<string, CountCell | undefined>>;
}

/** A bucket's period: one day, or its first and last day, marked live, zone named when mixed. */
export function periodWords(bucket: BucketRow, mixed: boolean): string {
  const days = bucket.start === bucket.end ? bucket.start : `${bucket.start} to ${bucket.end}`;
  return [
    days,
    ...(bucket.live ? [TABLES.liveMark] : []),
    ...(mixed ? [fillCopy(TABLES.zoneMark, { zone: bucket['time-zone'] })] : []),
  ].join(' ');
}

export interface BucketTableProps {
  readonly caption: string;
  readonly buckets: readonly BucketRow[];
  readonly keys: readonly string[];
  readonly threshold: number;
  /** The range mixes time zones (C163.2). */
  readonly mixed: boolean;
}

/** One row per bucket, one column per count. */
export function BucketTable({ caption, buckets, keys, threshold, mixed }: BucketTableProps) {
  const cellOf = (bucket: BucketRow, key: string): string => {
    if (bucket['step-data'] === false) {
      return ANALYTICS_COPY.cells.noStepData;
    }
    const cell = bucket.counts?.[key];
    return cell === undefined && bucket.live
      ? ANALYTICS_COPY.cells.notLive
      : countWords(cell, threshold);
  };
  return (
    <DataTable
      caption={caption}
      rows={buckets}
      getRowKey={(bucket) => `${bucket.start}-${bucket['time-zone']}`}
      emptyMessage={ANALYTICS_COPY.chart.noData}
      columns={[
        {
          id: 'period',
          header: TABLES.period,
          rowHeader: true,
          cell: (bucket) => periodWords(bucket, mixed),
        },
        ...keys.map((key) => ({
          id: key,
          header: metricLabel(key),
          cell: (bucket: BucketRow) => cellOf(bucket, key),
        })),
      ]}
    />
  );
}

export interface MetricRow {
  readonly key: string;
  readonly value: ReactNode;
}

export interface MetricTableProps {
  readonly caption: string;
  readonly report: AnalyticsReport;
  readonly counts?: Readonly<Record<string, CountCell | undefined>>;
  readonly rates?: Readonly<Record<string, RateCell | undefined>>;
  readonly durations?: Readonly<Record<string, DurationCell | undefined>>;
  readonly threshold: number;
}

/** One row per figure: its value and what it counts (a rate's numerator, denominator and unit). */
export function MetricTable({
  caption,
  report,
  counts = {},
  rates = {},
  durations = {},
  threshold,
}: MetricTableProps) {
  const rows: MetricRow[] = [
    ...Object.entries(counts).map(([key, cell]) => ({ key, value: countWords(cell, threshold) })),
    ...Object.entries(rates).map(([key, cell]) => ({ key, value: rateWords(cell) })),
    ...Object.entries(durations).map(([key, cell]) => ({ key, value: durationWords(cell) })),
  ];
  return (
    <DataTable
      caption={caption}
      rows={rows}
      getRowKey={(row) => row.key}
      emptyMessage={ANALYTICS_COPY.chart.noData}
      columns={[
        {
          id: 'metric',
          header: TABLES.metric,
          rowHeader: true,
          cell: (row) => metricLabel(row.key),
        },
        { id: 'value', header: TABLES.value, cell: (row) => row.value },
        {
          id: 'meaning',
          header: TABLES.meaning,
          cell: (row) => {
            const metric = metricOf(report, row.key);
            if (metric === undefined) {
              return '';
            }
            return metric.kind === 'rate'
              ? `${metric.definition} (${rateTermsWords(metric)}.)`
              : metric.definition;
          },
        },
      ]}
    />
  );
}
