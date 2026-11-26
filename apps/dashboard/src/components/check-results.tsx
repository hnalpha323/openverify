import type { VerificationCheck } from '@openverify/contracts';
import type { CheckStage, ThresholdValue, VerificationStatus } from '@openverify/core';
import type { ReactNode } from 'react';
import { countByStatus, groupChecks, sendsToReview } from '../lib/check-groups';
import { reasonText } from '../lib/check-reasons';
import {
  COMPARISON_CHECKS,
  comparisonSourceOf,
  comparisonSourceWords,
} from '../lib/comparison-source';
import { databaseFieldText } from '../lib/database-words';
import { CHECK_CATEGORY_LABELS, CHECK_STATUS_LABELS } from '../lib/labels';
import { THRESHOLD_ORIGIN_WORDS, appliedThreshold } from '../lib/selfie-evidence';
import { DataTable, type Column } from './data-table';
import { CheckStatusBadge } from './status-badge';

export interface CheckResultsProps {
  /** The verification's checks, as the API serves them. */
  readonly checks: readonly VerificationCheck[];
  /** The verification's title ("Government ID", "Government ID, attempt 2"); names the tables. */
  readonly label: string;
  /** The verification's status: one in `needs_review` names the checks that sent it there. */
  readonly status: VerificationStatus;
  /** The verification page: each check's metadata as well. */
  readonly detailed?: boolean;
}

const code = (value: string, className = '') => (
  <code className={`font-mono text-xs break-all ${className}`}>{value}</code>
);

/** A value the result does not have, in words. */
const absent = (words: string) => <span className="text-ink-muted">{words}</span>;

/** The focus ring of a `<summary>`, like every other control (WCAG 2.4.7). */
export const SUMMARY_CLASS =
  'w-fit cursor-pointer rounded-md text-sm font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

/** A result's stage in text, for any stage but `ga` (ADR 0002 §3c). */
function StageBadge({ stage }: { readonly stage: CheckStage | undefined }) {
  if (stage === undefined || stage === 'ga') {
    return null;
  }
  return (
    <span
      data-stage={stage}
      // Outlined, unlike every status badge, so it reads as a label of the check, not a result.
      className="inline-flex items-center rounded-full bg-surface px-2 py-0.5 text-xs font-medium whitespace-nowrap text-ink ring-1 ring-control ring-inset"
    >
      {stage === 'beta' ? 'Beta' : 'Sunset'}
    </span>
  );
}

/** The status, the stage and, where the result has one, the confidence (C29.2). */
function Outcome({ check }: { readonly check: VerificationCheck }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex flex-wrap gap-1">
        <CheckStatusBadge status={check.status} />
        <StageBadge stage={check.stage} />
      </div>
      {check.confidence != null && (
        <span className="text-xs text-ink-muted">
          Confidence <span className="font-mono text-ink">{check.confidence.toFixed(2)}</span>
        </span>
      )}
    </div>
  );
}

/**
 * Whether the template requires the check (C30.1, C51.1). An advisory check that failed says it
 * does not decide the verification, so its "Failed" never reads as the verification's outcome.
 */
function Requirement({ check }: { readonly check: VerificationCheck }) {
  if (check.requirement === 'required') {
    return <>Required</>;
  }
  return (
    <span className="flex flex-col">
      <span>Advisory</span>
      {check.status === 'failed' && (
        <span className="text-xs text-ink-muted">Does not decide the verification</span>
      )}
    </span>
  );
}

/**
 * One reason in words, with its code; a code without words as itself (C37). The check's own
 * type words it first (C54.5).
 */
function Reason({ reason, check }: { readonly reason: string; readonly check: string }) {
  const text = reasonText(reason, check);
  if (text === undefined) {
    return code(reason);
  }
  return (
    <span className="flex flex-col">
      <span className="font-medium">{text.words}</span>
      {text.explanation !== undefined && (
        <span className="text-xs text-ink-muted">{text.explanation}</span>
      )}
      {code(reason, 'text-ink-muted')}
    </span>
  );
}

function Reasons({
  reasons,
  check,
}: {
  readonly reasons: readonly string[];
  readonly check: string;
}) {
  if (reasons.length === 0) {
    return absent('None');
  }
  return (
    <ul className="flex flex-col gap-2">
      {reasons.map((reason) => (
        <li key={reason}>
          <Reason reason={reason} check={check} />
        </li>
      ))}
    </ul>
  );
}

