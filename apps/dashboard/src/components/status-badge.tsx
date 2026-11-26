import type { CheckStatus, InquiryStatus, VerificationStatus } from '@openverify/core';
import { cx } from '@openverify/ui';
import {
  CHECK_STATUS_LABELS,
  INQUIRY_STATUS_LABELS,
  VERIFICATION_STATUS_LABELS,
} from '../lib/labels';

export { INQUIRY_STATUS_LABELS };

/**
 * A badge's colour; the label always carries the meaning. `review` is reserved for "Needs
 * review" (C30.4), so it never looks like a retry request.
 */
export type BadgeTone = 'neutral' | 'progress' | 'success' | 'attention' | 'review' | 'danger';
type Tone = BadgeTone;

// The label always carries the meaning; colour only reinforces it.
const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-gray-50 text-gray-700 ring-gray-500/20',
  progress: 'bg-blue-50 text-blue-800 ring-blue-600/20',
  success: 'bg-green-50 text-green-800 ring-green-600/20',
  attention: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  review: 'bg-violet-50 text-violet-800 ring-violet-600/20',
  danger: 'bg-red-50 text-red-800 ring-red-600/20',
};

// Decisions are coloured; states that need no operator action stay neutral or blue.
const INQUIRY_TONES: Record<InquiryStatus, Tone> = {
  created: 'neutral',
  pending: 'progress',
  completed: 'progress',
  failed: 'danger',
  expired: 'neutral',
  approved: 'success',
  declined: 'danger',
  needs_review: 'review',
};

const VERIFICATION_TONES: Record<VerificationStatus, Tone> = {
  initiated: 'neutral',
  confirmed: 'progress',
  submitted: 'progress',
  passed: 'success',
  failed: 'danger',
  requires_retry: 'attention',
  canceled: 'neutral',
  skipped: 'neutral',
  needs_review: 'review',
};

const CHECK_TONES: Record<CheckStatus, Tone> = {
  passed: 'success',
  failed: 'danger',
  not_applicable: 'neutral',
  pending: 'attention',
};

/** The console's status pill: every status badge renders it (Workflow 2D K004). */
export function Badge({
  status,
  label,
  tone,
}: {
  readonly status: string;
  readonly label: string;
  readonly tone: BadgeTone;
}) {
  return (
    <span
      data-status={status}
      data-tone={tone}
      className={cx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        TONE_CLASSES[tone],
      )}
    >
      {label}
    </span>
  );
}

export function InquiryStatusBadge({ status }: { readonly status: InquiryStatus }) {
  return (
    <Badge status={status} label={INQUIRY_STATUS_LABELS[status]} tone={INQUIRY_TONES[status]} />
  );
}

export function VerificationStatusBadge({ status }: { readonly status: VerificationStatus }) {
  return (
    <Badge
      status={status}
      label={VERIFICATION_STATUS_LABELS[status]}
      tone={VERIFICATION_TONES[status]}
    />
  );
}

export function CheckStatusBadge({ status }: { readonly status: CheckStatus }) {
  return <Badge status={status} label={CHECK_STATUS_LABELS[status]} tone={CHECK_TONES[status]} />;
}
