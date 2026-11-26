/** C69.5 (H22): every item of the research gap table has a recorded Phase 6 choice. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPORT_PARITY, REPORT_PARITY_ITEMS } from './report-parity.js';

const RESEARCH = path.resolve(import.meta.dirname, '../../../docs/research/phase6-behaviour.md');

/** The ids of the gap table's rows (G, M, V, T and X), as the research note writes them. */
function gapTableIds(): string[] {
  const ids = readFileSync(RESEARCH, 'utf8')
    .split('\n')
    .map((line) => /^\| ([GMVTX][0-9]{1,2}) \|/u.exec(line)?.[1])
    .filter((id): id is string => id !== undefined);
  return [...new Set(ids)];
}

describe('REPORT_PARITY (C69.5)', () => {
  it('covers every gap-table item exactly once', () => {
    const ids = gapTableIds();
    expect(ids.length).toBeGreaterThanOrEqual(40);
    expect([...REPORT_PARITY_ITEMS].sort()).toEqual([...ids].sort());
    const listed = REPORT_PARITY.flatMap((row) => row.items);
    expect(new Set(listed).size).toBe(listed.length);
  });

  it('states the public behaviour and our choice in each row', () => {
    for (const row of REPORT_PARITY) {
      expect(row.items.length, row.publicBehaviour).toBeGreaterThan(0);
      expect(row.publicBehaviour.length).toBeGreaterThan(0);
      expect(row.choice.length).toBeGreaterThan(0);
      expect(`${row.publicBehaviour} ${row.choice}`).not.toMatch(/persona/i);
    }
    expect(Object.isFrozen(REPORT_PARITY)).toBe(true);
  });
});
