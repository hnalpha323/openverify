/**
 * The reports console's badges (C86): a report's status (about processing), its result (beside
 * the coverage), and a type's stage. Each badge says its meaning in text; colour only reinforces
 * it (WCAG 1.4.1).
 */
import type { CheckStage, ReportStatus } from '@openverify/core';
import { REPORT_STATUS_LABELS } from '../../lib/labels';
import { REPORT_RESULT_LABELS, type ReportResult } from '../../lib/report-result';
import { REPORT_STAGE_LABELS } from '../../lib/report-type-words';
import { Badge, type BadgeTone } from '../status-badge';

const STATUS_TONES: Record<ReportStatus, BadgeTone> = {
  pending: 'progress',
  submitted: 'progress',
  ready: 'neutral',
  errored: 'danger',
};

// A match is a lead, not a decision; "no match" is not a pass, so it is never green.
const RESULT_TONES: Record<ReportResult, BadgeTone> = {
  pending: 'progress',
  match: 'attention',
  'no-match': 'neutral',
  'match-not-screened': 'danger',
  'not-screened': 'danger',
  computed: 'neutral',
};

export function ReportStatusBadge({ status }: { readonly status: ReportStatus }) {
  return <Badge status={status} label={REPORT_STATUS_LABELS[status]} tone={STATUS_TONES[status]} />;
}

export function ReportResultBadge({ result }: { readonly result: ReportResult }) {
  return <Badge status={result} label={REPORT_RESULT_LABELS[result]} tone={RESULT_TONES[result]} />;
}

/** A type's stage (ADR 0002 §3c): "Beta" until a calibration report exists. */
export function StageBadge({ stage }: { readonly stage: CheckStage }) {
  return (
    <span
      data-stage={stage}
      className="inline-flex items-center rounded-md bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-800 ring-1 ring-violet-600/20 ring-inset"
    >
      {REPORT_STAGE_LABELS[stage]}
    </span>
  );
}