/** A metadata value as text: numbers, strings and flags as they are, anything else as JSON. */
function metadataText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

/**
 * A threshold as text: a list (such as `required-fields`) joined with commas, and a list of
 * match groups (C51.3) as alternatives, each group's fields with their levels.
 */
export function thresholdText(value: ThresholdValue): string {
  if (typeof value !== 'object') {
    return String(value);
  }
  return value
    .map((item) =>
      typeof item === 'string'
        ? item
        : Object.entries(item)
            .map(([field, level]) => `${field} ${level}`)
            .join(' and '),
    )
    .join(value.some((item) => typeof item !== 'string') ? '; or ' : ', ');
}

/**
 * C149.4 (K9-16): for an inquiry comparison, where each compared field's value came from, in words
 * beside the field; a field without a recorded source says so, never naming one.
 */
function ComparisonSources({ metadata }: { readonly metadata: VerificationCheck['metadata'] }) {
  const compared = metadata['compared-fields'];
  const fields = Array.isArray(compared)
    ? compared.filter((field): field is string => typeof field === 'string')
    : [];
  if (fields.length === 0) {
    return null;
  }
  return (
    <ul aria-label="Where each compared value came from" className="mt-1 flex flex-col text-xs">
      {fields.map((field) => (
        <li key={field}>
          {`${databaseFieldText(field) ?? field}: ${comparisonSourceWords(comparisonSourceOf(metadata, field))}`}
        </li>
      ))}
    </ul>
  );
}

/** A check's metadata (scores and thresholds, never PII, C29.3) as terms and values. */
function Metadata({ check }: { readonly check: VerificationCheck }) {
  const { metadata } = check;
  const entries = Object.entries(metadata);
  if (entries.length === 0) {
    return absent('None');
  }
  return (
    <>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {entries.map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="font-mono text-xs text-ink-muted">{key}</dt>
            <dd className="font-mono text-xs break-all">{metadataText(value)}</dd>
          </div>
        ))}
      </dl>
      {COMPARISON_CHECKS.includes(check.name) && <ComparisonSources metadata={metadata} />}
    </>
  );
}

function ProvenanceTerm({
  term,
  children,
}: {
  readonly term: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="contents">
      <dt className="text-xs font-medium text-ink-muted">{term}</dt>
      <dd className="text-xs break-words">{children}</dd>
    </div>
  );
}

/**
 * How the result was produced (C29.2, ADR 0002 §3f), in a disclosure of its own: the
 * implementation version, the models (id and the first 12 hex characters of the SHA-256), the
 * provider and every threshold, with how it was set where the result records it (C39.3: a
 * default's basis, or the template). Values are text; React escapes them.
 */
function Provenance({ check }: { readonly check: VerificationCheck }) {
  const { provenance } = check;
  // Results stored before Phase 3 have none (C29.2).
  if (provenance == null) {
    return absent('Not recorded');
  }
  const models = provenance.models ?? [];
  const thresholds = Object.entries(provenance.thresholds);
  return (
    <details>
      <summary className={SUMMARY_CLASS}>
        Show<span className="sr-only"> the provenance of {check.name}</span>
      </summary>
      <dl className="mt-2 grid min-w-56 grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <ProvenanceTerm term="Implementation version">
          {String(provenance['implementation-version'])}
        </ProvenanceTerm>
        <ProvenanceTerm term="Models">
          {models.length === 0 ? (
            absent('No model')
          ) : (
            <ul className="flex flex-col gap-0.5">
              {models.map((model) => (
                <li key={`${model.id}:${model.sha256}`}>
                  {code(model.id)}, SHA-256 {code(model.sha256.slice(0, 12))}
                </li>
              ))}
            </ul>
          )}
        </ProvenanceTerm>
        <ProvenanceTerm term="Provider">
          {provenance.provider === undefined ? (
            absent('No provider')
          ) : (
            <>
              {code(provenance.provider.id)}
              {provenance.provider.sandbox && ' (sandbox)'}
            </>
          )}
        </ProvenanceTerm>
        <ProvenanceTerm term="Thresholds">
          {thresholds.length === 0 ? (
            absent('No threshold')
          ) : (
            <ul className="flex flex-col gap-0.5">
              {thresholds.map(([key, value]) => {
                // C39.3: a default's basis, or the template; nothing for a result without bases.
                const origin = appliedThreshold(check, key)?.origin ?? 'unrecorded';
                return (
                  <li key={key}>
                    {code(key)}: {thresholdText(value)}
                    {origin !== 'unrecorded' && ` (${THRESHOLD_ORIGIN_WORDS[origin]})`}
                  </li>
                );
              })}
            </ul>
          )}
        </ProvenanceTerm>
      </dl>
    </details>
  );
}

