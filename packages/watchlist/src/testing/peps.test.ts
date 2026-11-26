import { describe, expect, it } from 'vitest';
import { watchlistRecordSchema } from '../record/index.js';
import { SYNTHETIC_POSITION_LABELS, syntheticPeps } from './peps.js';

describe('syntheticPeps', () => {
  it('writes fictional office holders valid under the frozen schema', () => {
    const peps = syntheticPeps({ seed: 'peps' });
    expect(peps).toHaveLength(10);
    expect(peps[0]?.entry_id).toBe('Q-test-5001');
    for (const pep of peps) {
      expect(() => watchlistRecordSchema.parse(pep)).not.toThrow();
      expect(pep.kind).toBe('individual');
      expect(pep.entry_id).toMatch(/^Q-test-\d+$/);
      expect(pep.positions.length).toBeGreaterThanOrEqual(1);
      expect(pep.positions.length).toBeLessThanOrEqual(2);
      expect(pep.programs).toEqual([]);
      expect(pep.relations).toEqual([]);
      for (const position of pep.positions) {
        expect(position.position).toMatch(/^Q-test-9\d{3,}$/);
        const pepClass = position.pep_class;
        expect(pepClass).not.toBeNull();
        if (pepClass !== null) {
          expect(SYNTHETIC_POSITION_LABELS[pepClass as 1 | 2 | 3 | 4]).toContain(position.label);
        }
        expect(position.start).not.toBeNull();
        if (position.end === null) {
          expect(position.in_office).toBe('yes');
        } else {
          expect(position.in_office).toBe('no');
          expect(position.end >= (position.start ?? '')).toBe(true);
        }
      }
    }
  });

  it('cycles through the four public classes and is reproducible', () => {
    const peps = syntheticPeps({ seed: 'classes', count: 8 });
    const classes = new Set(peps.map((pep) => pep.positions[0]?.pep_class));
    expect(classes).toEqual(new Set([1, 2, 3, 4]));
    expect(syntheticPeps({ seed: 'classes', count: 8 })).toEqual(peps);
    for (const pepClass of [1, 2, 3, 4] as const) {
      expect(SYNTHETIC_POSITION_LABELS[pepClass].length).toBeGreaterThanOrEqual(3);
    }
  });

  it('numbers holders from firstNumber with unique ids and names', () => {
    const peps = syntheticPeps({ seed: 'many', count: 120, firstNumber: 7001 });
    expect(peps[0]?.entry_id).toBe('Q-test-7001');
    expect(new Set(peps.map((pep) => pep.entry_id)).size).toBe(120);
    expect(new Set(peps.map((pep) => pep.names[0]?.full)).size).toBe(120);
  });
});
