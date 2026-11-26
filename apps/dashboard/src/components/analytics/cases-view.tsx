/**
 * Cases (C164.5, C164.9; decision 41, review P20): cases created and resolved, SLA met and missed,
 * the resolution time as the buckets holding the median and the 90th percentile (approximate), and
 * the cases per reviewer only for a reader who also holds users:write, a former user combined as
 * one row. No availability figure is counted (decision 58).
 */
import type { AnalyticsDocuments } from '../../lib/api/analytics';
import { ANALYTICS_COPY, fillCopy } from '../../lib/copy/analytics';
import { DataTable } from '../data-table';
import { PageSection } from '../lifecycle/page-section';
import { chartPoint, countWords, durationWords, metricOf } from './analytics-cells';
import { LineChart } from './analytics-charts';
import { BucketTable, MetricTable, periodWords } from './analytics-tables';

type Answer = AnalyticsDocuments['cases'];
type Totals = Answer['data']['attributes']['totals'];

const WORDS = ANALYTICS_COPY.cases;

/** The chart's finding, in words, from the suppressed answer. */
export function casesCaption(totals: Totals, threshold: number): string {
  return `${countWords(totals.counts.created, threshold)} cases created and ${countWords(totals.counts.resolved, threshold)} resolved; median resolution time ${durationWords(totals['resolution-time'].median)}.`;
}

export function CasesView({
  answer,
  mayReadAssignees,
}: {
  readonly answer: Answer;
  /** The reader holds users:write; the API also leaves `assignees` out otherwise. */
  readonly mayReadAssignees: boolean;
}) {
  const a = answer.data.attributes;
  const t = a.threshold;
  const mixed = a['time-zones'].length > 1;
  const bucketWord = ANALYTICS_COPY.buckets[a.bucket].toLowerCase();
  const assignees = mayReadAssignees ? a.totals.assignees : null;
  const resolution = metricOf('cases', 'resolution-time');
  return (
    <>
      <PageSection id="analytics-cases" title="Cases" description={WORDS.noAvailability}>
        <LineChart
          title={fillCopy(ANALYTICS_COPY.tables.byPeriod, {
            name: 'Cases created and resolved',
            bucket: bucketWord,
          })}
          caption={casesCaption(a.totals, t)}
          threshold={t}
          series={(['created', 'resolved'] as const).map((key) => ({
            name: key === 'created' ? 'Created' : 'Resolved',
            points: a.buckets.map((bucket) =>
              chartPoint(periodWords(bucket, mixed), bucket.counts[key], t),
            ),
          }))}
        />
        <BucketTable
          caption={fillCopy(ANALYTICS_COPY.tables.byPeriod, { name: 'Cases', bucket: bucketWord })}
          buckets={a.buckets}
          keys={['created', 'resolved', 'sla-met', 'sla-missed']}
          threshold={t}
          mixed={mixed}
        />
        <MetricTable
          caption={fillCopy(ANALYTICS_COPY.tables.totals, { name: 'Cases' })}
          report="cases"
          counts={a.totals.counts}
          threshold={t}
        />
        <DataTable
          caption="Resolution time"
          rows={[
            { id: 'Median', cell: a.totals['resolution-time'].median },
            { id: '90th percentile', cell: a.totals['resolution-time'].p90 },
          ]}
          getRowKey={(row) => row.id}
          emptyMessage={ANALYTICS_COPY.chart.noData}
          columns={[
            { id: 'figure', header: 'Figure', rowHeader: true, cell: (row) => row.id },
            { id: 'value', header: 'Value', cell: (row) => durationWords(row.cell) },
            { id: 'meaning', header: 'What it counts', cell: () => resolution?.definition ?? '' },
          ]}
        />
      </PageSection>
      <PageSection id="analytics-case-assignees" title={WORDS.assignees}>
        {assignees === null ? (
          <p className="text-sm text-ink-muted">{WORDS.assigneesHidden}</p>
        ) : (
          // K9-18: it names people, so the view's download leaves it out.
          <div data-analytics-download="omit">
            <DataTable
              caption={WORDS.assignees}
              rows={assignees}
              getRowKey={(row) => row['user-id'] ?? 'former'}
              emptyMessage={ANALYTICS_COPY.chart.noData}
              columns={[
                {
                  id: 'user',
                  header: 'Reviewer',
                  rowHeader: true,
                  cell: (row) => row['user-id'] ?? WORDS.formerUser,
                },
                {
                  id: 'assigned',
                  header: 'Assigned',
                  cell: (row) => countWords(row.counts.assigned, t),
                },
                {
                  id: 'resolved',
                  header: 'Resolved',
                  cell: (row) => countWords(row.counts.resolved, t),
                },
              ]}
            />
          </div>
        )}
      </PageSection>
    </>
  );
}
