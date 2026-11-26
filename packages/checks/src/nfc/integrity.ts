/**
 * C62.4: the data-group checks run whatever the revocation, and on integrity. With integrity
 * established they are judged normally; not established, a mismatch fails (the data contradict
 * the document or the face) and a match answers `integrity_not_established` (never `passed`);
 * broken, `integrity_not_established`. A data group's integrity is established only when the
 * report's is and the group hashed identically.
 */
import type { CheckStatus } from '@openverify/core';
import type { DataGroupNumber, PassiveAuthenticationReport } from '@openverify/emrtd';

export type DataIntegrity = 'established' | 'not_established' | 'broken';

export const INTEGRITY_NOT_ESTABLISHED = 'integrity_not_established';

export function dataGroupIntegrity(
  report: PassiveAuthenticationReport | null,
  group: DataGroupNumber,
): DataIntegrity {
  if (report?.integrity === 'broken') {
    return 'broken';
  }
  return report?.integrity === 'established' && report.dataGroups[group] === 'identical'
    ? 'established'
    : 'not_established';
}

export interface Verdict {
  readonly status: CheckStatus;
  readonly reasons: readonly string[];
}

const WITHHELD: Verdict = { status: 'not_applicable', reasons: [INTEGRITY_NOT_ESTABLISHED] };

/** The C62.4 rule over one check's own verdict. */
export function onIntegrity(integrity: DataIntegrity, verdict: Verdict): Verdict {
  if (integrity === 'broken' || (integrity === 'not_established' && verdict.status === 'passed')) {
    return { status: WITHHELD.status, reasons: [...WITHHELD.reasons] };
  }
  return verdict;
}
