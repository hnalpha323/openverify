/**
 * A report's result as the console says it (C69.4, C86): "Match", "No match" only beside
 * `ready`, "Not screened" for an errored report (never "no match"), "Match; not fully screened"
 * for a partial run that kept its matches (H01), and the coverage beside it (C78.5).
 */
import {
  REPORT_REGISTRY,
  type ReportCoverageLimit,
  type ReportStatus,
  type ReportType,
} from '@openverify/core';

export type ReportResult =
  'pending' | 'match' | 'no-match' | 'match-not-screened' | 'not-screened' | 'computed';

export const REPORT_RESULT_LABELS: Readonly<Record<ReportResult, string>> = Object.freeze({
  pending: 'Not run yet',
  match: 'Match',
  'no-match': 'No match',
  'match-not-screened': 'Match; not fully screened',
  'not-screened': 'Not screened',
  computed: 'Fields computed',
});

/** C78.5: each coverage limit in a few words, for a list cell ("Limited: lossy script"). */
export const REPORT_COVERAGE_LIMIT_LABELS: Readonly<Record<ReportCoverageLimit, string>> =
  Object.freeze({
    lossy_script: 'Lossy script',
    not_compared: 'Not compared',
    truncated: 'Truncated',
    unclassified_format: 'Unclassified format',
    title_only: 'Titles only',
    window_90_days: 'Last 90 days only',
    lexicon_languages: 'Four languages only',
  });

/** The result of a report of `type` in `status`. */
export function reportResultOf(
  type: ReportType,
  status: ReportStatus,
  hasMatch: boolean,
): ReportResult {
  if (status === 'pending' || status === 'submitted') {
    return 'pending';
  }
  const review = REPORT_REGISTRY[type].review === 'matches';
  if (status === 'errored') {
    return review && hasMatch ? 'match-not-screened' : 'not-screened';
  }
  return review ? (hasMatch ? 'match' : 'no-match') : 'computed';
}

/** The coverage in a few words: complete, limited (and how), or `null` for a type without it. */
export function coverageText(
  coverage: { readonly complete: boolean; readonly limits: readonly ReportCoverageLimit[] } | null,
): string | null {
  if (coverage === null) {
    return null;
  }
  if (coverage.complete && coverage.limits.length === 0) {
    return 'Complete';
  }
  const limits = coverage.limits.map((limit) => REPORT_COVERAGE_LIMIT_LABELS[limit].toLowerCase());
  return limits.length === 0 ? 'Limited' : `Limited: ${limits.join(', ')}`;
}
