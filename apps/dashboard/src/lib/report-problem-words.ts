/**
 * Report problems in words (C72.4, C86): what each report problem `code` means for the operator
 * who met it. The API titles a problem with its HTTP status ("Conflict"), so a refused report
 * action is titled with these words instead; `describeReportProblem` keeps the API's detail,
 * field errors and request id. Its test iterates `REPORT_PROBLEM_CODES` first.
 */
import { REPORT_PROBLEM_CODES, type ReportProblemCode } from '@openverify/contracts';
import type { DisplayProblem } from './action-state';

export const REPORT_PROBLEM_WORDS: Readonly<Record<ReportProblemCode, string>> = Object.freeze({
  report_query_invalid: 'The query does not fit this report type.',
  report_template_not_published:
    'The report template has no published version: it is unknown, archived or never published.',
  report_type_mismatch: 'The report template is of another report type.',
  report_not_reviewable: 'This report has no match to review yet.',
  report_not_recurrable: 'This report type does not recur, so it cannot run again.',
  report_no_scheduled_run:
    'Monitoring is not in that state: only an upcoming run can be paused, and only a paused report resumed.',
  report_match_not_found: 'That match is not in this report, or no match is open to act on.',
  report_match_superseded:
    'A later match of the same entry replaced this one: review that match instead.',
  report_redacted: 'This report was redacted, so it can no longer change.',
  report_recurring_limit:
    'This environment holds its cap of recurring reports, or of scheduled media runs a day.',
  watchlist_source_unknown: 'A selected list is not one of the watchlist sources.',
  watchlist_source_not_allowed: 'A sandbox-only list cannot be used in production.',
  watchlist_sources_empty: 'No list is selected, so nothing would be screened.',
});

const CODES: ReadonlySet<string> = new Set(REPORT_PROBLEM_CODES);

/** `problem`, titled in words when its `code` is a report problem's; anything else unchanged. */
export function describeReportProblem(problem: DisplayProblem): DisplayProblem {
  if (problem.code === undefined || !CODES.has(problem.code)) {
    return problem;
  }
  return { ...problem, title: REPORT_PROBLEM_WORDS[problem.code as ReportProblemCode] };
}

/**
 * Owner decision 16 after 6B: a review or dismissal needs `pii:view` beside `reports:review`, in
 * the console and in the API, because without it the matches are served `null` and nobody decides
 * on evidence they cannot see.
 */
export const REVIEW_NEEDS_PII_VIEW: DisplayProblem = Object.freeze({
  title: 'You do not have access',
  detail:
    'Reviewing or dismissing a match needs pii:view as well as reports:review: without it the matches are hidden from you, and nobody decides on evidence they cannot see. Ask an administrator for a role with both.',
});
