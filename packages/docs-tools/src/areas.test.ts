import { describe, expect, it } from 'vitest';
import { AREAS } from './areas.js';
import { DOCS_AREAS } from './types.js';

describe('the CLI entry points', () => {
  it('has a render and a check for every area', () => {
    expect(Object.keys(AREAS).sort()).toEqual([...DOCS_AREAS].sort());
    for (const area of DOCS_AREAS) {
      expect(typeof AREAS[area].render).toBe('function');
      expect(typeof AREAS[area].check).toBe('function');
    }
  });
});
