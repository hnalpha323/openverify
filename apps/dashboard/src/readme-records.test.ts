// @vitest-environment node
/**
 * Owner decision 26 after Workflow 6B (P5-8): the README describes the records evidence views
 * (database, AAMVA, business registry, business website) in a table, as it does the people types,
 * and each row's "What a pass means" says only what the view's own pass line says, so a README row
 * that drifts from the console's words fails here.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AAMVA_PASS_MEANING } from './lib/aamva-words';
import { BUSINESS_WEBSITE_PASS_MEANING } from './lib/business-website-words';
import { DATABASE_BUSINESS_PASS_MEANING } from './lib/database-business-words';
import { DATABASE_PASS_MEANING } from './lib/database-words';

const README = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

const HEADING = '**The records types** (`dashboard-records`):';

/** The rows of the records table: its cells, trimmed, by the type in the first cell. */
function recordsRows(): Map<string, readonly string[]> {
  const start = README.indexOf(HEADING);
  if (start < 0) {
    throw new Error(`README.md has no "${HEADING}" table`);
  }
  const lines = README.slice(start + HEADING.length)
    .split('\n')
    .map((line) => line.trim());
  const table = lines.slice(lines.findIndex((line) => line.startsWith('|')));
  const rows = table.slice(
    0,
    table.findIndex((line) => !line.startsWith('|')),
  );
  return new Map(
    rows.slice(2).map((row) => {
      const cells = row
        .slice(1, -1)
        .split(' | ')
        .map((cell) => cell.trim());
      return [cells[0] ?? '', cells];
    }),
  );
}

/** Each sentence of `text`, without markdown ticks and its full stop, lower-cased. */
const sentences = (text: string) =>
  text
    .replaceAll('`', '')
    .split(/(?<=\.) /)
    .map((sentence) => sentence.replace(/\.$/, '').toLowerCase())
    .filter((sentence) => sentence !== '');

const VIEWS = [
  ['Database', 'components/evidence/database.tsx', DATABASE_PASS_MEANING],
  ['AAMVA', 'components/evidence/aamva.tsx', AAMVA_PASS_MEANING],
  [
    'Business registry',
    'components/evidence/database-business.tsx',
    DATABASE_BUSINESS_PASS_MEANING,
  ],
  ['Business website', 'components/evidence/business-website.tsx', BUSINESS_WEBSITE_PASS_MEANING],
] as const;

describe('the README rows of the records evidence views (owner decision 26, P5-8)', () => {
  it('has one row per records view, in a table headed as the people types are', () => {
    const start = README.indexOf(HEADING);
    expect(start, 'the records table heading').toBeGreaterThan(0);
    expect(README.slice(start)).toContain(
      '| Type | Evidence | What a pass means (from `docs/checks`) |',
    );
    expect([...recordsRows().keys()]).toEqual(VIEWS.map(([type]) => type));
  });

  it.each(VIEWS)('describes the %s evidence and names its view, %s', (type, view) => {
    const [, evidence = ''] = recordsRows().get(type) ?? [];
    expect(evidence.length).toBeGreaterThan(40);
    expect(README).toContain(`\`${view}\``);
  });

  it.each(VIEWS)(
    'says of a %s pass only what the view’s pass line says',
    (type, _view, meaning) => {
      const [, , pass = ''] = recordsRows().get(type) ?? [];
      expect(sentences(pass).length).toBeGreaterThan(0);
      for (const sentence of sentences(pass)) {
        expect(meaning.toLowerCase(), `${type}: ${sentence}`).toContain(sentence);
      }
    },
  );

  it('says what each pass does not show, as each view does', () => {
    for (const [type] of VIEWS) {
      const [, , pass = ''] = recordsRows().get(type) ?? [];
      expect(pass, type).toMatch(/does not|Neither/);
    }
  });
});
