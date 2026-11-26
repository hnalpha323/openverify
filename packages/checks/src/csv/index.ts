/**
 * C100.6 (Workflow 7B, owner `list-logic`): the shared CSV writer over `csv-stringify`: quote every
 * field, double embedded quotes, and prefix `'` to a cell starting with `=`, `+`, `-`, `@`, tab, CR,
 * LF or the full-width `＝＋－＠`, as a `cast` hook of our own, because `escape_formulas` misses LF
 * and the full-width forms. Golden vectors from OWASP's list. The graph export uses it (C103).
 *
 * The prefix also goes before a cell that already starts with apostrophes and then a formula
 * character (`'=x` is written `''=x`): the importer strips one apostrophe (C100.5), so without it
 * such a value would come back changed. Numbers and booleans are written as they are: their text
 * is ours, and a negative number is no formula.
 *
 * OWASP warns that no escape is safe for every spreadsheet and every parser downstream: Excel can
 * drop quotes when a file is saved and opened again, which re-arms a neutralised cell.
 */
import { stringify } from 'csv-stringify/sync';

export * from './read.js';

/** The area this folder holds. */
export const CSV_AREA = 'csv';

/** A value the writer neutralises: any apostrophes, then a formula character. */
const FORMULA_CELL = /^'*[=+\-@\t\r\n＝＋－＠]/u;
/** A cell the writer neutralised: at least one apostrophe, then a formula character. */
const NEUTRALISED_CELL = /^'+[=+\-@\t\r\n＝＋－＠]/u;

/** A cell with the leading `'` a spreadsheet needs, when it starts with a formula character. */
export function neutraliseCell(value: string): string {
  return FORMULA_CELL.test(value) ? `'${value}` : value;
}

/** The importer's reverse: strips one leading `'` before a formula character (C100.5). */
export function stripNeutraliser(value: string): string {
  return NEUTRALISED_CELL.test(value) ? value.slice(1) : value;
}

/**
 * The CSV text of `rows` under `header`, every cell quoted and neutralised, one RFC 4180 record per
 * row (CRLF, the last one too). A `null` is an empty cell.
 * @throws {TypeError} for a row that does not fit the header: a shifted column is never written.
 */
export function writeCsv(
  header: readonly string[],
  rows: readonly (readonly (string | number | boolean | null)[])[],
): string {
  if (rows.some((row) => row.length !== header.length)) {
    throw new TypeError('A CSV row must have one cell per column of the header');
  }
  return stringify([header, ...rows], {
    quoted: true,
    quoted_empty: true,
    record_delimiter: '\r\n',
    cast: {
      string: neutraliseCell,
      number: (value) => String(value),
      boolean: (value) => String(value),
    },
  });
}
