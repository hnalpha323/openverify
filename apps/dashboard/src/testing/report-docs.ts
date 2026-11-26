/**
 * C86: a section of a `docs/reports/<page>.md`, read at test time, so a console line that stops
 * saying what the docs say fails its test. Markdown emphasis, code ticks and table pipes are
 * removed and white space collapsed.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Not `new URL(…, import.meta.url)`, which Vite rewrites into an asset URL.
const REPORT_DOCS = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'docs',
  'reports',
);

/** The text of the section `heading` of `docs/reports/<page>`, as plain words. */
export function reportDocsSection(page: string, heading: string): string {
  const text = readFileSync(join(REPORT_DOCS, page), 'utf8');
  const marker = `\n## ${heading}\n`;
  const start = text.indexOf(marker);
  if (start < 0) {
    throw new Error(`${page} has no "${heading}" section`);
  }
  const end = text.indexOf('\n## ', start + marker.length);
  return text
    .slice(start + marker.length, end < 0 ? undefined : end)
    .replaceAll('**', '')
    .replaceAll('`', '')
    .replaceAll('|', ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
