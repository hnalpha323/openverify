/**
 * What an answer's figures mean (C164.7, C164.9, C163.2, C163.4), on every view: the reporting time
 * zone (a range that mixes zones marked), the window, the freshness (rolled up through, the open
 * days' outcomes as of), the live day with created and started only, the settle window, the
 * threshold with the hidden-cell count, what suppression does not cover, and every metric's
 * definition with its terms, in `ANALYTICS_METRICS`' own words.
 */
import type { AnalyticsReport } from '@openverify/core';
import { ANALYTICS_COPY, fillCopy } from '../../lib/copy/analytics';
import { formatUtc } from '../timestamp';
import { metricLabel, metricOf, rateTermsWords } from './analytics-cells';

/** The members every answer carries (B15). */
export interface AnalyticsCommon {
  readonly 'time-zone': string;
  readonly 'time-zones': readonly string[];
  readonly from: string;
  readonly to: string;
  readonly threshold: number;
  readonly 'suppressed-cells': number;
  readonly 'settle-days': number;
  readonly freshness: {
    readonly 'rolled-up-through': string | null;
    readonly 'outcomes-as-of': string | null;
  };
  readonly buckets: readonly { readonly start: string; readonly live: boolean }[];
}

export interface AnalyticsAboutProps {
  readonly report: AnalyticsReport;
  readonly attributes: AnalyticsCommon;
  /** The metrics the view shows, defined in its words. */
  readonly metrics: readonly string[];
}

const ABOUT = ANALYTICS_COPY.about;

/** What the answer's figures mean, one sentence each (the About list and the download's start). */
export function aboutLines(report: AnalyticsReport, attributes: AnalyticsCommon): string[] {
  const zones = attributes['time-zones'];
  const rolledUp = attributes.freshness['rolled-up-through'];
  const outcomes = attributes.freshness['outcomes-as-of'];
  const live = attributes.buckets.find((bucket) => bucket.live);
  const threshold = attributes.threshold;
  return [
    fillCopy(ABOUT.zone, { zone: attributes['time-zone'] }),
    ...(zones.length > 1 ? [fillCopy(ABOUT.mixedZones, { zones: zones.join(', ') })] : []),
    fillCopy(ABOUT.window, { from: attributes.from, to: attributes.to }),
    rolledUp === null ? ABOUT.notRolledUp : fillCopy(ABOUT.rolledUp, { time: formatUtc(rolledUp) }),
    outcomes === null
      ? ABOUT.outcomesNever
      : fillCopy(ABOUT.outcomes, { time: formatUtc(outcomes) }),
    ...(live === undefined ? [] : [fillCopy(ABOUT.live, { day: live.start })]),
    fillCopy(ABOUT.settle, { days: attributes['settle-days'] }),
    fillCopy(ABOUT.threshold, {
      threshold,
      max: threshold - 1,
      hidden: attributes['suppressed-cells'],
    }),
    fillCopy(ABOUT.limits, { threshold }),
    ...(report === 'inquiries' ? [ABOUT.settled] : []),
  ];
}

/** Each metric the view shows, with its definition and, for a rate, its terms. */
export function definitionsOf(
  report: AnalyticsReport,
  metrics: readonly string[],
): (readonly [label: string, definition: string])[] {
  return metrics.flatMap((key) => {
    const metric = metricOf(report, key);
    return metric === undefined
      ? []
      : [
          [
            metricLabel(key),
            `${metric.definition}${metric.kind === 'rate' ? ` (${rateTermsWords(metric)}.)` : ''}`,
          ] as const,
        ];
  });
}

export function AnalyticsAbout({ report, attributes, metrics }: AnalyticsAboutProps) {
  const lines = aboutLines(report, attributes);
  return (
    <section
      aria-labelledby="analytics-about"
      className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4"
    >
      <h2 id="analytics-about" className="text-base font-semibold">
        {ABOUT.heading}
      </h2>
      <ul className="flex list-disc flex-col gap-1 ps-5 text-sm text-ink-muted">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <details className="text-sm">
        <summary className="cursor-pointer font-medium text-ink">{ABOUT.definitions}</summary>
        <dl className="mt-2 grid gap-x-4 gap-y-2 sm:grid-cols-[minmax(10rem,auto)_1fr]">
          {definitionsOf(report, metrics).map(([label, definition]) => (
            <div key={label} className="contents">
              <dt className="font-medium text-ink">{label}</dt>
              <dd className="text-ink-muted">{definition}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}
