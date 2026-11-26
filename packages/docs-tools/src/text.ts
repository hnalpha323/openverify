/**
 * Splitting a document into the units the wording rules read (contracts-11e): a Markdown
 * paragraph's wrapped lines are joined, a list item, table row, heading, quote, code line or CSV
 * row is a unit of its own, and each unit is cut into sentences. Every unit keeps the line it
 * starts on, so a finding names its line.
 */

/** One sentence and the line (1-based) its unit starts on. */
export interface Sentence {
  readonly line: number;
  readonly text: string;
}

/** A line that starts a unit of its own: a list item, a table row, a heading, a quote. */
const STANDALONE = /^\s*(?:[-*+]\s|\d+[.)]\s|#|\||>)/;
/** A list item's marker, left out before the item is cut into sentences. */
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/;
const FENCE = /^\s*(?:```|~~~)/;
/** A sentence ends at `.`, `!`, `?` or `;` followed by white space. */
const SENTENCE_END = /(?<=[.!?;])\s+/;

/**
 * The sentences of `text`; `rowsOnly` treats every line as its own unit (CSV, YAML, NOTES), and
 * `withCode: false` leaves fenced code out (the wording rule reads prose, not tool output).
 */
export function sentencesOf(text: string, rowsOnly = false, withCode = true): readonly Sentence[] {
  const units: Sentence[] = [];
  let current: { line: number; parts: string[] } | null = null;
  let fenced = false;
  const flush = (): void => {
    if (current !== null) {
      units.push({ line: current.line, text: current.parts.join(' ') });
      current = null;
    }
  };
  text.split('\n').forEach((raw, index) => {
    const line = index + 1;
    if (FENCE.test(raw)) {
      flush();
      fenced = !fenced;
      return;
    }
    if (raw.trim() === '') {
      flush();
      return;
    }
    if (fenced && !withCode) {
      return;
    }
    if (rowsOnly || fenced || STANDALONE.test(raw)) {
      flush();
      units.push({ line, text: raw.replace(LIST_MARKER, '').trim() });
      return;
    }
    current ??= { line, parts: [] };
    current.parts.push(raw.trim());
  });
  flush();
  return units.flatMap((unit) =>
    unit.text
      .split(SENTENCE_END)
      .filter((part) => part !== '')
      .map((part) => ({ line: unit.line, text: part })),
  );
}

/** Whether `path` is read as rows (one unit per line) rather than as prose. */
export function readAsRows(path: string): boolean {
  return /\.(?:csv|txt|ya?ml)$/.test(path);
}
