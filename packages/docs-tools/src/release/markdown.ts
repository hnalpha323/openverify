/**
 * Small Markdown readers the release area shares (docs-release, C284): a document's tables, a
 * section by its heading, and the backticked tokens of a cell. No Markdown library: the records
 * are tables and lists the project writes itself.
 */

/** One table row with the line (1-based) it is on. */
export interface TableRow {
  readonly line: number;
  readonly cells: readonly string[];
}

/** A Markdown table: its header cells, its rows, the line of its header and the heading above it. */
export interface Table {
  readonly line: number;
  readonly section: string;
  readonly header: readonly string[];
  readonly rows: readonly TableRow[];
}

const FENCE = /^\s*(?:```|~~~)/;
const SEPARATOR_CELL = /^:?-+:?$/;
const HEADING = /^(#{1,6})\s+(.*)$/;

/** The cells of a table row `| a | b |`, or `null` when `line` is not a row. */
export function splitRow(line: string): readonly string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|') || trimmed.length < 2) {
    return null;
  }
  const cells: string[] = [];
  let current = '';
  let inCode = false;
  const body = trimmed.slice(1, -1);
  for (let index = 0; index < body.length; index += 1) {
    const char = body.charAt(index);
    if (char === '\\' && body[index + 1] === '|' && !inCode) {
      current += '|';
      index += 1;
    } else if (char === '`') {
      inCode = !inCode;
      current += char;
    } else if (char === '|' && !inCode) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

/** Whether `separator` is the `|---|` row of a table whose header has `header`'s cells. */
function isSeparatorOf(header: readonly string[], separator: readonly string[] | null): boolean {
  return (
    separator !== null &&
    separator.length === header.length &&
    separator.every((cell) => SEPARATOR_CELL.test(cell))
  );
}

/** Every table in `text`, in order. */
export function tablesOf(text: string): readonly Table[] {
  const lines = text.split('\n');
  const tables: Table[] = [];
  let section = '';
  let fenced = false;
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? '';
    if (FENCE.test(raw)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      continue;
    }
    const heading = HEADING.exec(raw);
    if (heading !== null) {
      section = (heading[2] ?? '').trim();
      continue;
    }
    const header = splitRow(raw);
    const separator = splitRow(lines[index + 1] ?? '');
    if (header === null || !isSeparatorOf(header, separator)) {
      continue;
    }
    const rows: TableRow[] = [];
    let next = index + 2;
    for (; next < lines.length; next += 1) {
      const cells = splitRow(lines[next] ?? '');
      if (cells === null) {
        break;
      }
      rows.push({ line: next + 1, cells });
    }
    tables.push({ line: index + 1, section, header, rows });
    index = next - 1;
  }
  return tables;
}

/**
 * The lines under the heading whose text is exactly `heading` (with its `#` marks), up to the next
 * heading of its level or above.
 */
export function sectionOf(
  text: string,
  heading: string,
): { readonly line: number; readonly lines: readonly string[] } | null {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trimEnd() === heading);
  const level = HEADING.exec(heading)?.[1]?.length;
  if (start < 0 || level === undefined) {
    return null;
  }
  const body: string[] = [];
  let fenced = false;
  for (const line of lines.slice(start + 1)) {
    if (FENCE.test(line)) {
      fenced = !fenced;
    }
    const match = fenced ? null : HEADING.exec(line);
    if (match !== null && (match[1]?.length ?? 7) <= level) {
      break;
    }
    body.push(line);
  }
  return { line: start + 1, lines: body };
}

/** The backticked spans of `text`, in order. */
export function backticked(text: string): readonly string[] {
  return [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? '');
}
