/**
 * Verifications (C164.3, C164.9; review H06): attempts per type, client-reported capture method and
 * country, with the pass rate per attempt; and, per verification step, the outcome of each person's
 * last attempt with the pass rate per person and step. Each rate is labelled with its unit and
 * denominator, and every other status's count sits beside both.
 */
import type { AnalyticsDocuments } from '../../lib/api/analytics';
import { ANALYTICS_COPY, fillCopy } from '../../lib/copy/analytics';
import { DataTable } from '../data-table';
import { PageSection } from '../lifecycle/page-section';
import { chartPoint, countWords, metricOf, rateTermsWords, rateWords } from './analytics-cells';
import { BarChart } from './analytics-charts';
import { BucketTable } from './analytics-tables';

type Answer = AnalyticsDocuments['verifications'];
type Totals = Answer['data']['attributes']['totals'];

const WORDS = ANALYTICS_COPY.verifications;
const ATTEMPT_KEYS = [
  'created',
  'submitted',
  'passed',
  'failed',
  'requires-retry',
  'skipped',
  'needs-review',
  'canceled',
] as const;
const STEP_KEYS = [
  'step-entered',
  'step-passed',
  'step-failed-after-attempts',
  'step-needs-review',
  'step-skipped',
] as const;

const termsOf = (key: string) => {
  const metric = metricOf('verifications', key);
  return metric === undefined ? '' : rateTermsWords(metric);
};

/** The per-person chart's finding, in words, from the suppressed answer. */
export function verificationsCaption(totals: Totals, threshold: number): string {
  if (totals.steps.length === 0) {
    return 'No verification step was entered in this window.';
  }
  return `Per person and step: ${totals.steps
    .map(
      (step) =>
        `${step['step-id']}: ${countWords(step.counts['step-passed'], threshold)} of ${countWords(step.counts['step-entered'], threshold)} entered passed (${rateWords(step.rates['pass-rate-per-person'])})`,
    )
    .join('; ')}.`;
}

const label = (key: string) =>
  key
    .replace(/^step-/, '')
    .replace(/-/g, ' ')
    .replace(/^./, (first) => first.toUpperCase());

export function VerificationsView({ answer }: { readonly answer: Answer }) {
  const a = answer.data.attributes;
  const t = a.threshold;
  const bucketWord = ANALYTICS_COPY.buckets[a.bucket].toLowerCase();
  return (
    <>
      <PageSection id="analytics-verification-steps" title={WORDS.perPerson}>
        <p className="text-sm text-ink-muted">{termsOf('pass-rate-per-person')}.</p>
        <BarChart
          title="Inquiries that entered and passed each verification step"
          caption={verificationsCaption(a.totals, t)}
          threshold={t}
          series={[
            {
              name: 'Entered',
              points: a.totals.steps.map((step) =>
                chartPoint(step['step-id'], step.counts['step-entered'], t),
              ),
            },
            {
              name: 'Passed',
              points: a.totals.steps.map((step) =>
                chartPoint(step['step-id'], step.counts['step-passed'], t),
              ),
            },
          ]}
        />
        <DataTable
          caption="Verification steps, per person"
          rows={a.totals.steps}
          getRowKey={(step) => `${step['inquiry-template-version-id']}-${step['step-id']}`}
          emptyMessage={ANALYTICS_COPY.chart.noData}
          columns={[
            {
              id: 'step',
              header: 'Step',
              rowHeader: true,
              cell: (step) => `${step['step-id']} (${step['verification-type']})`,
            },
            {
              id: 'version',
              header: 'Version',
              cell: (step) => step['inquiry-template-version-id'],
            },
            ...STEP_KEYS.map((key) => ({
              id: key,
              header: label(key),
              cell: (step: Totals['steps'][number]) => countWords(step.counts[key], t),
            })),
            {
              id: 'rate',
              header: `${WORDS.perPerson} (people and steps)`,
              cell: (step) => rateWords(step.rates['pass-rate-per-person']),
            },
          ]}
        />
      </PageSection>
      <PageSection id="analytics-verification-attempts" title={WORDS.perAttempt}>
        <p className="text-sm text-ink-muted">
          {termsOf('pass-rate-per-attempt')}. {WORDS.captureClientReported}.
        </p>
        <DataTable
          caption="Verification attempts by type, capture method and country"
          rows={a.totals.groups}
          getRowKey={(group) =>
            `${group['verification-type']}-${String(group['capture-method'])}-${String(group.country)}`
          }
          emptyMessage={ANALYTICS_COPY.chart.noData}
          columns={[
            {
              id: 'type',
              header: 'Type',
              rowHeader: true,
              cell: (group) => group['verification-type'],
            },
            {
              id: 'capture',
              header: 'Capture method (client-reported)',
              cell: (group) => group['capture-method'] ?? WORDS.captureUnknown,
            },
            {
              id: 'country',
              header: 'Country',
              cell: (group) => group.country ?? WORDS.countryUnknown,
            },
            ...ATTEMPT_KEYS.map((key) => ({
              id: key,
              header: label(key),
              cell: (group: Totals['groups'][number]) => countWords(group.counts[key], t),
            })),
            {
              id: 'rate',
              header: `${WORDS.perAttempt} (attempts)`,
              cell: (group) => rateWords(group.rates['pass-rate-per-attempt']),
            },
          ]}
        />
        <BucketTable
          caption={fillCopy(ANALYTICS_COPY.tables.byPeriod, {
            name: 'Verification attempts',
            bucket: bucketWord,
          })}
          buckets={a.buckets}
          keys={ATTEMPT_KEYS}
          threshold={t}
          mixed={a['time-zones'].length > 1}
        />
      </PageSection>
    </>
  );
}