function columns(detailed: boolean): readonly Column<VerificationCheck>[] {
  return [
    { id: 'name', header: 'Check', rowHeader: true, cell: (check) => code(check.name) },
    { id: 'status', header: 'Status', cell: (check) => <Outcome check={check} /> },
    { id: 'requirement', header: 'Requirement', cell: (check) => <Requirement check={check} /> },
    {
      id: 'category',
      header: 'Category',
      // C50.8: derived by the API from the registry; a row stored by an earlier server has none.
      cell: (check) =>
        check.category === undefined
          ? absent('Not reported')
          : CHECK_CATEGORY_LABELS[check.category],
    },
    {
      id: 'reasons',
      header: 'Reasons',
      cell: (check) => <Reasons reasons={check.reasons} check={check.name} />,
    },
    ...(detailed
      ? [
          {
            id: 'metadata',
            header: 'Metadata',
            cell: (check: VerificationCheck) => <Metadata check={check} />,
          },
        ]
      : []),
    { id: 'provenance', header: 'Provenance', cell: (check) => <Provenance check={check} /> },
  ];
}

/**
 * Why a verification is in review (C30.4): the required checks without evidence, with their
 * reasons in words. A required check without any result is not listed by the API, so a review
 * with none listed waits on one.
 */
function ReviewNote({ checks }: { readonly checks: readonly VerificationCheck[] }) {
  return (
    <div
      role="note"
      aria-label="Why it needs review"
      className="rounded-lg border border-violet-300 bg-violet-50 p-3 text-sm text-violet-900"
    >
      {checks.length === 0 ? (
        <p>A required check has no result.</p>
      ) : (
        <>
          <p className="font-medium">
            Sent to review by {checks.length} required {checks.length === 1 ? 'check' : 'checks'}{' '}
            without evidence:
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {checks.map((check) => (
              <li key={check.name}>
                {code(check.name)} (
                {check.status === 'pending'
                  ? 'Pending'
                  : check.reasons.length === 0
                    ? 'No reason given'
                    : check.reasons
                        .map((reason) => reasonText(reason, check.name)?.words ?? reason)
                        .join(', ')}
                )
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * A verification's check results (C37). About 32 government ID checks run, so what needs the
 * operator stays in view (required failures, required checks without evidence, advisory
 * failures, in that order) and the rest fold into a native disclosure that counts them by
 * status, which keeps the images near the top. Each result shows its status, a Beta badge for a
 * beta check, its confidence where it has one, its reasons in words and its provenance.
 */
export function CheckResults({ checks, label, status, detailed = false }: CheckResultsProps) {
  const { attention, other } = groupChecks(checks);
  const tableColumns = columns(detailed);
  const counts = countByStatus(other)
    .map(
      ({ status: value, count }) => `${String(count)} ${CHECK_STATUS_LABELS[value].toLowerCase()}`,
    )
    .join(', ');
  return (
    <div className="flex flex-col gap-3">
      {status === 'needs_review' && <ReviewNote checks={checks.filter(sendsToReview)} />}
      {attention.length === 0 ? (
        <p className="text-sm text-ink-muted">No check failed or is waiting for review.</p>
      ) : (
        <DataTable
          caption={`${label} checks needing attention`}
          captionHidden
          columns={tableColumns}
          rows={attention}
          getRowKey={(check) => check.name}
          emptyMessage="No checks."
        />
      )}
      {other.length > 0 && (
        <details>
          <summary className={SUMMARY_CLASS}>
            {attention.length === 0 ? 'All checks' : 'Other checks'}: {counts}
          </summary>
          <div className="mt-2">
            <DataTable
              caption={attention.length === 0 ? `${label} checks` : `Other ${label} checks`}
              captionHidden
              columns={tableColumns}
              rows={other}
              getRowKey={(check) => check.name}
              emptyMessage="No checks."
            />
          </div>
        </details>
      )}
    </div>
  );
}
