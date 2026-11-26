/**
 * C166.5, C166.6 (Workflow 9D, K9-21): a bulk report job's codes in words, the code kept beside them.
 * A failed row carries a report problem's own code (`REPORT_PROBLEM_CODES`, worded by
 * `REPORT_PROBLEM_WORDS`), a CSV reader's code (`IMPORT_ERROR_CODES`, worded here for this file), or
 * one the job gives by status; a whole-file refusal carries the job's own code. Both lists are typed
 * by the contracts' code lists, so a code they add without words fails the typecheck; a code no
 * list holds is shown as itself, "not described".
 */
import type { ImportErrorCode } from '@openverify/core';
import { REPORT_BULK_LIMITS } from '@openverify/contracts';
import { REPORT_PROBLEM_WORDS } from '../../lib/report-problem-words';

/** C100.4's reader codes, as they read for a bulk report file (at most 1,000 rows). */
const CSV_WORDS: Readonly<Record<ImportErrorCode, string>> = Object.freeze({
  invalid_encoding: 'The file is not UTF-8 text.',
  missing_column: 'A column this report type needs is missing from the header.',
  unknown_column: 'The header has a column this report type does not take.',
  duplicate_column: 'The header names a column twice.',
  row_limit_exceeded: `The file has more than ${REPORT_BULK_LIMITS.rows.toLocaleString('en-US')} rows.`,
  record_too_large: 'A row is longer than the reader takes.',
  field_count_mismatch: 'A row has more or fewer cells than the header.',
  invalid_value: 'A value is not valid for its column.',
  unparseable_phone: 'A phone number cannot be read.',
  host_bits_set: 'An address range has host bits set.',
  out_of_range: 'A value is outside its allowed range.',
  unsupported_class: 'An ID class is not one of the government ID classes.',
});

/** The codes the job gives itself: a row's failure by status, and the whole-file refusals. */
const JOB_WORDS: Readonly<Record<string, string>> = Object.freeze({
  not_found: 'Something the row names was not found: the template, an account or an inquiry.',
  conflict: 'The row conflicts with the current state of what it names.',
  redacted: 'Something the row names was redacted.',
  report_create_failed: 'The report could not be created; nothing more is recorded.',
  report_bulk_file_unreadable:
    'The file is gone or no longer opens: a file is deleted when its job ends or after 24 hours.',
  report_bulk_file_refused:
    'The file no longer reads as it did at the upload: the template’s report type may have changed.',
  report_runs_unavailable: 'This installation runs no reports, so none could be created.',
});

const WORDS: Readonly<Record<string, string>> = Object.freeze({
  ...JOB_WORDS,
  ...CSV_WORDS,
  ...REPORT_PROBLEM_WORDS,
});

/** A code in words with the code beside them, or the code alone, "not described". */
export function bulkCodeWords(code: string): string {
  return Object.hasOwn(WORDS, code) ? `${WORDS[code] ?? ''} (${code})` : `${code}: not described`;
}
