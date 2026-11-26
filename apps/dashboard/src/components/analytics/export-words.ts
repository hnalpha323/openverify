/**
 * Exports in words (C166.6): what an export holds as the API recorded it (its row count and the
 * filter's shape, never a value), its state and how long its file is kept.
 */
import type { ExportResource } from '@openverify/contracts';
import { EXPORT_LIMITS, type ExportObjectType, type ExportStatus } from '@openverify/core';

export const EXPORT_TYPE_WORDS: Readonly<Record<ExportObjectType, string>> = Object.freeze({
  inquiries: 'Inquiries',
  verifications: 'Verifications',
  accounts: 'Accounts',
  reports: 'Reports',
  lists: 'List items',
  transactions: 'Transactions',
});

export const EXPORT_STATUS_WORDS: Readonly<Record<ExportStatus, string>> = Object.freeze({
  pending: 'Waiting to start',
  running: 'Being written',
  completed: 'Ready to download',
  failed: 'Failed',
  expired: 'Deleted after 24 hours',
});

/** A failure's code in words; an unknown code is shown as it is. */
export function exportFailureWords(code: string | null): string {
  if (code === 'export_too_large') {
    return `Refused: more than ${EXPORT_LIMITS.rows.toLocaleString('en-US')} rows (never cut short). Narrow the filter.`;
  }
  return code === null ? 'Failed' : `Failed: ${code}`;
}

const rowsWords = (count: number) =>
  `${count.toLocaleString('en-US')} ${count === 1 ? 'row' : 'rows'}`;

/** The filter's shape: its keys, or "every row the saved view selects". */
function filterWords(attributes: ExportResource['attributes']): string {
  if (attributes['saved-view-id'] !== null) {
    return `the filters of saved view ${attributes['saved-view-id']}`;
  }
  const keys = attributes['filter-keys'];
  return keys.length === 0 ? 'no filter' : `filtered by ${keys.join(', ')}`;
}

/** What an export holds, once written; a failure says why, an unwritten one says so. */
export function exportHoldsWords(attributes: ExportResource['attributes']): string {
  if (attributes.status === 'failed') {
    return exportFailureWords(attributes['error-code']);
  }
  const count = attributes['row-count'];
  const rows = count === null ? 'Rows not known until it is written' : rowsWords(count);
  return `${rows}, ${filterWords(attributes)}`;
}

/** How long its file is kept, in words. */
export function exportKeptWords(
  attributes: ExportResource['attributes'],
  format: (timestamp: string) => string,
): string {
  const expires = attributes['expires-at'];
  if (attributes.status === 'expired') {
    return expires === null ? 'Deleted' : `Deleted ${format(expires)} UTC`;
  }
  if (attributes.status === 'failed') {
    return 'No file';
  }
  return expires === null
    ? '24 hours after it is written'
    : `Until ${format(expires)} UTC, 24 hours after it was written`;
}
