/**
 * The funnel (C164.2, C164.9; review H17): per template version, the inquiries that entered,
 * exited and revisited each person-visible step, from the server's step record; the overall share
 * (of started) and the per-step share (of the transitions into it); the transitions and the 20 most
 * frequent paths. A period before the environment's first step record reads "no step data", never 0.
 */
import type { AnalyticsDocuments } from '../../lib/api/analytics';
import { ANALYTICS_COPY, fillCopy } from '../../lib/copy/analytics';
import { DataTable } from '../data-table';
import { PageSection } from '../lifecycle/page-section';
import { chartPoint, countWords, isSuppressed, rateWords } from './analytics-cells';
import { BarChart } from './analytics-charts';
import { BucketTable } from './analytics-tables';

type Answer = AnalyticsDocuments['funnel'];
type Version = Answer['data']['attributes']['totals']['versions'][number];

const FUNNEL = ANALYTICS_COPY.funnel;

/** A version's chart caption, in words, from the suppressed answer. */
export function funnelCaption(version: Version, threshold: number): string {
  const hidden = version.steps.filter((step) => isSuppressed(step.counts.entered)).length;
  return `Version ${version['inquiry-template-version-id']}: ${countWords(version.counts.started, threshold)} inquiries started; inquiries entering each of its ${String(version.steps.length)} person-visible steps${hidden > 0 ? `, ${String(hidden)} of those counts hidden` : ''}.`;
}

function VersionSection({
  version,
  threshold,
}: {
  readonly version: Version;
  readonly threshold: number;
}) {
  const id = version['inquiry-template-version-id'];
  const t = threshold;
  return (
    <PageSection id={`funnel-${id}`} title={fillCopy(FUNNEL.versionTitle, { id })}>
      <BarChart
        title={`Inquiries entering each step of version ${id}`}
        caption={funnelCaption(version, t)}
        threshold={t}
        series={[
          {
            name: 'Entered',
            points: version.steps.map((step) =>
              chartPoint(step['step-id'], step.counts.entered, t),
            ),
          },
        ]}
      />
      <DataTable
        caption={`Steps of version ${id}`}
        rows={version.steps}
        getRowKey={(step) => step['step-id']}
        emptyMessage={FUNNEL.noStepDataYet}
        columns={[
          { id: 'step', header: 'Step', rowHeader: true, cell: (step) => step['step-id'] },
          { id: 'entered', header: 'Entered', cell: (step) => countWords(step.counts.entered, t) },
          { id: 'exited', header: 'Exited', cell: (step) => countWords(step.counts.exited, t) },
          {
            id: 'revisits',
            header: 'Revisited',
            cell: (step) => countWords(step.counts.revisits, t),
          },
          {
            id: 'overall',
            header: 'Overall share (entered over started)',
            cell: (step) => rateWords(step.rates['overall-share']),
          },
          {
            id: 'step-share',
            header: 'Step share (entered over transitions into it)',
            cell: (step) =>
              step.rates['step-share'] === undefined
                ? FUNNEL.entryShare
                : rateWords(step.rates['step-share']),
          },
        ]}
      />
      <DataTable
        caption={`${FUNNEL.transitions} of version ${id}`}
        rows={version.transitions}
        getRowKey={(each) => `${each['from-step-id']}>${each['to-step-id']}`}
        emptyMessage={ANALYTICS_COPY.chart.noData}
        columns={[
          {
            id: 'move',
            header: 'From, to',
            rowHeader: true,
            cell: (each) => `${each['from-step-id']} to ${each['to-step-id']}`,
          },
          { id: 'count', header: 'Inquiries', cell: (each) => countWords(each.count, t) },
        ]}
      />
      <DataTable
        caption={`${FUNNEL.paths} of version ${id}`}
        rows={version.paths}
        getRowKey={(each) => each['step-ids'].join('>')}
        emptyMessage={ANALYTICS_COPY.chart.noData}
        columns={[
          {
            id: 'path',
            header: 'Steps, in order',
            rowHeader: true,
            cell: (each) => each['step-ids'].join(', then '),
          },
          { id: 'count', header: 'Inquiries', cell: (each) => countWords(each.count, t) },
        ]}
      />
    </PageSection>
  );
}

export function FunnelView({ answer }: { readonly answer: Answer }) {
  const a = answer.data.attributes;
  const from = a.totals['step-data-from'];
  const bucketWord = ANALYTICS_COPY.buckets[a.bucket].toLowerCase();
  return (
    <>
      <p className="text-sm text-ink-muted">
        {from === null ? FUNNEL.noStepDataYet : fillCopy(FUNNEL.stepDataFrom, { day: from })}
      </p>
      <BucketTable
        caption={fillCopy(ANALYTICS_COPY.tables.byPeriod, {
          name: 'Inquiries started',
          bucket: bucketWord,
        })}
        buckets={a.buckets}
        keys={['started']}
        threshold={a.threshold}
        mixed={a['time-zones'].length > 1}
      />
      {a.totals.versions.map((version) => (
        <VersionSection
          key={version['inquiry-template-version-id']}
          version={version}
          threshold={a.threshold}
        />
      ))}
    </>
  );
}
