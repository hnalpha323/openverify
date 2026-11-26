/** Markdown helpers for docs-catalog's generated pages: tables and code spans, deterministic. */

/** A table cell: pipes escaped, line breaks folded. */
export function cell(text: string): string {
  return text.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

/** A code span. */
export function code(text: string): string {
  return `\`${text}\``;
}

/** A GitHub-flavoured table: a header row, a rule and one row per entry. */
export function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]): string => `| ${cells.map(cell).join(' | ')} |`;
  return [line(headers), `|${headers.map(() => '---').join('|')}|`, ...rows.map(line)].join('\n');
}

/** `items` joined with commas, or `none`. */
export function list(items: readonly string[], empty = 'none'): string {
  return items.length === 0 ? empty : items.join(', ');
}

/** Sorted by the plain string order (no locale), so a render never depends on the host. */
export function sorted<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => {
    const left = key(a);
    const right = key(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}
