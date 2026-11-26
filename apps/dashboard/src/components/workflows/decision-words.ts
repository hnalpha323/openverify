/**
 * The words of a decision record (C128.1; ADR 0002, ADR 0007): what the API recorded, never a
 * stronger claim. An unknown is said as unknown or undeclared, never as "no".
 */
import type {
  BiometricBasis,
  DecisionBasis,
  DecisionEvidenceKind,
  DecisionKind,
  DecisionPendingEvidenceKind,
} from '@openverify/core';

/** Each kind as the record's heading. */
export const DECISION_KIND_WORDS: Readonly<Record<DecisionKind, string>> = {
  approve: 'Approved',
  decline: 'Declined',
  review: 'Marked for review',
  reopen: 'Reopened for review',
  adverse: 'Adverse step',
  // C150.7 (Phase 9): failed on a flow path that read more than a verification's own outcome.
  'flow-failure': 'Failed by the flow',
};

export const DECISION_BASIS_WORDS: Readonly<Record<DecisionBasis, string>> = {
  contract: 'Contract',
  law: 'Law',
  'explicit-consent': 'Explicit consent',
};

export const BIOMETRIC_BASIS_WORDS: Readonly<Record<BiometricBasis, string>> = {
  'explicit-consent': 'Explicit consent',
  'substantial-public-interest': 'Substantial public interest',
};

export const DECISION_EVIDENCE_WORDS: Readonly<Record<DecisionEvidenceKind, string>> = {
  check: 'Check',
  verification: 'Verification',
  report: 'Report',
  'report-match': 'Report match',
  'list-item': 'List item',
  'list-match': 'List match',
  signal: 'Signal',
  step: 'Step value (a default, not a result)',
  extraction: 'Extracted value',
  field: 'Template field',
  device: 'Device class',
  account: 'Account',
  'workflow-output': 'Workflow output',
};

export const DECISION_PENDING_WORDS: Readonly<Record<DecisionPendingEvidenceKind, string>> = {
  report: 'Report',
  'list-screening': 'List screening',
  'graph-index': 'Graph indexing',
  signal: 'Signal',
};

/** C128.2: `solely-automated` as recorded; `null` is an API caller that declared nothing. */
export function solelyAutomatedWords(value: boolean | null): string {
  if (value === null) {
    return 'Not declared by the caller';
  }
  return value ? 'Yes: no person took part' : 'No: a person took part on the path taken';
}

/** The error codes a decision record can carry (C128.3, C128.4), each with its reason. */
export const DECISION_ERROR_WORDS: Readonly<Record<string, string>> = {
  decision_basis_missing: 'the step had no decision basis or contest route',
  biometric_consent_missing: 'the inquiry recorded no consent to an automated biometric decision',
};
