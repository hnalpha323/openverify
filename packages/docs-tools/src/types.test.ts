import { describe, expect, it } from 'vitest';
import { AREA_CONTRACTS, AREA_OWNERS, DOCS_AREAS } from './types.js';

describe('the areas', () => {
  it('are the six of Workflow 11E, each with its owner and its contracts', () => {
    expect(DOCS_AREAS).toEqual([
      'security',
      'records',
      'selfhost',
      'compliance',
      'catalog',
      'release',
    ]);
    expect(Object.keys(AREA_OWNERS).sort()).toEqual([...DOCS_AREAS].sort());
    expect(Object.keys(AREA_CONTRACTS).sort()).toEqual([...DOCS_AREAS].sort());
    for (const area of DOCS_AREAS) {
      expect(AREA_OWNERS[area]).toBe(`docs-${area}`);
      expect(AREA_CONTRACTS[area].length).toBeGreaterThan(0);
    }
  });
});
