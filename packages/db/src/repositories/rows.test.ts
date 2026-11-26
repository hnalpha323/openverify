import { describe, expect, it } from 'vitest';
import { firstOrNull, inserted } from './rows.js';

describe('row helpers', () => {
  it('returns the first row or null', () => {
    expect(firstOrNull([1, 2])).toBe(1);
    expect(firstOrNull([])).toBeNull();
  });

  it('returns the inserted row and fails loudly when there is none', () => {
    expect(inserted(['row'], 'createThing')).toBe('row');
    expect(() => inserted([], 'createThing')).toThrow('createThing: the database returned no row');
  });
});
