'use client';

import { Button } from '@openverify/ui';
import { csvText } from '../../lib/analytics-csv';
import { ANALYTICS_COPY } from '../../lib/copy/analytics';

const WORDS = ANALYTICS_COPY.download;

export interface AnalyticsDownloadProps {
  /** The file's name, such as `analytics-overview-2026-10-01-to-2026-10-30.csv`. */
  readonly fileName: string;
  /** The rows before the figures: the definitions, denominators, time zone and freshness. */
  readonly preamble: readonly (readonly string[])[];
  /** The id of the element whose tables the file holds. */
  readonly tablesId: string;
}

/** What an element says, without the parts hidden from assistive technology (icons). */
function textOf(node: Node): string {
  if (node instanceof Element && node.getAttribute('aria-hidden') === 'true') {
    return '';
  }
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? '';
  }
  return [...node.childNodes].map(textOf).join('');
}

const cellText = (cell: Element) => textOf(cell).replace(/\s+/gu, ' ').trim();

/** One table as records: its caption, its column headers, then each row's cells. */
function recordsOf(table: HTMLTableElement): string[][] {
  const caption = table.caption === null ? [] : [[cellText(table.caption)]];
  const rows = [...table.rows].map((row) => [...row.cells].map(cellText));
  return [...caption, ...rows];
}

/**
 * C164 (Workflow 9D, K9-18): the view's figures as a CSV file made in the browser from the tables
 * the page already shows, which are built from the suppressed answer only: a small count is its
 * "fewer than" mark, a complementary cell "hidden", never a value the table hides, and nothing is
 * read from the API again. The file starts with what the figures mean (the definitions and their
 * denominators, the time zone, the window and the freshness). A table that names people (the cases
 * per reviewer) is left out, and the file says so. Cells are written so a spreadsheet never runs one
 * as a formula.
 */
export function AnalyticsDownload({ fileName, preamble, tablesId }: AnalyticsDownloadProps) {
  function download() {
    const scope = document.getElementById(tablesId);
    const tables = scope === null ? [] : [...scope.querySelectorAll('table')];
    const kept = tables.filter(
      (table) => table.closest('[data-analytics-download="omit"]') === null,
    );
    const left = tables
      .filter((table) => !kept.includes(table))
      .map((table) => (table.caption === null ? '' : cellText(table.caption)));
    const records: string[][] = [
      ...preamble.map((row) => [...row]),
      ...left.map((caption) => [WORDS.leftOut, caption, WORDS.leftOutReason]),
      ...kept.flatMap((table) => [[], ...recordsOf(table)]),
    ];
    const blob = new Blob([csvText(records.filter((record) => record.length > 0))], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-1">
      <Button type="button" variant="secondary" onClick={download} className="self-start">
        {WORDS.button}
      </Button>
      <p className="text-sm text-ink-muted">{WORDS.description}</p>
    </div>
  );
}
