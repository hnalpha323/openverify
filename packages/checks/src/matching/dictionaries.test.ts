import { describe, expect, it } from 'vitest';
import { canonicalsOf, phraseAt, phraseEndingAt } from './dictionaries.js';

describe('canonicalsOf', () => {
  it('gives every canonical form a folded phrase stands for, by role', () => {
    expect(canonicalsOf('street-types', 'st')).toContain('street');
    expect(canonicalsOf('personal-titles', 'st')).toContain('saint');
    expect(canonicalsOf('street-types', 'street')).toContain('street');
    // apt is apartment, apartamento and appartement: the classes of every language are kept.
    expect(canonicalsOf('unit-types', 'apt')).toContain('apartment');
  });

  it('gives nothing for a phrase in no class', () => {
    expect(canonicalsOf('street-types', 'zzyzx')).toEqual([]);
    expect(canonicalsOf('company-types', '')).toEqual([]);
  });
});

describe('phraseAt and phraseEndingAt', () => {
  it('finds the longest phrase starting at a position', () => {
    expect(phraseAt('directionals', ['north', 'east', 'main'], 0)).toMatchObject({
      length: 2,
      canonicals: expect.arrayContaining(['northeast']) as unknown,
    });
    expect(phraseAt('directionals', ['north', 'east', 'main'], 2)).toBeNull();
    expect(phraseAt('directionals', ['main'], 5)).toBeNull();
  });

  it('finds the longest phrase ending at a position', () => {
    expect(
      phraseEndingAt('company-types', ['acme', 'limited', 'liability', 'company'], 4),
    ).toMatchObject({ length: 3, canonicals: ['limited liability company'] });
    expect(phraseEndingAt('company-types', ['acme'], 1)).toBeNull();
    expect(phraseEndingAt('company-types', ['acme'], 0)).toBeNull();
  });
});
