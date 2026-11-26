/**
 * Signals (C164.6, C164.9): each signal's values in its fixed bins over the window, with its tier
 * and stage (the beta label on a heuristic), and "not evaluated" for a value never computed, never
 * a bin.
 */
import type { AnalyticsDocuments } from '../../lib/api/analytics';
import { ANALYTICS_COPY } from '../../lib/copy/analytics';
import { DataTable } from '../data-table';
import { PageSection } from '../lifecycle/page-section';
import { chartPoint, countWords } from './analytics-cells';
import { BarChart } from './analytics-charts';
import { TierStage } from './stage-badge';

type Answer = AnalyticsDocuments['signals'];
type Signal = Answer['data']['attributes']['totals']['signals'][number];

const NOT_EVALUATED = ANALYTICS_COPY.cells.notEvaluated;

/** A signal's finding, in words, from the suppressed answer; hidden bins are never compared. */
export function signalCaption(signal: Signal, threshold: number): string {
  const shown = signal.bins.filter((bin) => typeof bin.count === 'number' && bin.count > 0);
  const largest = shown.reduce<(typeof shown)[number] | undefined>(
    (best, bin) =>
      best === undefined || (bin.count as number) > (best.count as number) ? bin : best,
    undefined,
  );
  const hidden = signal.bins.some((bin) => typeof bin.count === 'object');
  return [
    `${signal.name} over ${String(signal.bins.length)} bins; ${countWords(signal['not-evaluated'], threshold)} not evaluated.`,
    ...(largest === undefined
      ? []
      : [
          `The largest shown bin is ${largest.bin} (${countWords(largest.count, threshold)})${hidden ? '; hidden bins are not compared' : ''}.`,
        ]),
  ].join(' ');
}

function SignalSection({
  signal,
  threshold,
}: {
  readonly signal: Signal;
  readonly threshold: number;
}) {
  const rows = [
    ...signal.bins.map((bin) => ({ bin: bin.bin, count: bin.count })),
    { bin: NOT_EVALUATED, count: signal['not-evaluated'] },
  ];
  return (
    <PageSection id={`signal-${signal.name.replace(/\W/g, '-')}`} title={signal.name}>
      <p className="text-sm text-ink-muted">
        <TierStage tier={signal.tier} stage={signal.stage} />
      </p>
      <BarChart
        title={`Inquiries per bin of ${signal.name}`}
        caption={signalCaption(signal, threshold)}
        threshold={threshold}
        series={[
          {
            name: 'Inquiries',
            points: rows.map((row) => chartPoint(row.bin, row.count, threshold)),
          },
        ]}
      />
      <DataTable
        caption={`Bins of ${signal.name}`}
        rows={rows}
        getRowKey={(row) => row.bin}
        emptyMessage={ANALYTICS_COPY.chart.noData}
        columns={[
          { id: 'bin', header: 'Bin', rowHeader: true, cell: (row) => row.bin },
          { id: 'count', header: 'Inquiries', cell: (row) => countWords(row.count, threshold) },
        ]}
      />
    </PageSection>
  );
}

export function SignalsView({ answer }: { readonly answer: Answer }) {
  const a = answer.data.attributes;
  return (
    <>
      <p className="text-sm text-ink-muted">{ANALYTICS_COPY.signals.notEvaluated}</p>
      {a.totals.signals.map((signal) => (
        <SignalSection key={signal.name} signal={signal} threshold={a.threshold} />
      ))}
    </>
  );
}
