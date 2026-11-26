/**
 * The overview (C164.1, C164.9): inquiries created and started over the periods (a line chart and
 * its table), every count of the window, and the rates, success always split three ways (review
 * H09). Captions and tables come from the suppressed answer only.
 */
import type { AnalyticsDocuments } from '../../lib/api/analytics';
import { ANALYTICS_COPY, fillCopy } from '../../lib/copy/analytics';
import { PageSection } from '../lifecycle/page-section';
import { chartPoint, countWords, rateWords } from './analytics-cells';
import { LineChart } from './analytics-charts';
import { BucketTable, MetricTable, periodWords } from './analytics-tables';

type Answer = AnalyticsDocuments['inquiries'];

/** Every count of the overview's period table, in `ANALYTICS_METRICS`' order. */
export const OVERVIEW_PERIOD_KEYS = [
  'created',
  'started',
  'finished',
  'completed',
  'completed-verified',
  'completed-with-fallback',
  'completed-unverified',
  'failed',
  'approved',
  'declined',
  'needs-review',
  'expired-before-start',
  'expired-after-start',
] as const;

/** The chart's finding, in words, from the suppressed answer. */
export function overviewCaption(answer: Answer): string {
  const a = answer.data.attributes;
  const t = a.threshold;
  const counts = a.totals.counts;
  const success = a.totals.rates['success-rate'];
  return [
    `From ${a.from} to ${a.to} (${a['time-zone']}): ${countWords(counts.created, t)} inquiries created, ${countWords(counts.started, t)} started and ${countWords(counts.finished, t)} finished.`,
    ...(success === undefined
      ? []
      : [
          `Success rate ${rateWords(success)} of finished inquiries: ${countWords(counts['completed-verified'], t)} completed with every verification passed, ${countWords(counts['completed-with-fallback'], t)} through a fallback, ${countWords(counts['completed-unverified'], t)} with no verification.`,
        ]),
  ].join(' ');
}

export function OverviewView({
  answer,
  tagged,
}: {
  readonly answer: Answer;
  readonly tagged: boolean;
}) {
  const a = answer.data.attributes;
  const t = a.threshold;
  const mixed = a['time-zones'].length > 1;
  const bucketWord = ANALYTICS_COPY.buckets[a.bucket].toLowerCase();
  const label = (bucket: (typeof a.buckets)[number]) => periodWords(bucket, mixed);
  const { rates, counts } = a.totals;
  return (
    <>
      <PageSection id="analytics-overview-chart" title={ANALYTICS_COPY.overview.countsTitle}>
        {tagged && <p className="text-sm text-ink-muted">{ANALYTICS_COPY.overview.tagOnly}</p>}
        <LineChart
          title={fillCopy(ANALYTICS_COPY.tables.byPeriod, {
            name: 'Inquiries created and started',
            bucket: bucketWord,
          })}
          caption={overviewCaption(answer)}
          threshold={t}
          series={['created', 'started'].map((key) => ({
            name: key === 'created' ? 'Created' : 'Started',
            points: a.buckets.map((bucket) =>
              chartPoint(label(bucket), bucket.counts[key as 'created'], t),
            ),
          }))}
        />
        <BucketTable
          caption={fillCopy(ANALYTICS_COPY.tables.byPeriod, {
            name: 'Inquiries',
            bucket: bucketWord,
          })}
          buckets={a.buckets}
          keys={OVERVIEW_PERIOD_KEYS}
          threshold={t}
          mixed={mixed}
        />
        <MetricTable
          caption={fillCopy(ANALYTICS_COPY.tables.totals, { name: 'Inquiries' })}
          report="inquiries"
          counts={counts}
          durations={{ 'time-to-finish': a.totals['time-to-finish'] }}
          threshold={t}
        />
      </PageSection>
      <PageSection
        id="analytics-overview-rates"
        title={ANALYTICS_COPY.overview.ratesTitle}
        description={ANALYTICS_COPY.overview.successSplit}
      >
        <MetricTable
          caption={fillCopy(ANALYTICS_COPY.tables.totals, { name: 'Rates' })}
          report="inquiries"
          rates={rates}
          threshold={t}
        />
      </PageSection>
    </>
  );
}
