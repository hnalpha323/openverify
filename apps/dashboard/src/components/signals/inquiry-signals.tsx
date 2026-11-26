/**
 * The inquiry's Signals section (C90, C108; ADR 0006): the values grouped by layer, each with its
 * tier, the `beta` badge of a heuristic, its confidence, its reasons and the thresholds applied,
 * in words. A `null` value reads "Not evaluated" with its reason, never "no"; a low score reads "no
 * automation artefacts found" and a low threat level "no listed risk found". Nothing here passes,
 * fails or declines anything. The dashboard API serves the values whatever `expose-signals` says
 * (`CONSOLE_SIGNAL_VIEW`), so nothing here depends on that setting.
 */
import type { InquiryResource, SignalDetail, SignalValue } from '@openverify/contracts';
import { SIGNAL_LAYERS, getSignalDefinition, type SignalLayer } from '@openverify/core';
import {
  SIGNAL_EVIDENCE_REASON_WORDS,
  SIGNAL_LABELS,
  SIGNAL_LAYER_LABELS,
  SIGNAL_NULL_REASON_WORDS,
  SIGNAL_REVIEW_CAUSE_WORDS,
  signalValueText,
  thresholdText,
} from '../../lib/signal-words';
import { DataTable, type Column } from '../data-table';
import { DbIpAttribution } from './db-ip-attribution';
import { EvidenceMeta, ReasonList } from './evidence';
import { SourceList } from './session-parts';

type Details = InquiryResource['attributes']['signal-details'];

export interface InquirySignalsProps {
  /** The inquiry's `signals`; `undefined` from a server that serves none. */
  readonly signals: readonly SignalValue[] | undefined;
  readonly details: Details;
}

interface Row {
  readonly name: string;
  readonly value: SignalValue['value'];
  readonly detail: SignalDetail | undefined;
}

const labelOf = (name: string) =>
  Object.hasOwn(SIGNAL_LABELS, name) ? SIGNAL_LABELS[name as keyof typeof SIGNAL_LABELS] : name;

/** The evidence reasons and each session's own reason (C90.4), in words. */
function reasonsOf(detail: SignalDetail | undefined): string[] {
  if (detail === undefined) {
    return [];
  }
  const own = detail.reasons.map((reason) => SIGNAL_EVIDENCE_REASON_WORDS[reason]);
  const sessions = (detail.sessions ?? []).map((session) =>
    session['null-reason'] === null
      ? `session ${session['session-id']}: evaluated`
      : `session ${session['session-id']}: ${SIGNAL_NULL_REASON_WORDS[session['null-reason']]}`,
  );
  return [...own, ...sessions];
}

const COLUMNS: readonly Column<Row>[] = [
  {
    id: 'signal',
    header: 'Signal',
    rowHeader: true,
    cell: (row) => (
      <span className="flex flex-col">
        <span>{labelOf(row.name)}</span>
        <code className="font-mono text-xs font-normal text-ink-muted">{row.name}</code>
      </span>
    ),
  },
  {
    id: 'value',
    header: 'Value',
    cell: (row) => signalValueText(row.name, row.value, row.detail),
  },
  {
    id: 'evidence',
    header: 'Evidence',
    cell: (row) =>
      row.detail === undefined ? null : (
        <EvidenceMeta
          tier={row.detail.tier}
          beta={row.detail.stage === 'beta'}
          confidence={'confidence' in row.detail ? row.detail.confidence : null}
        />
      ),
  },
  {
    id: 'reasons',
    header: 'Reasons',
    cell: (row) => (
      <span className="flex flex-col gap-1">
        <ReasonList reasons={reasonsOf(row.detail)} />
        {row.detail?.sources !== undefined && row.detail.sources.length > 0 && (
          <SourceList sources={row.detail.sources} />
        )}
      </span>
    ),
  },
  {
    id: 'thresholds',
    header: 'Thresholds',
    cell: (row) => {
      const thresholds = Object.entries(row.detail?.thresholds ?? {});
      return thresholds.length === 0 ? null : (
        <ul className="flex flex-col text-xs">
          {thresholds.map(([key, value]) => (
            <li key={key}>{thresholdText(key, value)}</li>
          ))}
        </ul>
      );
    },
  },
];

const ruleList = (rules: readonly number[]) => {
  const numbers = rules.map((rule) => String(rule + 1));
  if (numbers.length === 1) {
    return `Rule ${numbers[0] ?? ''} of the template version matched.`;
  }
  return `Rules ${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1) ?? ''} of the template version matched.`;
};

/** Whether the rows show an IP location or a distance computed from one (C92.8). */
const showsIpLocation = (rows: readonly Row[]) =>
  rows.some(
    (row) =>
      row.value !== null &&
      (row.name === 'inquiry/country_from_session' ||
        row.name === 'inquiry/country_comparison' ||
        row.name === 'inquiry/max_session_distance'),
  );

export function InquirySignals({ signals, details }: InquirySignalsProps) {
  if (signals === undefined || details === undefined) {
    return (
      <p className="text-sm text-ink-muted">This server does not serve signals for this inquiry.</p>
    );
  }
  if (details['computed-at'] === null) {
    return (
      <p className="text-sm text-ink-muted">
        Not computed yet. Signals are computed once the inquiry completes, fails or expires.
      </p>
    );
  }
  const rows: Row[] = signals.map(({ name, value }) => ({
    name,
    value,
    detail: details[name] as SignalDetail | undefined,
  }));
  const layerOf = (row: Row): SignalLayer => getSignalDefinition(row.name)?.layer ?? 'ensemble';
  const review = details.review;
  return (
    <div className="flex flex-col gap-4">
      {review !== undefined && (
        <p role="note" aria-label="Signal review" className="text-sm">
          {SIGNAL_REVIEW_CAUSE_WORDS[review.cause]}.
          {review.rules.length > 0 && ` ${ruleList(review.rules)}`}
        </p>
      )}
      {rows.length === 0 && (
        <p className="text-sm text-ink-muted">This inquiry&apos;s template collects no signal.</p>
      )}
      {SIGNAL_LAYERS.map((layer) => {
        const inLayer = rows.filter((row) => layerOf(row) === layer);
        return inLayer.length === 0 ? null : (
          <DataTable
            key={layer}
            caption={`${SIGNAL_LAYER_LABELS[layer]} signals`}
            columns={COLUMNS}
            rows={inLayer}
            getRowKey={(row) => row.name}
            emptyMessage="No signals."
          />
        );
      })}
      {showsIpLocation(rows) && <DbIpAttribution />}
    </div>
  );
}
