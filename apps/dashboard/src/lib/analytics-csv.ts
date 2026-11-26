/**
 * C164 (Workflow 9D, K9-18): the CSV text of an analytics view's download. Every cell is quoted, an
 * embedded quote doubled, every record ends with CRLF, and a cell a spreadsheet would run as a
 * formula (`=`, `+`, `-`, `@`, tab, CR, LF, or their full-width forms, after any apostrophes) gets a
 * leading `'`, the rule of the shared writer the translations and export CSVs use
 * (`packages/checks/src/csv/`, C100.6), which the console does not depend on.
 */

/** A value the writer neutralises: any apostrophes, then a formula character. */
const FORMULA_CELL = /^'*[=+\-@\t\r\n＝＋－＠]/u;

/** A cell with the leading `'` a spreadsheet needs, when it starts with a formula character. */
export function neutraliseCell(value: string): string {
  return FORMULA_CELL.test(value) ? `'${value}` : value;
}

/** The CSV text of `rows`, one RFC 4180 record per row (CRLF, the last one too). */
export function csvText(rows: readonly (readonly string[])[]): string {
  return rows
    .map((row) => row.map((cell) => `"${neutraliseCell(cell).replaceAll('"', '""')}"`).join(','))
    .map((record) => `${record}\r\n`)
    .join('');
}
