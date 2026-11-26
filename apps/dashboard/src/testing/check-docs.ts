/**
 * C66: the "What a pass means" section of a `docs/checks/<page>.md`, read at test time, so a
 * console line that stops saying what the docs say fails its test. Markdown emphasis is removed
 * and white space collapsed.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Not `new URL(…, import.meta.url)`, which Vite rewrites into an asset URL.
const CHECK_DOCS = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'docs',
  'checks',
);

const HEADING = '\n## What a pass means\n';

/** The text of the "What a pass means" section of `docs/checks/<page>`, as plain words. */
export function passMeansSection(page: string): string {
  const text = readFileSync(join(CHECK_DOCS, page), 'utf8');
  const start = text.indexOf(HEADING);
  if (start < 0) {
    throw new Error(`${page} has no "What a pass means" section`);
  }
  const end = text.indexOf('\n## ', start + HEADING.length);
  return text
    .slice(start + HEADING.length, end < 0 ? undefined : end)
    .replaceAll('**', '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The sentences of a line: it is split after each full stop that a space follows. */
export function sentencesOf(line: string): string[] {
  return line.split(/(?<=\.) /);
}
