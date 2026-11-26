/**
 * Generated blocks inside the guide's hand-written pages (C277; Workflow 11E, docs-selfhost): a
 * page holds `<!-- openverify:<name>:start -->` and `<!-- openverify:<name>:end -->`, and
 * `docs:selfhost` replaces what lies between them with a render from the repository's facts (the
 * load report's summary block, the metric registry, the migration files), so the figures a page
 * quotes cannot drift. The prose around a block stays hand-written.
 */

/** The start marker of block `name`. */
export function blockStart(name: string): string {
  return `<!-- openverify:${name}:start -->`;
}

/** The end marker of block `name`. */
export function blockEnd(name: string): string {
  return `<!-- openverify:${name}:end -->`;
}

/** How often `needle` occurs in `text`. */
function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/**
 * `text` with block `name`'s body replaced by `body` (each marker on its own line, the body
 * between them); `null` when the markers are not there exactly once each, start before end.
 */
export function spliceBlock(text: string, name: string, body: string): string | null {
  const start = blockStart(name);
  const end = blockEnd(name);
  if (occurrences(text, start) !== 1 || occurrences(text, end) !== 1) {
    return null;
  }
  const from = text.indexOf(start);
  const to = text.indexOf(end);
  if (to < from) {
    return null;
  }
  return `${text.slice(0, from)}${start}\n${body}\n${text.slice(to)}`;
}
