/**
 * The console's CSV writer (C100.6), for the files it offers to download: every field quoted,
 * embedded quotes doubled, and an apostrophe before a cell that starts with `=`, `+`, `-`, `@`, a
 * tab, CR, LF or their full-width forms, or with apostrophes and then one of them, as the API's
 * shared writer does (`packages/checks/src/csv/`; list-logic amendment 9). The dashboard has no
 * dependency on that package, so the rule is repeated here with the same golden vectors. No escape
 * is safe in every spreadsheet (OWASP).
 */

const FORMULA_START = /^'*[=+\-@\t\r\n＝＋－＠]/u;

/** `text` with a leading apostrophe when a spreadsheet could read it as a formula. */
export function neutraliseCell(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

const quote = (text: string) => `"${text.replaceAll('"', '""')}"`;

/** The rows as CSV, each line ended by CRLF; `null` is an empty cell, a number is written plainly. */
export function csvOf(rows: readonly (readonly (string | number | null)[])[]): string {
  return rows
    .map(
      (row) =>
        `${row
          .map((cell) =>
            quote(
              cell === null ? '' : typeof cell === 'number' ? String(cell) : neutraliseCell(cell),
            ),
          )
          .join(',')}\r\n`,
    )
    .join('');
}
