/**
 * Checks (C164.4, C164.9; review H03): per check, every status its own count (errored and not
 * configured never folded into not applicable), its share of failed verifications, required or
 * advisory, its tier and stage with the beta label, and its reasons. A check with no result in the
 * window reads "not run" in every cell, never zero failures.
 */
import type { AnalyticsDocuments } from '../../lib/api/analytics';
import { ANALYTICS_COPY, fillCopy } from '../../lib/copy/analytics';
import { DataTable } from '../data-table';
import { PageSection } from '../lifecycle/page-section';
import { chartPoint, countWords, metricOf, rateTermsWords, rateWords } from './analytics-cells';
import { BarChart } from './analytics-charts';
import { BucketTable } from './analytics-tables';
import { TierStage } from './stage-badge';

type Answer = AnalyticsDocuments['checks'];
type Check = Answer['data']['attributes']['totals']['checks'][number];

const NOT_RUN = ANALYTICS_COPY.cells.notRun;
const STATUS_KEYS = [
  'runs',
  'passed',
  'failed',
  'not-applicable',
  'errored',
  'not-configured',
  'pending',
] as const;

const keyOf = (check: Check) =>
  `${check['check-name']}-${check['verification-type']}-${check.requirement}`;

/** The chart's finding, in words, from the suppressed answer. */
export function checksCaption(checks: readonly Check[], from: string, to: string): string {
  const ran = checks.filter((check) => check.ran).length;
  return `Results written per check from ${from} to ${to}: ${String(ran)} of ${String(checks.length)} checks ran; ${String(checks.length - ran)} did not run in the window (shown "not run", never zero failures).`;
}

const label = (key: string) => key.replace(/-/g, ' ').replace(/^./, (first) => first.toUpperCase());

export function ChecksView({ answer }: { readonly answer: Answer }) {
  const a = answer.data.attributes;
  const t = a.threshold;
  const { checks } = a.totals;
  const share = metricOf('checks', 'failure-share');
  const withReasons = checks.flatMap((check) => check.reasons.map((reason) => ({ check, reason })));
  return (
    <>
      <PageSection id="analytics-checks" title="Checks">
        <BarChart
          title="Results written per check"
          caption={checksCaption(checks, a.from, a.to)}
          threshold={t}
          series={[
            {
              name: 'Results',
              points: checks.map((check) =>
                chartPoint(
                  `${check['check-name']} (${check.requirement === 'required' ? 'required' : 'advisory'})`,
                  check.counts.runs,
                  t,
                  check.ran ? undefined : NOT_RUN,
                ),
              ),
            },
          ]}
        />
        <DataTable
          caption="Checks and their results"
          rows={checks}
          getRowKey={keyOf}
          emptyMessage={ANALYTICS_COPY.chart.noData}
          columns={[
            { id: 'check', header: 'Check', rowHeader: true, cell: (check) => check['check-name'] },
            {
              id: 'type',
              header: 'Verification type',
              cell: (check) => check['verification-type'],
            },
            {
              id: 'requirement',
              header: 'Required',
              cell: (check) => (check.requirement === 'required' ? 'Required' : 'Advisory'),
            },
            {
              id: 'tier',
              header: 'Tier and stage',
              cell: (check) => <TierStage tier={check.tier} stage={check.stage} />,
            },
            ...STATUS_KEYS.map((key) => ({
              id: key,
              header: label(key),
              cell: (check: Check) => (check.ran ? countWords(check.counts[key], t) : NOT_RUN),
            })),
            {
              id: 'share',
              header: 'Failure share',
              cell: (check) => (check.ran ? rateWords(check.rates['failure-share']) : NOT_RUN),
            },
          ]}
        />
        {share !== undefined && (
          <p className="text-sm text-ink-muted">
            Failure share: {rateTermsWords(share)}. It is not defined when a check failed more often
            than its verification did (an advisory check) or when no verification failed.
          </p>
        )}
      </PageSection>
      <PageSection id="analytics-check-reasons" title={ANALYTICS_COPY.checks.reasons}>
        <DataTable
          caption="Reasons per check, a check used both ways combined"
          rows={withReasons}
          getRowKey={(row) => `${keyOf(row.check)}-${row.reason.reason}`}
          emptyMessage={ANALYTICS_COPY.chart.noData}
          columns={[
            {
              id: 'check',
              header: 'Check',
              rowHeader: true,
              cell: (row) => row.check['check-name'],
            },
            { id: 'reason', header: 'Reason', cell: (row) => row.reason.reason },
            { id: 'count', header: 'Results', cell: (row) => countWords(row.reason.count, t) },
          ]}
        />
        <BucketTable
          caption={fillCopy(ANALYTICS_COPY.tables.byPeriod, {
            name: 'Check results',
            bucket: ANALYTICS_COPY.buckets[a.bucket].toLowerCase(),
          })}
          buckets={a.buckets}
          keys={['runs', 'failed']}
          threshold={t}
          mixed={a['time-zones'].length > 1}
        />
      </PageSection>
    </>
  );
}
